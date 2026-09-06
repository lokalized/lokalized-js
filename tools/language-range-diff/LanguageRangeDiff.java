package com.lokalized;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;

/**
 * The oracle for `tools/language-range-diff/run.mjs`.
 *
 * It calls `java.util.Locale.LanguageRange.parse` — the REAL JDK parser the library itself calls
 * through `DefaultStrings#addParsedLanguageRangeIdentities` — on the pinned Corretto 21, and emits
 * the member list, or the real exception message, for each input. Nothing here re-reads the grammar,
 * so a disagreement is a port defect and not a difference between two readings of the source.
 *
 * Weights are emitted as `Double.toString` TEXT rather than as JSON numbers. That is deliberate:
 * `weight=…` messages are compared verbatim by the conformance runner, so the JS side owes an exact
 * `Double.toString`, and emitting the text makes this differential check that too.
 */
public class LanguageRangeDiff {
	public static void main(String[] args) throws Exception {
		if (args.length == 3 && args[0].equals("--keys")) {
			dumpEquivalenceKeys(Path.of(args[1]));
			dumpRegionVariantEquivalents(Path.of(args[2]));
			return;
		}

		List<String> inputs = Files.readAllLines(Path.of(args[0]), StandardCharsets.UTF_8);

		try (BufferedWriter out = Files.newBufferedWriter(Path.of(args[1]), StandardCharsets.UTF_8)) {
			for (String line : inputs) {
				if (line.isEmpty())
					continue;

				String input = unquote(line);
				StringBuilder row = new StringBuilder("{\"in\":").append(quote(input));

				try {
					List<Locale.LanguageRange> ranges = Locale.LanguageRange.parse(input);
					row.append(",\"ok\":true,\"ranges\":[");

					for (int index = 0; index < ranges.size(); ++index) {
						if (index > 0)
							row.append(',');
						row.append("{\"range\":").append(quote(ranges.get(index).getRange()))
								.append(",\"weight\":").append(quote(Double.toString(ranges.get(index).getWeight())))
								.append('}');
					}

					row.append(']');
				} catch (RuntimeException exception) {
					row.append(",\"ok\":false,\"error\":").append(quote(exception.getMessage()))
							.append(",\"errorType\":").append(quote(exception.getClass().getName()));
				}

				out.write(row.append('}').toString());
				out.newLine();
			}
		}
	}

	/**
	 * Writes every key of the JDK's OWN equivalence tables, one per line.
	 *
	 * This exists because of a defect this differential could not see without it. The probe space used
	 * to be "the corpus, plus the 802 keys of the PINNED closure artifact, plus suffixes" — that is, the
	 * probe space was derived from the very table under test, so a range the artifact is MISSING could
	 * never be probed, and four of them were. Seeding from `sun.util.locale.LocaleEquivalentMaps`
	 * instead makes the space complete by construction: whatever the JDK keys on, the port is asked.
	 *
	 * Reflection into a JDK-internal class is the right tool HERE and would not be in the shipped
	 * library — this is a test oracle pinned to one JDK build, and the alternative (guessing the key
	 * shapes from CLDR) is exactly the guess that produced the gap. If the fields ever stop being
	 * reachable this method THROWS rather than returning what it could find: a probe space that
	 * quietly shrinks is the failure it was written to prevent.
	 */
	private static void dumpEquivalenceKeys(Path out) throws Exception {
		Class<?> maps = Class.forName("sun.util.locale.LocaleEquivalentMaps");
		StringBuilder text = new StringBuilder();
		int total = 0;

		for (String field : new String[] { "singleEquivMap", "multiEquivsMap" }) {
			java.lang.reflect.Field handle = maps.getDeclaredField(field);
			handle.setAccessible(true);
			java.util.Map<?, ?> map = (java.util.Map<?, ?>) handle.get(null);

			if (map.isEmpty())
				throw new IllegalStateException(field + " is empty; the probe space would silently shrink");

			for (Object key : map.keySet()) {
				text.append(key).append('\n');
				++total;
			}
		}

		if (total < 700)
			throw new IllegalStateException("only " + total + " equivalence keys; expected the JDK 21 table's 769");

		Files.writeString(out, text.toString(), StandardCharsets.UTF_8);
	}

	/**
	 * Writes `regionVariantEquivMap` as `key<TAB>value` lines, in `keySet()` iteration order.
	 *
	 * WHY THIS IS A SEPARATE DUMP, and why it was missing. `dumpEquivalenceKeys` above reflects
	 * `singleEquivMap` and `multiEquivsMap` only — the two LANGUAGE tables. The third table,
	 * `regionVariantEquivMap`, was reproduced in TWO hand-typed literals instead: `REGION_VARIANT` in
	 * `run.mjs` and `REGION_VARIANT_EQUIVALENTS` in `src/negotiate/index.js`. Both were verified once,
	 * by hand, and re-derived by nothing on any run — and that hand transcription was ALREADY WRONG
	 * ONCE, enumerated as thirteen subtags with `-zr` missing.
	 *
	 * That is precisely the failure mode the language half of this file was rewritten to close: a JDK
	 * that added a fifteenth pair, or reordered the existing fourteen, would leave every gate green.
	 * The ORDER is load-bearing and not decoration — `getEquivalentForRegionAndVariant` returns on the
	 * FIRST key it finds in the range, so a range carrying two of these subtags (`sgn-de-fr` carries
	 * both `-de` and `-fr`) answers differently under a different iteration order.
	 *
	 * Values are emitted alongside the keys so the port's table is checked as a MAPPING, not merely as
	 * a key set: a transcription that paired `-bu` with `-cd` has the right keys and the wrong answer.
	 * Like its sibling, this THROWS rather than returning what it could find.
	 */
	private static void dumpRegionVariantEquivalents(Path out) throws Exception {
		Class<?> maps = Class.forName("sun.util.locale.LocaleEquivalentMaps");
		java.lang.reflect.Field handle = maps.getDeclaredField("regionVariantEquivMap");
		handle.setAccessible(true);
		java.util.Map<?, ?> map = (java.util.Map<?, ?>) handle.get(null);

		if (map.isEmpty())
			throw new IllegalStateException("regionVariantEquivMap is empty; the port's table would be checked against nothing");

		StringBuilder text = new StringBuilder();
		for (java.util.Map.Entry<?, ?> entry : map.entrySet())
			text.append(entry.getKey()).append('\t').append(entry.getValue()).append('\n');

		Files.writeString(out, text.toString(), StandardCharsets.UTF_8);
	}

	/** The inputs arrive as JSON string literals, one per line, so a tab or a newline can be an input. */
	private static String unquote(String literal) {
		StringBuilder text = new StringBuilder();

		for (int index = 1; index < literal.length() - 1; ++index) {
			char character = literal.charAt(index);

			if (character != '\\') {
				text.append(character);
				continue;
			}

			char escape = literal.charAt(++index);
			switch (escape) {
				case 'n' -> text.append('\n');
				case 't' -> text.append('\t');
				case 'r' -> text.append('\r');
				case 'b' -> text.append('\b');
				case 'f' -> text.append('\f');
				case 'u' -> {
					text.append((char) Integer.parseInt(literal.substring(index + 1, index + 5), 16));
					index += 4;
				}
				default -> text.append(escape);
			}
		}

		return text.toString();
	}

	private static String quote(String text) {
		if (text == null)
			return "null";

		StringBuilder quoted = new StringBuilder("\"");

		for (int index = 0; index < text.length(); ++index) {
			char character = text.charAt(index);

			if (character == '"' || character == '\\')
				quoted.append('\\').append(character);
			else if (character < 0x20 || character > 0x7e)
				quoted.append(String.format("\\u%04x", (int) character));
			else
				quoted.append(character);
		}

		return quoted.append('"').toString();
	}
}
