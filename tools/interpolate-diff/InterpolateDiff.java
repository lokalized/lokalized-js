package com.lokalized;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Independent differential oracle for the M5b escape grammar and bidi isolation.
 *
 * Reads a JSON-string-per-line input file whose lines are tagged by section and calls the real
 * package-private machinery directly: `StringInterpolator.interpolate` in its LENIENT mode (the one
 * `DefaultStrings.interpolateFailureKey` uses), `BidiUtils.isolate`, and
 * `BidiUtils.localeUsesRightToLeftScript`. Nothing here reinterprets a rule.
 *
 * Both mechanisms are ports of code whose behavior is easy to describe wrongly: the escape branch
 * scans forward to the NEXT closing delimiter rather than a matching one, and `isolate` repairs
 * unbalanced isolate structure while copying. A second reading of the source is not an oracle.
 */
public final class InterpolateDiff {
  public static void main(String[] args) throws Exception {
    Map<String, Object> context = new HashMap<>();
    context.put("name", "Ada");
    context.put("realName", "Ada");
    context.put("esc", "ESCVAL");
    context.put("a", "AVAL");
    context.put("x", "XVAL");
    context.put("empty", "");
    context.put("zero", 0);
    context.put("nul", null);

    StringInterpolator interpolator = new StringInterpolator();
    StringBuilder out = new StringBuilder();
    List<String> lines = Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8);

    for (String line : lines) {
      if (line.isEmpty()) continue;
      int tab = line.indexOf('\t');
      String section = line.substring(0, tab);
      String quoted = line.substring(tab + 1);
      String input = unquote(quoted);

      out.append("{\"section\":\"").append(section).append("\",\"in\":").append(quoted).append(',');
      try {
        switch (section) {
          case "lenient":
            out.append("\"ok\":true,\"out\":").append(quote(interpolator.interpolate(input, context)));
            break;
          case "isolate":
            out.append("\"ok\":true,\"out\":").append(quote(BidiUtils.isolate(input)));
            break;
          case "rtl":
            out.append("\"ok\":true,\"out\":")
                .append(BidiUtils.localeUsesRightToLeftScript(Locale.forLanguageTag(input))
                    ? "\"true\"" : "\"false\"");
            break;
          default:
            throw new IllegalArgumentException("unknown section " + section);
        }
      } catch (RuntimeException e) {
        out.append("\"ok\":false,\"error\":").append(quote(e.getClass().getSimpleName()));
      }
      out.append("}\n");
    }

    Files.write(Paths.get(args[1]), out.toString().getBytes(StandardCharsets.UTF_8));
  }

  private static String unquote(String jsonString) {
    StringBuilder value = new StringBuilder();
    for (int i = 1; i < jsonString.length() - 1; ++i) {
      char c = jsonString.charAt(i);
      if (c != '\\') {
        value.append(c);
        continue;
      }
      char next = jsonString.charAt(++i);
      switch (next) {
        case 'n': value.append('\n'); break;
        case 't': value.append('\t'); break;
        case 'r': value.append('\r'); break;
        case 'b': value.append('\b'); break;
        case 'f': value.append('\f'); break;
        case 'u':
          value.append((char) Integer.parseInt(jsonString.substring(i + 1, i + 5), 16));
          i += 4;
          break;
        default: value.append(next);
      }
    }
    return value.toString();
  }

  private static String quote(String value) {
    StringBuilder quoted = new StringBuilder("\"");
    for (int i = 0; i < value.length(); ++i) {
      char c = value.charAt(i);
      if (c == '"' || c == '\\') quoted.append('\\').append(c);
      else if (c < 0x20 || c > 0x7e) quoted.append(String.format("\\u%04x", (int) c));
      else quoted.append(c);
    }
    return quoted.append('"').toString();
  }
}
