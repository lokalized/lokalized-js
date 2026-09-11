// @ts-check

/**
 * lokalized/node — directory/filesystem loading and manifest generation.
 *
 * TWO DOORS ONTO ONE DIRECTORY, and the difference is which specification they answer to.
 * `readStringsFromDirectory` is the port of Java's `LocalizedStringLoader.loadFromFilesystem`: no
 * manifest, no digest, no catalog version, all-or-nothing, and arbitrated by 145 corpus cases. The
 * manifest-mediated loaders here are plan 6.2's own design — a manifest, a digest per file, a catalog
 * identity, and a partial-failure policy — and Java has no counterpart to any of it.
 *
 * Keeping both is blocker B3's answer as it was actually settled: the raw door is what the corpus can
 * arbitrate, and the manifest door is what a browser's `loadStrings` composes with. Collapsing them
 * would mean either adapting the corpus inside the runner (how a real exactness defect was absorbed
 * here during M4) or losing the one family of M8 clauses that has a live oracle.
 *
 * See IMPLEMENTATION-PLAN-v7.md section 3.1 for the canonical symbol owners.
 */

/**
 * Plan 6.2's option type for this subpath's loaders, surfaced HERE because a declaration file only
 * carries what its own entry point names — a typedef that lives in an implementation module is
 * invisible to a consumer and to `test/declared-surface.test.js` alike.
 *
 * @typedef {import("./file-loader.js").LoadStringsFromFilesOptions} LoadStringsFromFilesOptions
 */

export { readStringsFromDirectory } from "./directory.js";
export {
  loadEntireManifestFromFiles,
  loadStringsFromFiles,
  readStringsManifest,
} from "./file-loader.js";
