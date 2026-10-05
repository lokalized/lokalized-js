package com.lokalized;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Independent differential oracle for the M6 tokenizer: reads one expression per line (as JSON
 * strings, so control characters survive) and emits the real Java token sequence or the real Java
 * error message. Nothing here interprets the grammar — it calls ExpressionTokenizer directly.
 *
 * Two row shapes, discriminated by `kind`: exactly one `inventory` preamble row describing
 * `TokenType` itself, then one `probe` row per input.
 */
public final class TokenDiff {
  public static void main(String[] args) throws Exception {
    ExpressionTokenizer tokenizer = new ExpressionTokenizer();
    StringBuilder out = new StringBuilder();

    // THE ORACLE'S OWN INVENTORY, DERIVED FROM JAVA RATHER THAN RESTATED BY HAND.
    //
    // The per-input loop below can only observe a token type that some probe actually PRODUCES.
    // Measured on this probe set: 373 probes produce 30 of Java's 74 declared token types, so 44 are
    // invisible to every comparison this tool made before — a type added, dropped, renamed or bound
    // to the wrong symbol upstream simply does not appear. The port's three tables are hand-
    // maintained (`src/internal/expression-tokenizer.js:48-123` names, `:286-298` symbols,
    // `:306-312` the reverse map) and the reverse map is what decides whether a matched identifier
    // becomes a language-form constant at all (`:479-483`), so it is worth comparing directly rather
    // than hoping a probe spells it.
    //
    // `TokenType` is a package-private enum in this same package, so this needs no reflection and no
    // API change: `values()`, `getSymbol()` and `getTokenTypesBySymbol()` are read as the library
    // itself reads them.
    out.append("{\"kind\":\"inventory\",\"tokenTypes\":[");
    TokenType[] tokenTypes = TokenType.values();
    for (int i = 0; i < tokenTypes.length; i++) {
      if (i > 0) out.append(',');
      out.append('"').append(escape(tokenTypes[i].name())).append('"');
    }
    // DECLARATION ORDER IS PART OF THE ROW, not just membership — `values()` returns it, and the
    // port's alternation is built by walking its own table in the same order
    // (`expression-tokenizer.js:384-403`). Both engines are leftmost-alternative, so that order is
    // behaviour.
    out.append("],\"symbolsByTokenType\":{");
    boolean firstSymbol = true;
    for (TokenType tokenType : tokenTypes) {
      if (!tokenType.getSymbol().isPresent()) continue;
      if (!firstSymbol) out.append(',');
      firstSymbol = false;
      out.append('"').append(escape(tokenType.name())).append("\":\"")
          .append(escape(tokenType.getSymbol().get())).append('"');
    }
    // Sorted only so the emitted row is stable between runs: `getTokenTypesBySymbol()` is a HashMap
    // built through a stream collector, its iteration order is no part of the contract, and the
    // comparison on the other side is key-order-insensitive either way.
    out.append("},\"tokenTypesBySymbol\":{");
    boolean firstBySymbol = true;
    for (Map.Entry<String, TokenType> entry : new TreeMap<>(TokenType.getTokenTypesBySymbol()).entrySet()) {
      if (!firstBySymbol) out.append(',');
      firstBySymbol = false;
      out.append('"').append(escape(entry.getKey())).append("\":\"")
          .append(escape(entry.getValue().name())).append('"');
    }
    out.append("}}\n");

    int probes = 0;
    for (String line : Files.readAllLines(Paths.get(args[0]), StandardCharsets.UTF_8)) {
      if (line.isEmpty()) continue;
      String expression = unquote(line);
      ++probes;
      out.append("{\"kind\":\"probe\",\"in\":").append(line).append(',');
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
        // THE REFUSAL CLASS, WHICH THIS HARNESS HAD IN HAND AND DID NOT PRINT. `e.getMessage()` was
        // emitted and `e.getClass()` was thrown away, which is the exact defect S31 found in
        // `diff:language-range` (oracle emitted the class, runner dropped it) and the mirror of the
        // one found in `diff:lookup` (oracle emitted both, runner dropped the message). Compared on
        // the other side as a MAPPING, not row-against-row — see `run.mjs`'s `JS_CLASS_FOR_JAVA`.
        out.append("\"ok\":false,\"error\":\"").append(escape(e.getMessage())).append('"')
            .append(",\"errorType\":\"").append(escape(e.getClass().getName())).append('"');
      }
      out.append("}\n");
    }
    Files.writeString(Paths.get(args[1]), out.toString(), StandardCharsets.UTF_8);
    // Counted, not inferred from the emitted text: the preamble row made the old
    // `out.toString().split("\n").length` off by one, and a self-reported count that drifts from the
    // thing it describes is the failure mode this repository keeps finding in its own prose.
    System.err.println("tokenized " + probes + " inputs");
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
