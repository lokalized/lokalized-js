// @ts-check
import { normalizeTag } from "../internal/locale.js";
import { manifestLocaleTag } from "../internal/manifest-locale.js";

/**
 * Manifest-normalization profile 1.1.0: strict JDK parsing followed by a stable
 * private-use-only spelling, so repeated validation and planning agree.
 * @param {string} tag
 * @returns {string}
 */
export function normalizeManifestTag(tag) {
  return manifestLocaleTag(normalizeTag(tag));
}
