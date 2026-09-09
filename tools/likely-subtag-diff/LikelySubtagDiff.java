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
 *   <li>{@code BidiUtils.localeUsesRightToLeftScript} maximizes a script-less tag through the table.
 * </ul>
 *
 * <p>Each answer is emitted as its own field so a divergence names the CONSUMER, not just "the
 * table". Every call is individually guarded: a probe that makes one consumer throw must not cost
 * the run the other four, and "which consumer throws on what" is itself a comparison this tool
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
