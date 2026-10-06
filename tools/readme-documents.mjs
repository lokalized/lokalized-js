// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Both documents retain their executable examples and checked prose. */
export const README_DOCUMENTS = ["README.md", "Documentation/JAVASCRIPT-GUIDE.md"];

/** @param {string} root */
export const readDocumentation = (root) =>
  README_DOCUMENTS.map((path) => readFileSync(join(root, path), "utf8")).join("\n\n");
