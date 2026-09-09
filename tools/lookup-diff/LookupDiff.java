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
 *       space look more complete than it is. TEN of them produce refusals this tool can observe,
 *       and all ten are driven here — {@code run.mjs}'s {@code DESCRIPTIONS} is the closed list and
 *       this comment must not restate a shorter one. FOUR are on the lookup/matcher axis: the
 *       per-call {@code Locale override} ({@code TranslationOptions.java:73/310}), the ambient
 *       {@code localeSupplier result} ({@code DefaultStrings.java:2457}), the matcher's
 *       {@code Requested locale} ({@code LocaleMatcher.java:64}), and the walk's own
 *       {@code Attempted locale} ({@code TranslationResult.java:116},
 *       {@code MissingTranslationException.java:153}). THREE are at CONSTRUCTION
 *       ({@code DefaultStrings.java:248}, {@code :276}, {@code :347}) and THREE at INSPECTION
 *       ({@code :2713}, {@code :2735}, {@code :2736}), driven by the {@code illformed-*} catalog
 *       sets and by the four keyless inspection shapes respectively.
 *       <p>THREE MORE SIT ON A LOOKUP'S PATH AND STAY SILENT IN JAVA only because an ingress check
 *       fires first — {@code TranslationResult.java:109} and {@code :111}, and
 *       {@code MissingTranslationException.java:146} — so a port WITHOUT the ingress checks has
 *       three further Java diagnostics that could surface where Java's never do.
 *       <p>{@code LocaleMatchResult.java:97} AND {@code :117} WERE LISTED HERE AS SILENT AND THAT WAS
 *       TRUE OF A LOOKUP AND FALSE OF THE CLASS. That constructor is PUBLIC and documented as public
 *       ({@code LocaleMatchResult.java:65-80}), so {@code Selected locale}, {@code Fallback locale}
 *       ({@code :101}) and {@code Considered locale} are caller-facing through it and through the
 *       port's {@code forLocaleMatch} / {@code localeMatchResolver} / per-call {@code localeMatch}
 *       surfaces. The port had NO counterpart for any of the three until 2026-09-09 and accepted all
 *       three ill-formed inputs. This tool still does not drive them — it has no supplied-match
 *       shape — and saying so is the point: probing only the per-call ingress would have gated one
 *       of the four observable sites and said nothing about the others, which is the "probe space
 *       derived from the thing under test" trap at ingress rather than at tag level, and the
 *       supplied-match surface is where that trap bit a second time. {@code
 *       test/supplied-match-ingress.test.js} is its whole enforcement.
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
 * sides refuse for DIFFERENT reasons is one too. Then one {@code P} line per probe carrying ELEVEN
 * SEVEN-field outcomes: the cross of three keys and the two lookup ingresses, then the keyless
 * matcher ingress, then the four inspection ingresses.
 *
 * <p>THE SEVENTH FIELD IS THE CALL TRACE and it is new — the outcomes were six fields until
 * 2026-09-09, and six fields are an OUTCOME. See {@link #TRACE} for the measurement that says an
 * outcome is not enough: two libraries reached the same refusal for {@code en-x-lvariant-NY} by
 * running a walk and by never starting one, and every field this oracle printed agreed.
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
 *
 * <p>AND UNTIL 2026-09-09 THAT MEASUREMENT STILL STOOD, because the fix had been made on this side
 * only: the class and message were emitted in separate fields here and {@code run.mjs} kept the
 * class, dropped the message, and compared the BUILT/REFUSED boolean. The refusal is now compared
 * through the same {@code agree} and {@code KNOWN_DIVERGENCES} machinery a lookup's is, and the
 * three ablations that delete one construction check each are all caught — one as a set the port
 * BUILDS and Java refuses, two as construction rows whose port message names the wrong check. A fix
 * to the oracle half of a differential is half a fix.
 *
 * <p>ONE MORE TRAP LIVED IN THE CATALOG SETS THEMSELVES, and it is the {@code zh-123} shape inside
 * the probe space built to gate {@code :276}: catalogs were parsed by
 * {@code LocalizedStringLoader.parse(stream, locale, name)}, which validates its own locale argument
 * at {@code LocalizedStringLoader.java:1165} with the description {@code "Locale"} — so the
 * {@code illformed-catalog} set was refused by the LOADER and never reached {@code :276}. Both
 * sides refused, the boolean matched, and the set proved nothing. See {@code parseLocaleFor}.
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

  /**
   * A WELL-FORMED locale no catalog set loads, used as the SOURCE of the inspection ordering probe.
   *
   * <p>It is what turns {@code getMissingKeys} into a test of Java's CHECK ORDER rather than of its
   * refusals: {@code :2735} and {@code :2736} validate BOTH locales for well-formedness before
   * {@code :2738} asks whether the source is supported, so {@code getMissingKeys(de, en__NY)} must
   * answer about the TARGET's well-formedness and not about the source's absence. A port that
   * resolved source-then-target answers the other one, and no boolean anywhere else can see it.
   */
  static final Locale UNSUPPORTED_PROBE = Locale.forLanguageTag("de");

  /**
   * A locale that is ILL-FORMED as a {@code Locale} — {@code de__XX}, whose two-character variant
   * {@code Locale.Builder} will not take back — used as the TARGET of the source-first probe.
   *
   * <p>It is what separates {@code :2735} from {@code :2736}. With one ill-formed argument either
   * check could be the one that answered; with the PROBE TAG in the source role and this constant in
   * the target role, a tag that is itself ill-formed must answer about the SOURCE and every other
   * tag must answer about the TARGET. Deleting the source check alone leaves both answers naming
   * the target, and nothing else in this tool can see it — measured.
   */
  static final Locale ILL_FORMED_PROBE = Locale.forLanguageTag("de-x-lvariant-XX");

  /**
   * THE CALL TRACE — what the {@code TranslationFallbackPolicy} and the
   * {@code TranslationFailureHandler} were actually handed, in order, for the probe currently
   * running.
   *
   * <p>WHY IT EXISTS. The six outcome fields this oracle printed before are an OUTCOME, and two
   * libraries can reach the same outcome by running completely different walks. That is not
   * hypothetical here — it is how the ingress defect hid: for {@code en-x-lvariant-NY} Java records
   * NO calls at all, because {@code TranslationOptions.Builder#locale} refuses at
   * {@code TranslationOptions.java:310} and the walk never starts, while the port ran a whole walk
   * with five callback invocations and then refused from inside it. Both refused, both raised the
   * same class, both carried the same sentence, and {@code run.mjs}'s {@code agree} was therefore
   * clean. The walk was observable and nothing observed it.
   *
   * <p>RECORDED ON EVERY INSTANCE, not only the throwing ones. A policy that DELEGATES to
   * {@code fallbackOnMissingTranslationOrNoMatchingAlternative()} and a handler that returns
   * {@code returnKey()} are behaviourally identical to the defaults {@code DefaultStrings:472-475}
   * installs when neither is supplied, so the trace is a pure observation: every outcome field this
   * oracle emitted before these callbacks existed is unchanged, which was verified by running the
   * differential across the change.
   *
   * <p>THE ENCODING is one entry per call, {@code ;}-joined, each entry {@code |}-separated:
   *
   * <pre>
   *   P|REASON|attemptedLocale.toLanguageTag()|causeClass
   *   H|REASON|lookupLocale.toLanguageTag()|attempted~attempted~…|causeClass
   * </pre>
   *
   * <p>with {@code -} for an absent cause and for an empty attempted list. The CAUSE CLASS is the
   * one field {@code run.mjs} may not compare verbatim — JavaScript cannot spell
   * {@code java.lang.IllegalArgumentException} — so it travels fully qualified and is compared
   * through the same {@code ERROR_NAME} table a thrown outcome's class is. Every other field is
   * compared byte for byte.
   */
  static final List<String> TRACE = new ArrayList<>();

  /**
   * Runs one probe with a FRESH trace and appends the trace as the outcome's seventh field.
   *
   * <p>The clear happens here rather than inside each probe method so that a probe that throws
   * before it records anything still emits an empty trace rather than the previous probe's — which
   * is the exact observation that matters, since {@code calls=[]} is the evidence an ingress check
   * fired before the walk started.
   */
  static String traced(java.util.function.Supplier<String> probe) {
    TRACE.clear();
    String outcome = probe.get();
    return outcome + "\t" + (TRACE.isEmpty() ? "-" : String.join(";", TRACE));
  }

  /** A cause's fully-qualified class, or {@code -}. See {@link #TRACE} for why it is not simplified. */
  static String causeOf(Throwable cause) {
    return cause == null ? "-" : cause.getClass().getName();
  }

  public static void main(String[] args) throws Exception {
    List<String> lines = Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8);

    Map<String, Strings> perCall = new LinkedHashMap<>();
    Map<String, Strings> viaAmbient = new LinkedHashMap<>();
    Map<String, Locale> fallbackBySet = new LinkedHashMap<>();
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
          fallbackBySet.put(name, Locale.forLanguageTag(f[2]));
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
        row.append('\t').append(direct == null ? noSet() : traced(() -> perCall(direct, key, tag)));
        row.append('\t').append(indirect == null ? noSet() : traced(() -> ambient(indirect, key, tag)));
      }

      // THE THIRD INGRESS, and it takes no key because it performs no lookup. See `matcher`.
      row.append('\t').append(direct == null ? noSet() : traced(() -> matcher(direct, tag)));

      // THE FOURTH INGRESS — inspection. FOUR outcomes rather than one, because the three Java
      // sites ask different questions and two of them are questions about ORDER. See `keysFor`,
      // `missingFrom`, `missingInto` and `missingSourceFirst` — the last added after this comment
      // was written, which is why it said "three" until 2026-09-09.
      Locale fallback = fallbackBySet.get(setName);
      row.append('\t').append(direct == null ? noSet() : traced(() -> keysFor(direct, tag)));
      row.append('\t').append(direct == null ? noSet() : traced(() -> missingFrom(direct, tag, fallback)));
      row.append('\t').append(direct == null ? noSet() : traced(() -> missingInto(direct, tag)));
      row.append('\t').append(direct == null ? noSet() : traced(() -> missingSourceFirst(direct, tag)));

      out.append(row).append('\n');
    }

    System.out.print(out);
  }

  /** Seven fields, like every traced outcome: the six of the outcome plus an empty trace. */
  static String noSet() {
    return "NOSET\t-\t-\t-\t-\t-\t-";
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

  /**
   * THE INSPECTION INGRESS, part 1 — {@code Strings#getKeysForLocale(Locale)}, whose first statement
   * is {@code requireWellFormed(locale, "Locale")} ({@code DefaultStrings.java:2713}).
   *
   * <p>ADDED BECAUSE NOTHING ANYWHERE DROVE IT. The construction and lookup ingresses were both
   * probed here before inspection was, and inspection is the surface where Java's ORDER — validate,
   * then test support — is observable at all: {@code getKeysForLocale(en__NY)} answers
   * {@code Locale 'en__NY' is not a well-formed IETF BCP 47 locale} where a locale that is merely
   * absent answers {@code Locale 'de' is not supported}. Measured on the pinned Corretto 21 before
   * this shape existed; the port answered the SUPPORT sentence to both, and no gate in either
   * repository could see it — no corpus row reaches an inspection call, and this differential drove
   * lookups only. It goes in THIS tool for the reason the matcher ingress did: same instance, same
   * catalog sets, same tag sweep, same staleness gate.
   *
   * <p>SIX FIELDS like every other outcome. A key set is a sorted list of short identifiers, so it
   * fits one field and the remaining four are padding rather than information.
   */
  static String keysFor(Strings strings, String tag) {
    try {
      return "KEYS\t" + join(strings.getKeysForLocale(Locale.forLanguageTag(tag))) + "\t-\t-\t-\t-";
    } catch (Throwable t) {
      return thrown(t);
    }
  }

  /**
   * THE INSPECTION INGRESS, part 2 — the probe tag in the SOURCE role of
   * {@code getMissingKeys(source, target)} ({@code DefaultStrings.java:2735}, "Source locale").
   *
   * <p>The target is the set's own FALLBACK locale, which every set loads, so the target half can
   * never be what refuses and any refusal here is attributable to the source.
   */
  static String missingFrom(Strings strings, String tag, Locale fallback) {
    try {
      return "MISSING\t" + join(strings.getMissingKeys(Locale.forLanguageTag(tag), fallback))
          + "\t-\t-\t-\t-";
    } catch (Throwable t) {
      return thrown(t);
    }
  }

  /**
   * THE INSPECTION INGRESS, part 3 — the probe tag in the TARGET role, against a source that is
   * well-formed and UNSUPPORTED ({@code DefaultStrings.java:2736}, "Target locale").
   *
   * <p>THIS IS THE ORDER PROBE, not a third copy of the second. Java validates both locales before
   * it tests either for support, so for a tag denoting an ill-formed {@code Locale} the answer must
   * name the TARGET's well-formedness even though the SOURCE is already known to be unsupported;
   * for every other tag it must name the source's absence. One shape, and the partition between its
   * two answers IS the check order. See {@code UNSUPPORTED_PROBE}.
   */
  static String missingInto(Strings strings, String tag) {
    try {
      return "MISSING\t" + join(strings.getMissingKeys(UNSUPPORTED_PROBE, Locale.forLanguageTag(tag)))
          + "\t-\t-\t-\t-";
    } catch (Throwable t) {
      return thrown(t);
    }
  }

  /**
   * THE INSPECTION INGRESS, part 4 — the probe tag in the SOURCE role against a target that is
   * itself ill-formed ({@code ILL_FORMED_PROBE}).
   *
   * <p>THE ORDER OF THE TWO WELL-FORMEDNESS CHECKS, which part 3 cannot see: {@code :2735} runs
   * before {@code :2736}, so a tag denoting an ill-formed {@code Locale} answers about the SOURCE
   * even though the target is ill-formed too, and every other tag answers about the TARGET.
   */
  static String missingSourceFirst(Strings strings, String tag) {
    try {
      return "MISSING\t" + join(strings.getMissingKeys(Locale.forLanguageTag(tag), ILL_FORMED_PROBE))
          + "\t-\t-\t-\t-";
    } catch (Throwable t) {
      return thrown(t);
    }
  }

  /** A key set, in the order the member returned it — Java's {@code TreeSet} order. */
  static String join(Set<String> keys) {
    return keys.isEmpty() ? "-" : String.join(",", keys);
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

  /**
   * A locale the LOADER will accept, for parsing a catalog whose KEY is deliberately ill-formed.
   *
   * <p>The language and region are kept and only the unrepresentable variant is dropped, so the
   * parsed strings are validated under the same plural rules the caller's locale would have used.
   * The map is still keyed by the caller's own locale, which is the input {@code DefaultStrings:276}
   * is being asked about.
   */
  static Locale parseLocaleFor(Locale locale) {
    try {
      new Locale.Builder().setLocale(locale).build();
      return locale;
    } catch (RuntimeException e) {
      return new Locale.Builder().setLanguage(locale.getLanguage()).setRegion(locale.getCountry()).build();
    }
  }

  static Strings buildStrings(String fallbackTag, String tiebreakerSpec, String handlerSpec,
      String catalogSpec, java.util.function.Function<LocaleMatcher, Locale> localeSupplier) {
    Map<Locale, Set<LocalizedString>> byLocale = new LinkedHashMap<>();
    for (String catalog : catalogSpec.split(";;")) {
      String[] parts = catalog.split("::", 2);
      Locale locale = Locale.forLanguageTag(parts[0]);
      byte[] bytes = Base64.getDecoder().decode(parts[1]);
      // PARSED UNDER A WELL-FORMED LOCALE, KEYED BY THE CALLER'S. `LocalizedStringLoader.parse`
      // validates its own locale argument (`LocalizedStringLoader.java:1165`, description "Locale"),
      // so parsing under the ill-formed key made the `illformed-catalog` set refuse at the LOADER
      // and never reach `DefaultStrings:276` at all — the `zh-123` shape, inside the probe space
      // built to gate that site. MEASURED: before this line Java answered `Locale 'en__NY' is not a
      // well-formed IETF BCP 47 locale` there and the port answered `Localized strings locale
      // '…'`, two different sites reading as one refusal while the run compared only BUILT/REFUSED.
      byLocale.put(locale, LocalizedStringLoader.parse(
          new ByteArrayInputStream(bytes), parseLocaleFor(locale), "catalog:" + parts[0]));
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
    //
    // BOTH CALLBACKS ARE NOW ALWAYS INSTALLED, and both are RECORDING DELEGATES rather than
    // behaviour changes. The policy answers exactly what
    // `fallbackOnMissingTranslationOrNoMatchingAlternative()` answers — the default
    // `DefaultStrings:473-475` installs when none is supplied — and the handler answers exactly what
    // `returnKey()` answers (`:472`), except on the sets whose whole purpose is the throwing path.
    // See `TRACE`: the walk is the observation, and a differential that compares only the outcome
    // cannot see two libraries reaching one outcome by two different walks.
    boolean throwing = handlerSpec.equals("throw");

    builder = builder
        .translationFallbackPolicy((reason, attemptedLocale, cause) -> {
          TRACE.add("P|" + reason + "|" + attemptedLocale.toLanguageTag() + "|" + causeOf(cause));
          return reason != TranslationFailureReason.RESOLUTION_FAILURE;
        })
        .translationFailureHandler(failure -> {
          List<String> attempted = new ArrayList<>();
          for (Locale locale : failure.getAttemptedLocales()) attempted.add(locale.toLanguageTag());
          TRACE.add("H|" + failure.getReason()
              + "|" + failure.getLookupLocale().toLanguageTag()
              + "|" + (attempted.isEmpty() ? "-" : String.join("~", attempted))
              + "|" + causeOf(failure.getCause().orElse(null)));
          return throwing ? TranslationFailureResponse.throwException() : TranslationFailureResponse.returnKey();
        });

    return builder.build();
  }

  /** Tabs and newlines are the transport; nothing that carries them may reach the wire raw. */
  static String flatten(String value) {
    if (value == null) return "null";
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
  }
}
