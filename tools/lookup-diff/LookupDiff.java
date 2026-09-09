import com.lokalized.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.Locale.LanguageRange;

/**
 * The Java side of {@code tools/lookup-diff/run.mjs} — the END-TO-END lookup oracle.
 *
 * <p>Every other differential in this repository compares one LAYER: a tag against
 * {@code toLanguageTag}, a header against {@code LanguageRange.parse}, a template against the
 * tokenizer. Clause 12 of the M7 acceptance row is about none of those. It is about what
 * {@code strings.get(key, …, { locale })} ANSWERS, and the divergence it names lives one layer below
 * every existing probe: both sides agree on the TAG for {@code ja-JP-x-lvariant-JP} and disagree on
 * what a lookup for it does, because the refusal is a validation of the ATTEMPTED-LOCALE CHAIN that
 * the walk synthesizes — not of the tag the caller spelled.
 *
 * <p>So this oracle runs the REAL {@code DefaultStrings} against real catalogs and prints the whole
 * observable outcome of one lookup: the status, the string, the supplying locale, the accumulated
 * attempted locales, the failure reason, the fallback flag — or the refusal, with its class and its
 * message.
 *
 * <p>THREE AXES, each of which the measurement showed to be load-bearing.
 *
 * <ol>
 *   <li>THE CATALOG SET. Measured on the pinned Corretto 21: with catalogs {nn, nb, fr} a lookup for
 *       {@code en-US-x-lvariant-POSIX} THROWS, and with catalogs {en, fr} the same lookup SERVES
 *       {@code hello-en} and never throws — the chain {@code [en-US-POSIX, en-US, en, en-US-posix]}
 *       is answered at its third member and the duplicate at its fourth is never reached. A
 *       differential over one fixed fixture would have missed the duplicate refusal entirely.
 *   <li>THE KEY. {@code Hello} is in every catalog and {@code Only} in a subset, so the second lookup
 *       must walk PAST a catalog that matched the locale and could not answer. Without it nearly
 *       every probe resolves in one step and the attempted-locale list — where both of Java's
 *       refusals live — stays one long.
 *   <li>THE INGRESS. {@code LocaleUtils.requireWellFormed} is called at 24 CALL SITES in this
 *       library outside {@code LocaleUtils} itself, carrying 15 DISTINCT diagnostic descriptions —
 *       measured, correcting an earlier "ten sites with ten descriptions" here that made this probe
 *       space look more complete than it is. FOUR of them produce the refusals this tool can
 *       observe, and all four are driven here: the per-call {@code Locale override}
 *       ({@code TranslationOptions.java:73/310}), the ambient {@code localeSupplier result}
 *       ({@code DefaultStrings.java:2457}), the matcher's {@code Requested locale}
 *       ({@code LocaleMatcher.java:64}), and the walk's own {@code Attempted locale}
 *       ({@code TranslationResult.java:116}, {@code MissingTranslationException.java:153}). FIVE
 *       MORE sit on a lookup's path and stay silent in Java ONLY because an ingress check fires
 *       first — {@code TranslationResult.java:109} and {@code :111},
 *       {@code MissingTranslationException.java:146}, and {@code LocaleMatchResult.java:97} and
 *       {@code :117} — so a port WITHOUT the ingress checks has five further Java diagnostics that
 *       could surface where Java's never do. Probing only the per-call ingress would have gated one
 *       of the four observable sites and said nothing about the others — the "probe space derived
 *       from the thing under test" trap, at ingress rather than at tag level.
 *       <p>THE AXIS NOW HAS THREE MEMBERS, NOT TWO. It had two — per-call and ambient — while the
 *       third observable site, {@code LocaleMatcher.java:64}'s {@code Requested locale}, sat outside
 *       the probe space and was named in this tool's own defect entry as unprobed. It is reached by
 *       {@code matchFor(Locale)} rather than by a lookup, so no key applies and no walk runs; see
 *       {@code matcher}. Adding it is what makes the ingress axis a statement about Java's sites
 *       instead of about the two this file happened to drive — and it paid for itself immediately:
 *       it caught a second, unrelated defect nobody was looking for, a matcher input that the port
 *       normalized twice where Java normalizes once, in 42 rows no lookup ingress could reach.
 * </ol>
 *
 * <p>Input is TSV, one record per line, two record types:
 *
 * <pre>
 *   S \t name \t fallbackTag \t instanceTag \t tiebreakers \t catalogs
 *   P \t setName \t base64(tag)
 * </pre>
 *
 * where {@code catalogs} is {@code tag::base64(json)} joined by {@code ;;}, {@code tiebreakers} is
 * {@code languageCode=tag|tag} joined by {@code ,,} (or {@code -}), and the probe tag is base64 so a
 * tab, a newline, a lone surrogate or an astral character survives the transport intact.
 *
 * <p>Output is TSV: one {@code C} line per catalog set recording whether it CONSTRUCTED and, when it
 * did not, the refusal's fully-qualified class and message — a set Java refuses and the port accepts
 * (or the reverse) is a defect in its own right and must never be silently skipped, and a set both
 * sides refuse for DIFFERENT reasons is one too. Then one {@code P} line per probe carrying SEVEN
 * six-field outcomes: the cross of three keys and the two lookup ingresses, then the keyless matcher
 * ingress.
 *
 * <p>CONSTRUCTION IS AN INGRESS AXIS IN ITS OWN RIGHT, and it was blind until it carried its
 * reason. Java validates {@code Fallback locale} ({@code Strings.java:211},
 * {@code DefaultStrings.java:248}), {@code Localized strings locale} ({@code :276}) and
 * {@code Tiebreaker locale} ({@code :347}) before any lookup exists. Two of those three cannot be
 * discriminated by the BUILT/REFUSED boolean at all: the port refuses an ill-formed fallback anyway,
 * for the unrelated reason that it names no loaded catalog, and refuses an ill-formed tiebreaker
 * anyway, because it breaks the exact-permutation rule. Measured — deleting the port's fallback
 * check left this differential GREEN. Only the message says which of the two libraries is answering
 * the question that was asked.
 */
public class LookupDiff {
  /** The key every catalog defines, so the walk is decided by locale and never by a missing key. */
  static final String KEY_EVERYWHERE = "Hello";
  /** A key only SOME catalogs define, so the walk must continue past a matching, unanswering locale. */
  static final String KEY_SPARSE = "Only";
  /**
   * A key NO catalog defines, so the walk exhausts every candidate INCLUDING the fallback.
   *
   * <p>Without it the failure-handler axis is decoration: every fixture's fallback catalog holds
   * {@code Hello}, so the walk always answers and {@code throwExceptionFor} — the only path that
   * reaches {@code MissingTranslationException}'s copy of the attempted-locale validation — is never
   * entered. Measured: with only the two answerable keys, adding two throwing catalog sets moved the
   * unexplained count by zero and the declared count by eighty, all of them rows the non-throwing
   * sets already produced. Reaching a branch is not discriminating it.
   */
  static final String KEY_ABSENT = "Absent";

  /**
   * The ambient ingress. A mutable cell read by the {@code localeSupplier}, so each catalog set is
   * built ONCE and every probe still exercises {@code DefaultStrings.java:2457} — the alternative,
   * one {@code Strings} per probe, would make the sweep quadratic for no additional coverage.
   */
  static Locale ambient = Locale.forLanguageTag("und");

  public static void main(String[] args) throws Exception {
    List<String> lines = Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8);

    Map<String, Strings> perCall = new LinkedHashMap<>();
    Map<String, Strings> viaAmbient = new LinkedHashMap<>();
    StringBuilder out = new StringBuilder();

    for (String line : lines) {
      if (line.isEmpty() || line.startsWith("#")) continue;
      String[] f = line.split("\t", -1);

      if (f[0].equals("S")) {
        String name = f[1];
        try {
          // The per-call instance pins its ambient locale to the fixture's; the ambient instance
          // reads the mutable cell. Two instances rather than one, because a `localeSupplier` that
          // ignored the cell would silently turn the ambient axis into a copy of the per-call one.
          Locale instance = Locale.forLanguageTag(f[3]);
          perCall.put(name, buildStrings(f[2], f[4], f[5], f[6], matcher -> instance));
          viaAmbient.put(name, buildStrings(f[2], f[4], f[5], f[6], matcher -> ambient));
          out.append("C\t").append(name).append("\tBUILT\t-\t-\n");
        } catch (Throwable t) {
          // CLASS AND MESSAGE IN SEPARATE FIELDS, and the FULLY QUALIFIED name rather than the
          // simple one, so a construction refusal is transported exactly like a lookup refusal and
          // can be compared by the same `ERROR_NAME` table and the same divergence rules. It used to
          // be one joined `SimpleName: message` string, which was only ever printed — the run
          // compared the BUILT/REFUSED boolean and threw the reason away, so a port refusing the
          // right set for the WRONG reason read as agreement.
          out.append("C\t").append(name).append("\tREFUSED\t")
              .append(t.getClass().getName()).append('\t').append(flatten(t.getMessage()))
              .append('\n');
        }
        continue;
      }

      String setName = f[1];
      String tag = new String(Base64.getDecoder().decode(f[2]), StandardCharsets.UTF_8);

      // The JDK's OWN well-formedness oracle, exactly as `tools/direct-tag-diff/` uses it: the
      // differential never has to invent a definition of "well-formed", which matters because the
      // clause under test is scoped to well-formed input and a hand-drawn boundary would answer a
      // question nobody asked.
      boolean wellFormed;
      try {
        new Locale.Builder().setLanguageTag(tag);
        wellFormed = true;
      } catch (RuntimeException e) {
        wellFormed = false;
      }

      Strings direct = perCall.get(setName);
      Strings indirect = viaAmbient.get(setName);
      StringBuilder row = new StringBuilder();
      row.append("P\t").append(setName).append('\t').append(f[2]).append('\t').append(wellFormed);

      for (String key : new String[] {KEY_EVERYWHERE, KEY_SPARSE, KEY_ABSENT}) {
        row.append('\t').append(direct == null ? noSet() : perCall(direct, key, tag));
        row.append('\t').append(indirect == null ? noSet() : ambient(indirect, key, tag));
      }

      // THE THIRD INGRESS, and it takes no key because it performs no lookup. See `matcher`.
      row.append('\t').append(direct == null ? noSet() : matcher(direct, tag));

      out.append(row).append('\n');
    }

    System.out.print(out);
  }

  static String noSet() {
    return "NOSET\t-\t-\t-\t-\t-";
  }

  /** The per-call ingress: `TranslationOptions.Builder#locale`, which validates at :310. */
  static String perCall(Strings strings, String key, String tag) {
    try {
      TranslationOptions options = TranslationOptions.builder()
          .locale(Locale.forLanguageTag(tag)).build();
      return describe(strings.getResult(key, null, options));
    } catch (Throwable t) {
      return thrown(t);
    }
  }

  /** The ambient ingress: the `localeSupplier` result, which `DefaultStrings:2457` validates. */
  static String ambient(Strings strings, String key, String tag) {
    ambient = Locale.forLanguageTag(tag);
    try {
      return describe(strings.getResult(key));
    } catch (Throwable t) {
      return thrown(t);
    }
  }

  /**
   * The SELECTION ingress: {@code LocaleMatcher#matchFor(Locale)}, the default interface method
   * whose first statement is {@code requireWellFormed(locale, "Requested locale")}
   * ({@code LocaleMatcher.java:64}).
   *
   * <p>ADDED BECAUSE THE TOOL'S OWN DEFECT ENTRY NAMED IT AS UNPROBED. Two of Java's three
   * lookup-reachable {@code requireWellFormed} sites were visible here and the third was not, so a
   * fix scoped to what this tool could see would have been a probe space deciding its own scope —
   * the trap {@code CLAUDE.md} records costing a milestone's worth of hidden IANA keys. It goes in
   * THIS differential rather than a new one because the third site is reached from a
   * {@code Strings} instance built from the same catalog set, over the same tag sweep, under the
   * same staleness gate; {@code tools/direct-tag-diff/} compares tags and has no matcher to ask.
   *
   * <p>IT IS NOT REDUNDANT WITH THE TWO LOOKUP INGRESSES, measured on the pinned JDK: for
   * {@code en-US-x-lvariant-POSIX} and {@code ja-JP-x-lvariant-JP} the lookup ingresses THROW and
   * this one ANSWERS, because the refusals those two reach live in the walk's synthesized chain and
   * never in the selection channel. Those are the same three tags the corpus keeps as
   * {@code lvariant.exhausting-walk.*.selection-channel-does-not-refuse}, and they are what stops a
   * port from "fixing" the ingress by refusing everything.
   *
   * <p>SIX FIELDS like every other outcome, so the row arithmetic stays uniform. There is no key
   * and no translation, so the six are the match's own: a marker, the selected locale, the language
   * range it matched on, the match type, whether it matched, and the requested ranges the ingress
   * built from the tag. {@code effectiveWeight} is deliberately NOT among them — a locale ingress
   * builds a one-member range list at weight 1.0, so it is constant across the whole sweep and
   * would be decoration, while the requested-range list is a function of the tag.
   */
  static String matcher(Strings strings, String tag) {
    try {
      LocaleMatchResult match = strings.matchFor(Locale.forLanguageTag(tag));
      List<String> requested = new ArrayList<>();
      for (LanguageRange range : match.getRequestedLanguageRanges()) requested.add(range.getRange());

      return "MATCH"
          + "\t" + match.getLocale().map(Locale::toLanguageTag).orElse("-")
          + "\t" + match.getLanguageRange().map(LanguageRange::getRange).orElse("-")
          + "\t" + match.getMatchType()
          + "\t" + match.isMatch()
          + "\t" + (requested.isEmpty() ? "-" : String.join(",", requested));
    } catch (Throwable t) {
      return thrown(t);
    }
  }

  static String describe(TranslationResult r) {
    List<String> attempted = new ArrayList<>();
    for (Locale locale : r.getAttemptedLocales()) attempted.add(locale.toLanguageTag());

    return r.getStatus()
        + "\t" + flatten(r.getTranslation())
        + "\t" + r.getResolvedLocale().map(Locale::toLanguageTag).orElse("-")
        + "\t" + (attempted.isEmpty() ? "-" : String.join(",", attempted))
        + "\t" + r.getFailureReason().map(Object::toString).orElse("-")
        + "\t" + r.isFallback();
  }

  /** A throw is a first-class outcome, not an error: the refusals ARE the behaviour under test. */
  static String thrown(Throwable t) {
    return "THROWN\t" + t.getClass().getName() + "\t" + flatten(t.getMessage()) + "\t-\t-\t-";
  }

  static Strings buildStrings(String fallbackTag, String tiebreakerSpec, String handlerSpec,
      String catalogSpec, java.util.function.Function<LocaleMatcher, Locale> localeSupplier) {
    Map<Locale, Set<LocalizedString>> byLocale = new LinkedHashMap<>();
    for (String catalog : catalogSpec.split(";;")) {
      String[] parts = catalog.split("::", 2);
      Locale locale = Locale.forLanguageTag(parts[0]);
      byte[] bytes = Base64.getDecoder().decode(parts[1]);
      byLocale.put(locale,
          LocalizedStringLoader.parse(new ByteArrayInputStream(bytes), locale, "catalog:" + parts[0]));
    }

    Strings.Builder builder = Strings.withFallbackLocale(Locale.forLanguageTag(fallbackTag))
        .localizedStringSupplier(() -> byLocale)
        .localeSupplier(localeSupplier);

    if (!tiebreakerSpec.equals("-")) {
      Map<String, List<Locale>> tiebreakers = new LinkedHashMap<>();
      for (String entry : tiebreakerSpec.split(",,")) {
        String[] kv = entry.split("=", 2);
        List<Locale> locales = new ArrayList<>();
        for (String tag : kv[1].split("\\|")) locales.add(Locale.forLanguageTag(tag));
        tiebreakers.put(kv[0], locales);
      }
      builder = builder.tiebreakerLocalesByLanguageCode(tiebreakers);
    }

    // THE FAILURE-HANDLER AXIS. `throwExceptionFor` builds NO `TranslationResult`; it constructs a
    // `MissingTranslationException` instead, and THAT constructor
    // (`MissingTranslationException.java:153`) runs the same attempted-locale validation. So a
    // throwing handler reaches a validation site the default handler never does, and a differential
    // that only ever used the default handler would gate two of the three sites and call it three.
    if (handlerSpec.equals("throw"))
      builder = builder.translationFailureHandler(failure -> TranslationFailureResponse.throwException());

    return builder.build();
  }

  /** Tabs and newlines are the transport; nothing that carries them may reach the wire raw. */
  static String flatten(String value) {
    if (value == null) return "null";
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
  }
}
