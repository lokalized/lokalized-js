// @ts-check
/**
 * Give an already JDK-projected tag the stable manifest-profile spelling.
 * This pure wire projection carries no parser, locale data or planning kernel.
 * Core Locale/JDK projections retain their separate historical behavior.
 * @param {string} projected
 * @returns {string}
 */
export function manifestLocaleTag(projected) {
  return projected.startsWith("und-x-") ? projected.slice(4) : projected;
}
