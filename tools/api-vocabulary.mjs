// The maintainer chose shared cross-port names before 1.0.0 on 2026-09-30
// Adapt the frozen pre-release plan vocabulary when checking today's public API
// Requirement IDs and behavioral vectors stay intact; catalog input now comes from a supplier
export const API_RENAMES = Object.freeze({
  localeMatch: "localeMatchResult",
  StringsLoadingError: "LocalizedStringLoadingError",
  TranslationStatus: "TranslationResultStatus",
  LanguageFormValue: "LanguageForm",
  PhoneticValue: "Phonetic",
  CardinalityValue: "Cardinality",
  OrdinalityValue: "Ordinality",
  localeResolver: "localeSupplier",
  localeMatchResolver: "localeMatchSupplier",
  tiebreakers: "tiebreakerLocalesByLanguageCode",
  onFailure: "translationFailureHandler",
  fallbackPolicy: "translationFallbackPolicy",
  onWarning: "warningHandler",
  onFallback: "translationFallbackObserver",
  FailureReason: "TranslationFailureReason",
  FailureResponse: "TranslationFailureResponse",
  FailureHandler: "TranslationFailureHandler",
  FallbackPolicy: "TranslationFallbackPolicy",
  BuiltinFallbackPolicy: "BuiltinTranslationFallbackPolicy",
  FallbackEvent: "TranslationFallbackEvent",
  FallbackObserver: "TranslationFallbackObserver",
  TranslationCallOptions: "TranslationOptions",
  LocaleMatcher: "DirectLocaleMatcher",
  LocaleNegotiator: "LocaleMatcher",
  createLocaleNegotiator: "createLocaleMatcher",
});

const names = new RegExp(`\\b(${Object.keys(API_RENAMES).join("|")})\\b`, "g");

export function currentApiVocabulary(contract) {
  const current = JSON.stringify(contract).replace(names, name => API_RENAMES[name]);
  // The catalog source is now a construction-time supplier, matching Java's callback shape
  return JSON.parse(current.replace(/`DirectCreateStringsOptions` requires a readonly `strings` of type `CatalogMap`/g,
    "`DirectCreateStringsOptions` requires a readonly `localizedStringSupplier` of type `() => CatalogMap`"));
}
