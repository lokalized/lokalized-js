import com.lokalized.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * Replays adversarial phonetic scenarios through the REAL {@code DefaultStrings} and prints what it
 * did — the rendered string or the failure message, plus every {@code PhoneticResolver} invocation
 * in order, with the term and the locale each was handed.
 *
 * The resolver channel is the point. Most of the phonetic axis renders a string a wrong port would
 * render too; which locale the callback receives, how many times it runs and whether it runs at all
 * are visible only here.
 *
 * Input is TSV, one scenario per line:
 *   name \t fallbackLocale \t instanceLocale \t requestLocale \t key \t resolverSpec \t placeholders \t catalogs
 * where `catalogs` is `locale::base64(json)` joined by ';;' and `placeholders` is `name=TYPE:value`
 * joined by ',,' with TYPE in S(tring) I(nt) D(ouble) B(ool) P(honetic) G(ender) N(ull).
 */
public class PhoneticDiff {
  static List<String> CALLS = new ArrayList<>();

  static PhoneticResolver resolverFor(String spec) {
    String[] parts = spec.split(":", 2);
    PhoneticResolver delegate;
    switch (parts[0]) {
      case "first-letter-vowel":
        delegate = (t, l) -> t != null && t.length() > 0 && "aeiouAEIOU".indexOf(t.charAt(0)) >= 0
            ? Phonetic.VOWEL : Phonetic.CONSONANT;
        break;
      case "constant": {
        Phonetic p = Phonetic.valueOf(parts[1].replace("PHONETIC_", ""));
        delegate = (t, l) -> p;
        break;
      }
      case "by-locale": {
        Map<String, Phonetic> m = new LinkedHashMap<>();
        for (String pair : parts[1].split("\\|")) {
          String[] kv = pair.split("=");
          m.put(kv[0], Phonetic.valueOf(kv[1].replace("PHONETIC_", "")));
        }
        delegate = (t, l) -> m.containsKey(l.toLanguageTag()) ? m.get(l.toLanguageTag()) : Phonetic.OTHER;
        break;
      }
      case "return-null": delegate = (t, l) -> null; break;
      case "throw": delegate = (t, l) -> { throw new IllegalStateException("resolver refuses"); };
      break;
      default: throw new IllegalArgumentException(spec);
    }
    return (term, locale) -> {
      StringBuilder sb = new StringBuilder();
      sb.append(term.replace("\n", "\\n")).append('|').append(locale.toLanguageTag()).append('|');
      try {
        Phonetic p = delegate.resolve(term, locale);
        sb.append(p == null ? "null" : p.name()).append("|-");
        CALLS.add(sb.toString());
        return p;
      } catch (RuntimeException e) {
        sb.append("-|").append(e.getClass().getSimpleName());
        CALLS.add(sb.toString());
        throw e;
      }
    };
  }

  static Object valueFor(String spec) {
    String[] kv = spec.split(":", 2);
    switch (kv[0]) {
      case "S": return kv[1].replace("\\n", "\n").replace("\\t", "\t");
      case "REPEAT": { String[] p = kv[1].split("\\*"); StringBuilder b = new StringBuilder();
        for (int i = 0; i < Integer.parseInt(p[1]); i++) b.append(p[0]); return b.toString(); }
      case "I": return Integer.valueOf(kv[1]);
      case "D": return Double.valueOf(kv[1]);
      case "B": return Boolean.valueOf(kv[1]);
      case "P": return Phonetic.valueOf(kv[1].replace("PHONETIC_", ""));
      case "G": return Gender.valueOf(kv[1]);
      case "N": return null;
      default: throw new IllegalArgumentException(spec);
    }
  }

  static Throwable deepest(Throwable t) {
    while (t.getCause() != null && t.getCause() != t) t = t.getCause();
    return t;
  }

  public static void main(String[] args) throws Exception {
    List<String> lines = Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8);
    StringBuilder out = new StringBuilder();

    for (String line : lines) {
      if (line.isEmpty() || line.startsWith("#")) continue;
      String[] f = line.split("\t", 8);
      String name = f[0];
      CALLS = new ArrayList<>();

      String result;
      try {
        Set<LocalizedString> all = new LinkedHashSet<>();
        Map<Locale, Set<LocalizedString>> byLocale = new LinkedHashMap<>();
        for (String cat : f[7].split(";;")) {
          String[] lc = cat.split("::", 2);
          byte[] bytes = Base64.getDecoder().decode(lc[1]);
          Locale loc = Locale.forLanguageTag(lc[0]);
          byLocale.put(loc, LocalizedStringLoader.parse(new ByteArrayInputStream(bytes), loc, "catalog:" + lc[0]));
        }

        Strings.Builder b = Strings.withFallbackLocale(Locale.forLanguageTag(f[1]))
            .localizedStringSupplier(() -> byLocale)
            .localeSupplier(matcher -> Locale.forLanguageTag(f[2]));
        if (!f[5].equals("none")) b = b.phoneticResolver(resolverFor(f[5]));
        Strings strings = b.build();

        Map<String, Object> ctx = new LinkedHashMap<>();
        if (!f[6].isEmpty())
          for (String p : f[6].split(",,")) {
            String[] nv = p.split("=", 2);
            ctx.put(nv[0], valueFor(nv[1]));
          }

        TranslationResult r = strings.getResult(f[4], ctx,
            TranslationOptions.builder().locale(Locale.forLanguageTag(f[3])).build());
        result = r.getStatus() + "\t" + r.getTranslation().replace("\n", "\\n")
            + "\t" + r.getResolvedLocale().map(Locale::toLanguageTag).orElse("-")
            + "\t" + r.getFailureReason().map(Object::toString).orElse("-")
            + "\t" + (r.getCause().isPresent()
                ? String.valueOf(deepest(r.getCause().get()).getMessage()).replace("\n", "\\n") : "-");
      } catch (Exception e) {
        result = "THROWN\t" + e.getClass().getSimpleName() + ": "
            + String.valueOf(e.getMessage()).replace("\n", "\\n") + "\t-\t-\t-";
      }

      out.append(name).append('\t').append(result)
         .append("\tCALLS[").append(String.join(" ;; ", CALLS)).append("]\n");
    }
    System.out.print(out);
  }
}
