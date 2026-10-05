package com.lokalized;

import com.lokalized.LocalizedString.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * Replays one strings resource per input line through the REAL {@code LocalizedStringLoader.parse}
 * and prints what it did — the exact failure message AND the exception's class, or the sorted key
 * set and the sorted per-key DECODED CONTENT projection, plus every warning the handler was given,
 * in order.
 *
 * The content column ({@code V[...]}) exists because the key set says NOTHING about what was decoded
 * into each key. It is deliberately NOT {@code LocalizedString.toString()}: that routes through
 * {@code DiagnosticRenderer}, which truncates at {@code MAXIMUM_DIAGNOSTIC_CHARACTERS} and inserts
 * reference/cycle markers — a Java-only rendering with no port counterpart, and a truncation that
 * would silently swallow exactly the long values this column exists to compare.
 *
 * The class column ({@code X[...]}) exists because this harness used to catch {@code Exception e}
 * and emit only {@code e.getMessage()}, throwing the class away — the exact shape S31 found in
 * {@code diff:language-range}, where the oracle emitted the class and the runner never read it.
 * Emitted on every ERR row; a bare {@code -} on an OK row.
 *
 * This class sits in {@code com.lokalized} ONLY so the language-form names it prints come from the
 * loader's own {@code LocalizedStringUtils} massaging rather than from a table re-typed here.
 *
 * Nothing here re-reads the grammar or the diagnostics: a disagreement with the JS port is a port
 * defect, not a difference between two readings of the source.
 *
 * Input is TSV: {@code <name>\t<locale>\t<comma-separated loading options>\t<base64 resource bytes>}.
 * Bytes rather than text because it is {@code parse(InputStream, ...)} that owns the byte limits,
 * the aggregate byte budget and the fatal UTF-8 decode.
 *
 * Output is TSV, SIX columns:
 * {@code <name>\t<OK|ERR>\t<keys|message>\tX[<class|->]\tV[<content>]\tW[<warnings>]}.
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
      String errorClass;
      String values;
      try {
        Set<LocalizedString> parsed = LocalizedStringLoader.parse(
            new ByteArrayInputStream(bytes), Locale.forLanguageTag(locale), source, handler,
            options.build());
        List<String> keys = new ArrayList<>();
        List<String> projections = new ArrayList<>();
        for (LocalizedString localizedString : parsed) {
          keys.add(escape(localizedString.getKey()));
          projections.add(project(localizedString.getKey(), localizedString));
        }
        Collections.sort(keys);
        Collections.sort(projections);
        result = "OK\t" + String.join(",", keys);
        // An OK row has no refusal, so it carries no class. A bare `-` rather than an empty column,
        // so a row that lost its class and a row that never had one cannot render alike.
        errorClass = "-";
        values = "V[" + String.join(",", projections) + "]";
      } catch (Exception e) {
        result = "ERR\t" + escape(String.valueOf(e.getMessage()));
        // THE REFUSAL CLASS. `getName()`, not `getSimpleName()`: the runner maps a FULLY QUALIFIED
        // Java class onto the JS name the port raises for it, and two classes in different packages
        // can share a simple name.
        errorClass = escape(e.getClass().getName());
        // Java produced nothing, so there is no content to project.
        values = "V[]";
      }

      out.append(source).append('\t').append(result)
          .append("\tX[").append(errorClass).append(']')
          .append('\t').append(values)
          .append("\tW[").append(escape(String.join(" | ", warnings))).append("]\n");
    }

    System.out.print(out);
  }

  /**
   * The DECODED content of one parsed node, rendered deterministically.
   *
   * An alternative is itself a {@link LocalizedString} whose key is the EXPRESSION, which is why the
   * label is passed in rather than read off the node.
   */
  private static String project(String label, LocalizedString node) {
    StringBuilder rendered = new StringBuilder();
    rendered.append('{').append(escape(label));
    rendered.append(" T=").append(optional(node.getTranslation()));
    rendered.append(" C=").append(optional(node.getCommentary()));

    rendered.append(" P=[");
    boolean first = true;
    for (Map.Entry<String, PlaceholderDefinition> entry : node.getPlaceholderDefinitions().entrySet()) {
      if (!first) rendered.append(',');
      first = false;
      rendered.append(escape(entry.getKey())).append('=').append(projectPlaceholder(entry.getValue()));
    }

    rendered.append("] A=[");
    first = true;
    for (LocalizedString alternative : node.getAlternatives()) {
      if (!first) rendered.append(',');
      first = false;
      rendered.append(project(alternative.getKey(), alternative));
    }

    return rendered.append("]}").toString();
  }

  /**
   * One generated-placeholder definition. The two families are TAGGED so the rendering lines up with
   * the port's own `kind` discriminator instead of being told apart by shape.
   */
  private static String projectPlaceholder(PlaceholderDefinition definition) {
    if (definition instanceof LanguageFormTranslation) {
      LanguageFormTranslation languageFormTranslation = (LanguageFormTranslation) definition;
      StringBuilder rendered = new StringBuilder("LF{V=")
          .append(optional(languageFormTranslation.getValue())).append(" R=");

      if (languageFormTranslation.getRange().isPresent()) {
        LanguageFormTranslationRange range = languageFormTranslation.getRange().get();
        rendered.append('<').append(escape(range.getStart())).append(">..<")
            .append(escape(range.getEnd())).append('>');
      } else {
        rendered.append('-');
      }

      rendered.append(" T=[");
      boolean first = true;
      for (Map.Entry<LanguageForm, String> entry
          : languageFormTranslation.getTranslationsByLanguageForm().entrySet()) {
        if (!first) rendered.append(',');
        first = false;
        rendered.append(escape(languageFormName(entry.getKey()))).append("=<")
            .append(escape(entry.getValue())).append('>');
      }
      return rendered.append("]}").toString();
    }

    if (definition instanceof ExpressionTranslation) {
      ExpressionTranslation expressionTranslation = (ExpressionTranslation) definition;
      StringBuilder rendered = new StringBuilder("EX{T=<")
          .append(escape(expressionTranslation.getTranslation())).append("> A=[");
      boolean first = true;
      for (ExpressionAlternative alternative : expressionTranslation.getAlternatives()) {
        if (!first) rendered.append(',');
        first = false;
        rendered.append('<').append(escape(alternative.getExpression())).append(">=><")
            .append(escape(alternative.getTranslation())).append('>');
      }
      return rendered.append("]}").toString();
    }

    throw new IllegalStateException("unhandled placeholder definition type: " + definition.getClass().getName());
  }

  /** Absent renders as a bare {@code -}, so a value that IS "-" renders differently, as {@code <->}. */
  private static String optional(Optional<String> value) {
    return value.isPresent() ? "<" + escape(value.get()) + ">" : "-";
  }

  /**
   * The localized-strings-file name of a language form, taken from the loader's OWN massaging
   * functions rather than a prefix table re-typed here.
   */
  private static String languageFormName(LanguageForm languageForm) {
    String name = LANGUAGE_FORM_NAMES.get(languageForm);
    if (name == null) throw new IllegalStateException("unnamed language form: " + languageForm);
    return name;
  }

  private static final Map<LanguageForm, String> LANGUAGE_FORM_NAMES = languageFormNames();

  private static Map<LanguageForm, String> languageFormNames() {
    Map<LanguageForm, String> names = new LinkedHashMap<>();
    for (Gender form : Gender.values())
      names.put(form, LocalizedStringUtils.localizedStringNameForGenderName(form.name()));
    for (GrammaticalCase form : GrammaticalCase.values())
      names.put(form, LocalizedStringUtils.localizedStringNameForGrammaticalCaseName(form.name()));
    for (Definiteness form : Definiteness.values())
      names.put(form, LocalizedStringUtils.localizedStringNameForDefinitenessName(form.name()));
    for (Classifier form : Classifier.values())
      names.put(form, LocalizedStringUtils.localizedStringNameForClassifierName(form.name()));
    for (Formality form : Formality.values())
      names.put(form, LocalizedStringUtils.localizedStringNameForFormalityName(form.name()));
    for (Clusivity form : Clusivity.values())
      names.put(form, LocalizedStringUtils.localizedStringNameForClusivityName(form.name()));
    for (Animacy form : Animacy.values())
      names.put(form, LocalizedStringUtils.localizedStringNameForAnimacyName(form.name()));
    for (Cardinality form : Cardinality.values())
      names.put(form, LocalizedStringUtils.localizedStringNameForCardinalityName(form.name()));
    for (Ordinality form : Ordinality.values())
      names.put(form, LocalizedStringUtils.localizedStringNameForOrdinalityName(form.name()));
    for (Phonetic form : Phonetic.values())
      names.put(form, LocalizedStringUtils.localizedStringNameForPhoneticName(form.name()));
    return names;
  }

  /**
   * Every rendered value is escaped for the row format BEFORE it is written: a tab would otherwise
   * invent a column ({@code raw-tab-in-string} proves one can reach a string), and the backslash is
   * escaped first so an escaped newline in the source cannot render as a real one.
   */
  private static String escape(String value) {
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
  }
}
