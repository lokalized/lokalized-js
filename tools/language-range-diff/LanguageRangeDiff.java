package com.lokalized;

import java.io.BufferedWriter;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The oracle for `tools/language-range-diff/run.mjs`.
 *
 * SINCE AMENDMENT A30 it calls lokalized-java 3.1.0's PUBLIC {@link LocaleMatcher#parseLanguageRanges(String)}
 * on a default {@link Strings} (so {@link LanguageRangeEquivalents#IANA_REGISTRY}), resolved from the jar
 * `tools/oracle-jar.mjs` names, on the pinned Corretto 21 — the method the port's `parseLanguageRanges`
 * ports. It ALSO emits, per input, what the JDK's own {@link Locale.LanguageRange#parse(String)} answers,
 * as `jdk`: the parse this oracle called before A30, kept so the run can say how many probes the registry
 * and the running JDK disagree on (the anti-vacuity number: zero would mean the re-aim changed nothing).
 * Nothing here re-reads the grammar, so a disagreement is a port defect and not a difference between two
 * readings of the source.
 *
 * `package com.lokalized` so the `--keys` dump can reflect the library's own package-private table
 * (`IanaLanguageEquivalents.LANGUAGE_EQUIVALENTS` and `REGION_VARIANT_EQUIVALENTS`). A rename there
 * breaks this harness LOUDLY, at the dump, which is the intended failure.
 *
 * Weights are emitted as `Double.toString` TEXT rather than as JSON numbers. That is deliberate:
 * `weight=…` messages are compared verbatim by the conformance runner, so the JS side owes an exact
 * `Double.toString`, and emitting the text makes this differential check that too.
 */
public class LanguageRangeDiff {
	public static void main(String[] args) throws Exception {
		if (args.length == 5 && args[0].equals("--keys")) {
			dumpJdkEquivalenceKeys(Path.of(args[1]));
			dumpJdkRegionVariantEquivalents(Path.of(args[2]));
			dumpLibraryEquivalenceKeys(Path.of(args[3]));
			dumpLibraryRegionVariantEquivalents(Path.of(args[4]));
			return;
		}

		List<String> inputs = Files.readAllLines(Path.of(args[0]), StandardCharsets.UTF_8);
		LocaleMatcher library = defaultStrings();

		try (BufferedWriter out = Files.newBufferedWriter(Path.of(args[1]), StandardCharsets.UTF_8)) {
			for (String line : inputs) {
				if (line.isEmpty())
					continue;

				String input = unquote(line);
				StringBuilder row = new StringBuilder("{\"in\":").append(quote(input)).append(',');

				try {
					appendRanges(row, library.parseLanguageRanges(input));
				} catch (RuntimeException exception) {
					appendRefusal(row, exception);
				}

				row.append(",\"jdk\":{");
				try {
					appendRanges(row, Locale.LanguageRange.parse(input));
				} catch (RuntimeException exception) {
					appendRefusal(row, exception);
				}
				row.append('}');

				out.write(row.append('}').toString());
				out.newLine();
			}
		}
	}

	/**
	 * A default {@link Strings}: no {@code languageRangeEquivalents} call, so the library's own default
	 * applies — which is the point, since that default is what the port models. One catalog, because a
	 * {@code Strings} needs its fallback's; the parse reads none of it.
	 */
	private static Strings defaultStrings() {
		Set<LocalizedString> catalog = LocalizedStringLoader.parse(
				new ByteArrayInputStream("{\"K\":\"v\"}".getBytes(StandardCharsets.UTF_8)), Locale.ENGLISH, "probe:en");

		return Strings.withFallbackLocale(Locale.ENGLISH)
				.localizedStringSupplier(() -> Map.of(Locale.ENGLISH, catalog))
				.localeSupplier((matcher) -> Locale.ENGLISH)
				.build();
	}

	private static void appendRanges(StringBuilder row, List<Locale.LanguageRange> ranges) {
		row.append("\"ok\":true,\"ranges\":[");

		for (int index = 0; index < ranges.size(); ++index) {
			if (index > 0)
				row.append(',');
			row.append("{\"range\":").append(quote(ranges.get(index).getRange()))
					.append(",\"weight\":").append(quote(Double.toString(ranges.get(index).getWeight())))
					.append('}');
		}

		row.append(']');
	}

	private static void appendRefusal(StringBuilder row, RuntimeException exception) {
		row.append("\"ok\":false,\"error\":").append(quote(exception.getMessage()))
				.append(",\"errorType\":").append(quote(exception.getClass().getName()));
	}

	/**
	 * Writes every key of the JDK's OWN language equivalence tables, one per line.
	 *
	 * It seeds the probe space. The space was once "the corpus, plus the keys of the PINNED closure
	 * artifact, plus suffixes" — derived from the very table under test, so a range the artifact was
	 * MISSING could never be probed, and four of them were (`cmn-hans`, `cmn-hant`, `lv-lvs`, `lv-ltg`).
	 * Since A30 the JDK is a check rather than the source, but its keys still name ranges a JDK-shaped
	 * caller sends, so they stay in the space beside the library's and the artifact's.
	 *
	 * Reflection into a JDK-internal class is the right tool HERE and would not be in the shipped
	 * library — this is a test oracle pinned to one JDK build. If the fields ever stop being reachable
	 * this method THROWS rather than returning what it could find: a probe space that quietly shrinks is
	 * the failure it was written to prevent.
	 */
	private static void dumpJdkEquivalenceKeys(Path out) throws Exception {
		Class<?> maps = Class.forName("sun.util.locale.LocaleEquivalentMaps");
		StringBuilder text = new StringBuilder();
		int total = 0;

		for (String field : new String[] { "singleEquivMap", "multiEquivsMap" }) {
			java.lang.reflect.Field handle = maps.getDeclaredField(field);
			handle.setAccessible(true);
			Map<?, ?> map = (Map<?, ?>) handle.get(null);

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
	 * The ORDER is load-bearing — `getEquivalentForRegionAndVariant` returns on the FIRST key it finds in
	 * the range, so `sgn-de-fr` answers differently under a different order — and since A30 it is the one
	 * input to the IANA data the registry does not state: lokalized-spec authors it once
	 * (`tools/iana-oracle/jdk-compatibility.json`) FROM this map. `run.mjs` requires the port's generated
	 * pairs, the library's and this map's to be the same ordered list. Values are emitted beside the keys
	 * so the tables are checked as MAPPINGS, not merely as key sets. THROWS rather than returning what it
	 * could find.
	 */
	private static void dumpJdkRegionVariantEquivalents(Path out) throws Exception {
		Class<?> maps = Class.forName("sun.util.locale.LocaleEquivalentMaps");
		java.lang.reflect.Field handle = maps.getDeclaredField("regionVariantEquivMap");
		handle.setAccessible(true);
		Map<?, ?> map = (Map<?, ?>) handle.get(null);

		if (map.isEmpty())
			throw new IllegalStateException("regionVariantEquivMap is empty; the port's table would be checked against nothing");

		StringBuilder text = new StringBuilder();
		for (Map.Entry<?, ?> entry : map.entrySet())
			text.append(entry.getKey()).append('\t').append(entry.getValue()).append('\n');

		Files.writeString(out, text.toString(), StandardCharsets.UTF_8);
	}

	/**
	 * Writes every key of lokalized-java's OWN registry table (`IanaLanguageEquivalents.LANGUAGE_EQUIVALENTS`),
	 * one per line. `LANGUAGE_EQUIVALENTS` is a {@code HashMap}, so its ITERATION ORDER MEANS NOTHING:
	 * `run.mjs` reads these as a SET of probe seeds and never as an order.
	 */
	private static void dumpLibraryEquivalenceKeys(Path out) throws Exception {
		java.lang.reflect.Field handle = IanaLanguageEquivalents.class.getDeclaredField("LANGUAGE_EQUIVALENTS");
		handle.setAccessible(true);
		Map<?, ?> map = (Map<?, ?>) handle.get(null);

		if (map.size() < 700)
			throw new IllegalStateException("only " + map.size() + " library equivalence keys; expected the registry table's 781");

		StringBuilder text = new StringBuilder();
		for (Object key : map.keySet())
			text.append(key).append('\n');

		Files.writeString(out, text.toString(), StandardCharsets.UTF_8);
	}

	/**
	 * Writes lokalized-java's `IanaLanguageEquivalents.REGION_VARIANT_EQUIVALENTS` as `key<TAB>value`
	 * lines, in the list's order — which IS the attempt order (a {@code List}, not a map).
	 */
	private static void dumpLibraryRegionVariantEquivalents(Path out) throws Exception {
		java.lang.reflect.Field handle = IanaLanguageEquivalents.class.getDeclaredField("REGION_VARIANT_EQUIVALENTS");
		handle.setAccessible(true);
		List<?> pairs = (List<?>) handle.get(null);

		if (pairs.isEmpty())
			throw new IllegalStateException("REGION_VARIANT_EQUIVALENTS is empty; the port's pairs would be checked against nothing");

		StringBuilder text = new StringBuilder();
		for (Object pair : pairs) {
			String[] fromTo = (String[]) pair;
			text.append(fromTo[0]).append('\t').append(fromTo[1]).append('\n');
		}

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
