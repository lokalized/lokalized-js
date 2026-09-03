package com.lokalized;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;

/**
 * Independent differential oracle for the M6 tokenizer: reads one expression per line (as JSON
 * strings, so control characters survive) and emits the real Java token sequence or the real Java
 * error message. Nothing here interprets the grammar — it calls ExpressionTokenizer directly.
 */
public final class TokenDiff {
  public static void main(String[] args) throws Exception {
    ExpressionTokenizer tokenizer = new ExpressionTokenizer();
    StringBuilder out = new StringBuilder();
    for (String line : Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8)) {
      if (line.isEmpty()) continue;
      String expression = unquote(line);
      out.append('{').append("\"in\":").append(line).append(',');
      try {
        List<Token> tokens = tokenizer.extractTokens(expression);
        out.append("\"ok\":true,\"tokens\":[");
        for (int i = 0; i < tokens.size(); i++) {
          if (i > 0) out.append(',');
          Token token = tokens.get(i);
          out.append('"').append(token.getTokenType().name());
          if (token.getSymbol() != null) out.append(':').append(escape(token.getSymbol()));
          out.append('"');
        }
        out.append(']');
      } catch (RuntimeException e) {
        out.append("\"ok\":false,\"error\":\"").append(escape(e.getMessage())).append('"');
      }
      out.append("}\n");
    }
    Files.writeString(Paths.get(args[1]), out.toString(), StandardCharsets.UTF_8);
    System.err.println("tokenized " + out.toString().split("\n").length + " inputs");
  }

  private static String unquote(String json) {
    StringBuilder sb = new StringBuilder();
    for (int i = 1; i < json.length() - 1; i++) {
      char c = json.charAt(i);
      if (c != '\\') { sb.append(c); continue; }
      char n = json.charAt(++i);
      switch (n) {
        case 'n': sb.append('\n'); break;  case 't': sb.append('\t'); break;
        case 'r': sb.append('\r'); break;  case 'b': sb.append('\b'); break;
        case 'f': sb.append('\f'); break;  case '"': sb.append('"'); break;
        case '\\': sb.append('\\'); break; case '/': sb.append('/'); break;
        case 'u': sb.append((char) Integer.parseInt(json.substring(i + 1, i + 5), 16)); i += 4; break;
        default: sb.append(n);
      }
    }
    return sb.toString();
  }

  private static String escape(String text) {
    if (text == null) return "";
    StringBuilder sb = new StringBuilder();
    for (char c : text.toCharArray()) {
      if (c == '"' || c == '\\') sb.append('\\').append(c);
      else if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
      else sb.append(c);
    }
    return sb.toString();
  }
}
