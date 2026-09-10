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
 * Output: one JSON object per line, in input order.
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
				observed.put("failed", false);
				observed.put("failureType", null);
				observed.put("failureMessage", null);
				observed.put("locales", new ArrayList<Object>(keysByLocale.keySet()));
				observed.put("keysByLocale", keysByLocale);
			} catch (RuntimeException e) {
				observed.put("failed", true);
				observed.put("failureType", e.getClass().getName());
				observed.put("failureMessage", e.getMessage());
				observed.put("locales", new ArrayList<>());
				observed.put("keysByLocale", new TreeMap<>());
			}
			// OUTSIDE the try/catch arms and identical in both, because warnings STREAM: everything
			// delivered before an abort stays delivered and is observable. Reporting an empty list on
			// failure would hide exactly the behaviour the warning-budget probes exist to check.
			observed.put("warnings", warnings);

			out.append(json(observed)).append("\n");
		}
		System.out.print(out);
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
