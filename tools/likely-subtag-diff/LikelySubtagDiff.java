package com.lokalized;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * The Java side of {@code tools/likely-subtag-diff/run.mjs}.
 *
 * <p>It answers, for one probe string, every question the pinned CLDR likely-subtag table is
 * consulted to answer inside {@code lokalized-java}. There are exactly TWO reads of
 * {@code CldrLocaleData.LIKELY_SUBTAGS_BY_TAG} in the whole reference implementation —
 * {@code likelySubtagFor} ({@code CldrLocaleData.java:189}) and {@code preferredRegionAlias}
 * ({@code :358}) — and this probe reaches both:
 *
 * <ul>
 *   <li>{@code likelySubtagFor} and {@code languageScriptForLikelySubtag} read the table directly;
 *   <li>{@code canonicalLanguageTag} reaches {@code preferredRegionAlias}, which is the ONLY way the
 *       second read is observable: a deprecated region subtag with more than one CLDR replacement
 *       (there are 23) picks the replacement whose likely subtag matches;
 *   <li>{@code fallbackLocalesFor} consults the table through {@code crossesLikelyScriptBoundary},
 *       which stops subtag truncation at a likely-script boundary;
 *   <li>{@code BidiUtils.localeUsesRightToLeftScript} maximizes a script-less tag through the table;
 *   <li>{@code jdkScript} and {@code bidiScript} are the two string-valued intermediates that last
 *       boolean collapses into one bit — the script BEFORE the maximizing branch, and the script
 *       AFTER it.
 * </ul>
 *
 * <p>Each answer is emitted as its own field so a divergence names the CONSUMER, not just "the
 * table". Every call is individually guarded: a probe that makes one consumer throw must not cost
 * the run the other six, and "which consumer throws on what" is itself a comparison this tool
 * makes.
 *
 * <p>One JSON object per line, no JSON dependency — every value is a tag, a boolean, or a
 * {@code THROWS:} marker.
 */
public final class LikelySubtagDiff {
  public static void main(String[] args) throws IOException {
    List<String> probes = new ArrayList<>();
    for (String line : Files.readAllLines(Path.of(args[0]), StandardCharsets.UTF_8)) {
      if (line.isEmpty()) continue;
      probes.add(unquote(line));
    }

    StringBuilder out = new StringBuilder();
    for (String probe : probes) {
      out.append("{\"tag\":").append(quote(probe))
          .append(",\"wellFormed\":").append(wellFormed(probe))
          .append(",\"likelySubtag\":")
          .append(quote(call(() -> optional(CldrLocaleData.likelySubtagFor(probe)))))
          .append(",\"languageScript\":")
          .append(quote(call(() -> optional(CldrLocaleData.languageScriptForLikelySubtag(probe)))))
          .append(",\"canonicalTag\":")
          .append(quote(call(() -> CldrLocaleData.canonicalLanguageTag(probe))))
          .append(",\"fallbackChain\":").append(quote(call(() -> fallbackChain(probe))))
          .append(",\"rightToLeft\":").append(quote(call(() -> rightToLeft(probe))))
          .append(",\"jdkScript\":").append(quote(call(() -> jdkScript(probe))))
          .append(",\"bidiScript\":").append(quote(call(() -> bidiScript(probe))))
          .append("}\n");
    }

    Files.writeString(Path.of(args[1]), out.toString(), StandardCharsets.UTF_8);
  }

  /**
   * The JDK's own well-formedness oracle, so this differential never invents a boundary of its own.
   * Same construction as {@code tools/direct-tag-diff/DirectTagDiff.java}, deliberately: two tools
   * that scope a verdict to "well-formed" must scope it identically.
   */
  private static boolean wellFormed(String probe) {
    try {
      new Locale.Builder().setLanguageTag(probe);
      return true;
    } catch (RuntimeException e) {
      return false;
    }
  }

  /**
   * {@code CldrLocaleData.fallbackLocalesFor} rendered as a {@code |}-joined tag list.
   *
   * <p>It takes a {@code Locale}, not a tag, so the probe string goes through
   * {@code Locale.forLanguageTag} first — which is what every caller inside the library does, and
   * what {@code tools/direct-tag-diff/} has already proven the port's {@code normalizeTag}
   * reproduces. Feeding it a raw string would be measuring {@code forLanguageTag} a second time
   * instead of measuring this consumer.
   */
  private static String fallbackChain(String probe) {
    List<Locale> locales = CldrLocaleData.fallbackLocalesFor(Locale.forLanguageTag(probe));
    StringBuilder joined = new StringBuilder();
    for (Locale locale : locales) {
      if (joined.length() > 0) joined.append('|');
      joined.append(locale.toLanguageTag());
    }
    return joined.toString();
  }

  private static String rightToLeft(String probe) {
    return String.valueOf(BidiUtils.localeUsesRightToLeftScript(Locale.forLanguageTag(probe)));
  }

  /**
   * {@code Locale#getScript()} — the FIRST of the two string-valued intermediates that
   * {@code BidiUtils.java:54-61} collapses into the boolean above, emitted so it can be compared on
   * its own.
   *
   * <p>WHY THE BOOLEAN IS NOT A COMPARISON OF THIS. {@code localeUsesRightToLeftScript} ends in
   * {@code CldrLocaleData.isRightToLeftScript(script)}, a set-membership test over lowercased
   * script codes, so it partitions this string into exactly two classes. Every difference INSIDE a
   * class — {@code Latn} against {@code latn}, {@code Latn} against {@code Cyrl}, {@code Arab}
   * against {@code Hebr} — is erased before the column sees it. The port's model of this field
   * ({@code locale-jdk-tag.js parseJdkTag(...).script}) is read verbatim by {@code bidi.js} and
   * {@code plural.js} and through {@code renderJdkTag} by every other {@code JdkTagParts}
   * consumer, and nothing in this differential compared it except through that two-valued
   * collapse.
   *
   * <p>Deliberately the RAW probe, not a round-tripped tag: {@code Locale.forLanguageTag} is what
   * normalizes the script's case here, and handing the port a tag that had already been through its
   * own renderer would launder exactly the defects this column exists to catch.
   */
  private static String jdkScript(String probe) {
    return Locale.forLanguageTag(probe).getScript();
  }

  /**
   * The script that actually reaches {@code CldrLocaleData.isRightToLeftScript} — the SECOND
   * intermediate, after the maximizing branch has or has not fired.
   *
   * <p>A line-for-line mirror of {@code BidiUtils.java:54-61} rather than a paraphrase: the same
   * {@code Locale}, the same {@code likelySubtagFor(Locale)} overload (which is
   * {@code likelySubtagFor(locale.toLanguageTag())}, {@code CldrLocaleData.java:173-177} — a
   * DIFFERENT input from the raw probe the {@code likelySubtag} column compares), and the same
   * second {@code Locale.forLanguageTag(...).getScript()} on the maximized tag.
   *
   * <p>It is a copy of {@code jdkScript} on every probe carrying an explicit script; the rows where
   * it is not are the ones the runner counts and gates.
   */
  private static String bidiScript(String probe) {
    Locale locale = Locale.forLanguageTag(probe);
    String script = locale.getScript();

    if (script.length() == 0) {
      Optional<String> likelySubtag = CldrLocaleData.likelySubtagFor(locale);

      if (likelySubtag.isPresent())
        script = Locale.forLanguageTag(likelySubtag.get()).getScript();
    }

    return script;
  }

  private static String optional(Optional<String> value) {
    return value.isPresent() ? value.get() : " none";
  }

  private static String call(Answer answer) {
    try {
      return answer.get();
    } catch (RuntimeException | StackOverflowError e) {
      return " THROWS:" + e.getClass().getName();
    }
  }

  @FunctionalInterface
  private interface Answer {
    String get();
  }

  /** The Node side writes each probe as a JSON string on its own line. */
  private static String unquote(String line) {
    StringBuilder value = new StringBuilder();
    for (int index = 1; index < line.length() - 1; ++index) {
      char character = line.charAt(index);
      if (character != '\\') {
        value.append(character);
        continue;
      }
      char escape = line.charAt(++index);
      switch (escape) {
        case 'n' -> value.append('\n');
        case 't' -> value.append('\t');
        case 'r' -> value.append('\r');
        case 'b' -> value.append('\b');
        case 'f' -> value.append('\f');
        case 'u' -> {
          value.append((char) Integer.parseInt(line.substring(index + 1, index + 5), 16));
          index += 4;
        }
        default -> value.append(escape);
      }
    }
    return value.toString();
  }

  private static String quote(String value) {
    StringBuilder quoted = new StringBuilder("\"");
    for (int index = 0; index < value.length(); ++index) {
      char character = value.charAt(index);
      if (character == '"' || character == '\\') quoted.append('\\').append(character);
      else if (character < 0x20 || Character.isSurrogate(character))
        quoted.append(String.format("\\u%04x", (int) character));
      else quoted.append(character);
    }
    return quoted.append('"').toString();
  }
}
