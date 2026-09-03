import com.lokalized.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * Replays one strings resource per input line through the REAL {@code LocalizedStringLoader.parse}
 * and prints what it did — the exact failure message, or the sorted key set plus every warning the
 * handler was given, in order.
 *
 * Nothing here re-reads the grammar or the diagnostics: a disagreement with the JS port is a port
 * defect, not a difference between two readings of the source.
 *
 * Input is TSV: {@code <name>\t<locale>\t<comma-separated loading options>\t<base64 resource bytes>}.
 * Bytes rather than text because it is {@code parse(InputStream, ...)} that owns the byte limits,
 * the aggregate byte budget and the fatal UTF-8 decode.
 */
public class ParseDiff {
  public static void main(String[] args) throws Exception {
    List<String> lines = Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8);
    StringBuilder out = new StringBuilder();

    for (String line : lines) {
      if (line.isEmpty()) continue;

      String[] parts = line.split("\t", 4);
      String source = parts[0];
      String locale = parts[1];
      byte[] bytes = Base64.getDecoder().decode(parts[3]);

      LocalizedStringLoadingOptions.Builder options = LocalizedStringLoadingOptions.builder();

      for (String option : parts[2].split(",")) {
        if (option.isEmpty()) continue;
        String[] pair = option.split("=");
        switch (pair[0]) {
          case "maximumInputBytes": options.maximumInputBytes(Integer.parseInt(pair[1])); break;
          case "maximumReaderCharacters": options.maximumReaderCharacters(Integer.parseInt(pair[1])); break;
          case "maximumJsonNestingDepth": options.maximumJsonNestingDepth(Integer.parseInt(pair[1])); break;
          case "maximumTotalInputBytes": options.maximumTotalInputBytes(Long.parseLong(pair[1])); break;
          case "maximumLocalizedStringsFiles": options.maximumLocalizedStringsFiles(Integer.parseInt(pair[1])); break;
          case "maximumTranslationNodes": options.maximumTranslationNodes(Integer.parseInt(pair[1])); break;
          case "maximumWarnings": options.maximumWarnings(Integer.parseInt(pair[1])); break;
          default: throw new IllegalArgumentException("unknown loading option: " + pair[0]);
        }
      }

      // Warnings are collected rather than ignored: WHICH warnings reached the handler before a
      // failure is the observable that a port emitting them in a later pass gets wrong.
      List<String> warnings = new ArrayList<>();
      LocalizedStringWarningHandler handler = warning -> warnings.add(warning.getMessage());

      String result;
      try {
        Set<LocalizedString> parsed = LocalizedStringLoader.parse(
            new ByteArrayInputStream(bytes), Locale.forLanguageTag(locale), source, handler,
            options.build());
        List<String> keys = new ArrayList<>();
        for (LocalizedString localizedString : parsed) keys.add(localizedString.getKey());
        Collections.sort(keys);
        result = "OK\t" + String.join(",", keys);
      } catch (Exception e) {
        result = "ERR\t" + e.getMessage();
      }

      out.append(source).append('\t').append(result.replace("\n", "\\n"))
          .append("\tW[").append(String.join(" | ", warnings).replace("\n", "\\n")).append("]\n");
    }

    System.out.print(out);
  }
}
