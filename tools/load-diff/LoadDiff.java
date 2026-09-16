import com.lokalized.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * The Java half of `diff:load` — `LocalizedStringLoader.loadFromFilesystem` over directories the
 * JavaScript half has ALREADY materialized, so both sides see literally the same bytes on the same
 * filesystem.
 *
 * WHY THAT MATTERS AND WHY IT IS DIFFERENT FROM THE CORPUS. The behavioral corpus records this same
 * method, but `VectorOracle.withoutTemporaryPaths` scrubs every absolute path in every recorded
 * diagnostic down to `<fixtures>/` — which is right for an artifact that must be byte-stable across
 * runs, and which erases the ONE distinction Java makes three different ways in a single load: the
 * resolved real path for warnings and per-file failures, the caller's spelling for directory-level
 * messages, and the unresolved constructed path when realpath itself fails. Ablating `toRealPath`
 * out of a prototype left the corpus at 140/145. Here nothing is scrubbed, because both sides are
 * handed the same directory and can be compared verbatim.
 *
 * Input: one probe per line, TAB-separated — name, absolute directory, then `k=v,k=v` options.
 * A plain key/value list rather than JSON deliberately: this file must not need a JSON parser on the
 * classpath, and every loading option is a scalar.
 *
 * Output: one JSON object per line, in input order — the load's outcome, its locales, the keys in
 * each, THE PARSED CONTENT behind each key (`contentByLocale`, see `describe` below), and the full
 * ordered warning list. Every field is emitted on BOTH the success and the failure arm, because
 * `tools/oracle-field-coverage.mjs` fails the run on a field the oracle emits and the comparison
 * never reads, and a field that appeared on only one arm would make that gate's answer depend on
 * which probes ran.
 */
public class LoadDiff {
	public static void main(String[] args) throws Exception {
		List<String> lines = Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8);
		StringBuilder out = new StringBuilder();

		for (String line : lines) {
			if (line.isEmpty()) continue;
			String[] fields = line.split("\t", -1);
			String name = fields[0];
			String directory = fields[1];
			String optionSpec = fields.length > 2 ? fields[2] : "";

			Map<String, Object> observed = new LinkedHashMap<>();
			observed.put("name", name);

			// Option construction is INSIDE the try, because an out-of-band limit is an
			// IllegalArgumentException from the builder — a refusal that happens before any load and
			// that the port must reproduce at the same point.
			List<Map<String, Object>> warnings = new ArrayList<>();
			try {
				LocalizedStringLoadingOptions options = optionsFrom(optionSpec);
				LocalizedStringWarningHandler handler = warning -> {
					Map<String, Object> row = new LinkedHashMap<>();
					row.put("type", warning.getType().name());
					row.put("source", warning.getSource());
					row.put("locale", warning.getLocale().map(Locale::toLanguageTag).orElse(null));
					row.put("key", warning.getKey().orElse(null));
					row.put("placeholder", warning.getPlaceholder().orElse(null));
					List<Object> forms = new ArrayList<>(warning.getMissingLanguageForms());
					Collections.sort(forms, (a, b) -> ((String) a).compareTo((String) b));
					row.put("missingLanguageForms", forms);
					row.put("message", warning.getMessage());
					warnings.add(row);
				};

				Map<Locale, Set<LocalizedString>> loaded =
						LocalizedStringLoader.loadFromFilesystem(Paths.get(directory), handler, options);

				Map<String, Object> keysByLocale = new TreeMap<>();
				for (Map.Entry<Locale, Set<LocalizedString>> entry : loaded.entrySet()) {
					List<Object> keys = new ArrayList<>();
					for (LocalizedString localizedString : entry.getValue()) keys.add(localizedString.getKey());
					Collections.sort(keys, (a, b) -> ((String) a).compareTo((String) b));
					keysByLocale.put(entry.getKey().toLanguageTag(), keys);
				}

				// THE PARSED CONTENT behind each of those keys. `keysByLocale` proves a key ARRIVED and
				// nothing else, so the harness used to reduce a `Map<Locale, Set<LocalizedString>>` to a
				// list of names. Keyed in SORTED key order because the Java side holds a `HashSet`
				// (`LocalizedStringLoader.java:1912`): the set's own iteration order is not a property of
				// the loader and must not become one of the comparison.
				Map<String, Object> contentByLocale = new TreeMap<>();
				for (Map.Entry<Locale, Set<LocalizedString>> entry : loaded.entrySet()) {
					Map<String, Object> rows = new TreeMap<>();
					for (LocalizedString localizedString : entry.getValue())
						rows.put(localizedString.getKey(), describe(localizedString));
					contentByLocale.put(entry.getKey().toLanguageTag(), rows);
				}

				observed.put("failed", false);
				observed.put("failureType", null);
				observed.put("failureMessage", null);
				observed.put("locales", new ArrayList<Object>(keysByLocale.keySet()));
				observed.put("keysByLocale", keysByLocale);
				observed.put("contentByLocale", contentByLocale);
			} catch (RuntimeException e) {
				observed.put("failed", true);
				observed.put("failureType", e.getClass().getName());
				observed.put("failureMessage", e.getMessage());
				observed.put("locales", new ArrayList<>());
				observed.put("keysByLocale", new TreeMap<>());
				// Emitted on BOTH arms exactly as `keysByLocale` is. The recording proxy in
				// `tools/oracle-field-coverage.mjs` computes the emitted set over the UNION of every row's
				// keys, so a field present only on the success arm would still be demanded of a comparison
				// that only ever sees refusals — and an absent key would read as `undefined` against the
				// port's `{}`.
				observed.put("contentByLocale", new TreeMap<>());
			}
			// OUTSIDE the try/catch arms and identical in both, because warnings STREAM: everything
			// delivered before an abort stays delivered and is observable. Reporting an empty list on
			// failure would hide exactly the behaviour the warning-budget probes exist to check.
			observed.put("warnings", warnings);

			out.append(json(observed)).append("\n");
		}
		System.out.print(out);
	}

	/**
	 * One loaded `LocalizedString`, rendered as the whole graph the loader built behind its key.
	 *
	 * WHY THE VALUE IS WORTH EMITTING. Every other column here is about WHICH files were read and WHAT
	 * the loader said about them; none of them looks at what was actually parsed. A port that agrees on
	 * every locale, every key, every warning and every refusal message can still have built a different
	 * message behind the key — a dropped commentary, a dropped range, a re-ordered alternative list, a
	 * placeholder map rebuilt in sorted order — and this tool would have printed `40 identical`.
	 *
	 * TWO KINDS OF ORDER ARE EMITTED AS ARRAYS ON PURPOSE. `run.mjs`'s `canonical` sorts object keys
	 * before comparing, so an order carried by a MAP is not compared at all. Java preserves three
	 * declaration orders that the file format makes load-bearing, each asserted in `run.mjs`'s Java
	 * inventory rather than trusted: placeholder declaration order (`LocalizedStringLoader.java:2207`
	 * copies into a `LinkedHashMap` from the JSON object's own member order), per-form translation
	 * order (`:2622`, likewise), and both alternative lists (`:2266` — "array order defines first-match
	 * precedence"). All four are therefore lists of rows, never maps.
	 *
	 * IT THROWS on a `PlaceholderDefinition` subtype it has not been taught to render. Skipping one
	 * would emit the same empty row on both sides and read as agreement.
	 *
	 * ABLATION, measured 2026-09-15: five single mutations of the port's `projectNode` — dropped
	 * commentary, dropped range, sorted placeholder map, sorted whole-message alternatives, sorted
	 * per-form translations — each turn `diff:load` red with `MISMATCHES (1)` on
	 * `parsed-content-is-compared`, each leave `npm run conformance` byte-identical at 2,117 passed /
	 * 0 FAILED, and each were GREEN on this tool before this method existed. `run.mjs`'s header
	 * carries the full table.
	 */
	private static Map<String, Object> describe(LocalizedString localizedString) {
		Map<String, Object> row = new LinkedHashMap<>();
		row.put("translation", localizedString.getTranslation().orElse(null));
		row.put("commentary", localizedString.getCommentary().orElse(null));

		List<Object> placeholders = new ArrayList<>();
		for (Map.Entry<String, LocalizedString.PlaceholderDefinition> entry
				: localizedString.getPlaceholderDefinitions().entrySet()) {
			Map<String, Object> placeholder = new LinkedHashMap<>();
			placeholder.put("name", entry.getKey());
			LocalizedString.PlaceholderDefinition definition = entry.getValue();

			if (definition instanceof LocalizedString.LanguageFormTranslation) {
				LocalizedString.LanguageFormTranslation languageForm =
						(LocalizedString.LanguageFormTranslation) definition;
				placeholder.put("kind", "language-form");
				placeholder.put("value", languageForm.getValue().orElse(null));

				Map<String, Object> range = null;
				if (languageForm.getRange().isPresent()) {
					range = new LinkedHashMap<>();
					range.put("start", languageForm.getRange().get().getStart());
					range.put("end", languageForm.getRange().get().getEnd());
				}
				placeholder.put("range", range);

				List<Object> translations = new ArrayList<>();
				for (Map.Entry<LanguageForm, String> translated
						: languageForm.getTranslationsByLanguageForm().entrySet()) {
					Map<String, Object> translation = new LinkedHashMap<>();
					translation.put("form", fileFormatName(translated.getKey()));
					translation.put("translation", translated.getValue());
					translations.add(translation);
				}
				placeholder.put("translations", translations);
			} else if (definition instanceof LocalizedString.ExpressionTranslation) {
				LocalizedString.ExpressionTranslation expression =
						(LocalizedString.ExpressionTranslation) definition;
				placeholder.put("kind", "expression");
				placeholder.put("translation", expression.getTranslation());

				List<Object> alternatives = new ArrayList<>();
				for (LocalizedString.ExpressionAlternative alternative : expression.getAlternatives()) {
					Map<String, Object> alternativeRow = new LinkedHashMap<>();
					alternativeRow.put("expression", alternative.getExpression());
					alternativeRow.put("translation", alternative.getTranslation());
					alternatives.add(alternativeRow);
				}
				placeholder.put("alternatives", alternatives);
			} else {
				throw new IllegalStateException("this harness cannot render placeholder definition type "
						+ definition.getClass().getName() + " — model the new subtype rather than skipping it,"
						+ " because an unrendered row is identical on both sides and reads as agreement");
			}

			placeholders.add(placeholder);
		}
		row.put("placeholders", placeholders);

		// A whole-message alternative IS a `LocalizedString` whose KEY is its expression
		// (`LocalizedStringLoader.java:2269-2274`), so the recursion carries the expression alongside the
		// nested graph and the list is never sorted.
		List<Object> alternatives = new ArrayList<>();
		for (LocalizedString alternative : localizedString.getAlternatives()) {
			Map<String, Object> nested = new LinkedHashMap<>();
			nested.put("expression", alternative.getKey());
			nested.putAll(describe(alternative));
			alternatives.add(nested);
		}
		row.put("alternatives", alternatives);

		return row;
	}

	/**
	 * The FILE-FORMAT spelling of a language form — `CARDINALITY_ONE`, not `ONE`.
	 *
	 * `LocalizedStringUtils` is package-private (`LocalizedStringUtils.java:33`) and this harness is in
	 * the default package, so the massaging the loader applies is mirrored here. It THROWS on a form it
	 * cannot spell rather than falling through to `name()`: a silent fallback would emit `ONE` on both
	 * sides of the comparison and look like agreement — the same failure shape as skipping an unknown
	 * placeholder subtype. The ten prefixes are asserted against `LocalizedStringUtils.java` by
	 * `run.mjs`'s Java inventory, so a renamed prefix fails the run instead of quietly agreeing.
	 */
	private static String fileFormatName(LanguageForm languageForm) {
		if (!(languageForm instanceof Enum))
			throw new IllegalStateException("language form " + languageForm.getClass().getName() + " is not an enum");

		String name = ((Enum<?>) languageForm).name();

		if (languageForm instanceof Cardinality) return "CARDINALITY_" + name;
		if (languageForm instanceof Ordinality) return "ORDINALITY_" + name;
		if (languageForm instanceof Gender) return "GENDER_" + name;
		if (languageForm instanceof GrammaticalCase) return "CASE_" + name;
		if (languageForm instanceof Definiteness) return "DEFINITENESS_" + name;
		if (languageForm instanceof Classifier) return "CLASSIFIER_" + name;
		if (languageForm instanceof Formality) return "FORMALITY_" + name;
		if (languageForm instanceof Clusivity) return "CLUSIVITY_" + name;
		if (languageForm instanceof Animacy) return "ANIMACY_" + name;
		if (languageForm instanceof Phonetic) return "PHONETIC_" + name;

		throw new IllegalStateException("this harness cannot spell the file-format name of language form "
				+ languageForm.getClass().getName() + "." + name
				+ " — mirror LocalizedStringUtils' prefixes rather than falling through to name()");
	}

	private static LocalizedStringLoadingOptions optionsFrom(String spec) {
		LocalizedStringLoadingOptions.Builder builder = LocalizedStringLoadingOptions.builder();
		if (spec.isEmpty()) return builder.build();
		for (String pair : spec.split(",")) {
			int equals = pair.indexOf('=');
			String key = pair.substring(0, equals);
			String value = pair.substring(equals + 1);
			switch (key) {
				case "maximumInputBytes": builder.maximumInputBytes(Integer.valueOf(value)); break;
				case "maximumReaderCharacters": builder.maximumReaderCharacters(Integer.valueOf(value)); break;
				case "maximumJsonNestingDepth": builder.maximumJsonNestingDepth(Integer.valueOf(value)); break;
				case "maximumTotalInputBytes": builder.maximumTotalInputBytes(Long.valueOf(value)); break;
				case "maximumLocalizedStringsFiles": builder.maximumLocalizedStringsFiles(Integer.valueOf(value)); break;
				case "maximumTranslationNodes": builder.maximumTranslationNodes(Integer.valueOf(value)); break;
				case "maximumWarnings": builder.maximumWarnings(Integer.valueOf(value)); break;
				case "maximumDiscoveryEntries": builder.maximumDiscoveryEntries(Integer.valueOf(value)); break;
				default: throw new IllegalStateException("probe names an unknown loading option: " + key);
			}
		}
		return builder.build();
	}

	@SuppressWarnings("unchecked")
	private static String json(Object value) {
		if (value == null) return "null";
		if (value instanceof Boolean || value instanceof Number) return String.valueOf(value);
		if (value instanceof Map) {
			StringBuilder sb = new StringBuilder("{");
			boolean first = true;
			for (Map.Entry<String, Object> entry : ((Map<String, Object>) value).entrySet()) {
				if (!first) sb.append(",");
				first = false;
				sb.append(json(entry.getKey())).append(":").append(json(entry.getValue()));
			}
			return sb.append("}").toString();
		}
		if (value instanceof Collection) {
			StringBuilder sb = new StringBuilder("[");
			boolean first = true;
			for (Object element : (Collection<Object>) value) {
				if (!first) sb.append(",");
				first = false;
				sb.append(json(element));
			}
			return sb.append("]").toString();
		}
		String text = String.valueOf(value);
		StringBuilder sb = new StringBuilder("\"");
		for (int i = 0; i < text.length(); ++i) {
			char c = text.charAt(i);
			switch (c) {
				case '"': sb.append("\\\""); break;
				case '\\': sb.append("\\\\"); break;
				case '\n': sb.append("\\n"); break;
				case '\r': sb.append("\\r"); break;
				case '\t': sb.append("\\t"); break;
				default:
					// Every non-ASCII character is escaped, so the transport is pure ASCII and a probe
					// carrying a decomposed filename cannot be silently normalized in transit — which is
					// the whole point of the NFC/NFD probes the corpus has never run.
					if (c < 0x20 || c > 0x7e) sb.append(String.format("\\u%04x", (int) c));
					else sb.append(c);
			}
		}
		return sb.append("\"").toString();
	}
}
