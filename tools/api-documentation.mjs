/* Copyright 2026 Revetware LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Application, ReflectionKind, ReferenceType } from "typedoc";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

export const escapeHtml = (text) => String(text).replace(/[&<>"']/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export function editionFor(version, packageVersion) {
  if (version === undefined) return "development";
  if (!SEMVER.test(version)) throw new Error("--release requires a semantic version without a v prefix or build metadata");
  if (version !== packageVersion) throw new Error(`Release ${version} does not match package.json ${packageVersion}`);
  return version;
}

export function publicEntryPoints(packageJson) {
  return Object.entries(packageJson.exports).filter(([name]) => name !== "./package.json").map(([name, value]) => {
    if (!value.types || !value.import) throw new Error(`Missing types or runtime entry for ${name}`);
    return { name: name === "." ? packageJson.name : `${packageJson.name}/${name.slice(2)}`, path: value.types };
  });
}

export function validateReleaseSource(release, dirty, tags) {
  if (!release) return;
  if (dirty) throw new Error("Release documentation requires a clean checkout of the release tag");
  if (!tags.includes(release) && !tags.includes(`v${release}`)) throw new Error(`HEAD has no ${release} or v${release} release tag`);
}

export function withoutComments(text, filename) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`Invalid documentation input: ${filename}`);
  return ts.createPrinter({ removeComments: true }).printFile(source);
}

function filesUnder(root, directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(root, path) : [path];
  }).sort();
}

export function compareDocumentationInputs(current, baseline, directory) {
  const paths = filesUnder(current, directory);
  if (JSON.stringify(paths) !== JSON.stringify(filesUnder(baseline, directory)))
    throw new Error(`Release documentation correction changes the ${directory} file inventory`);
  for (const path of paths) {
    const original = readFileSync(join(baseline, path), "utf8");
    const corrected = readFileSync(join(current, path), "utf8");
    const code = /\.(?:js|ts)$/.test(path);
    if ((code ? withoutComments(original, path) : original) !== (code ? withoutComments(corrected, path) : corrected))
      throw new Error(`Release documentation correction changes runtime or declarations: ${path}`);
  }
}

function verifyDocumentationCorrection(release, reason) {
  if (!release || !reason.trim()) throw new Error("A documentation correction requires --release and a nonempty --correction-reason");
  const tags = git("tag", "--list").split("\n").filter((tag) => tag === release || tag === `v${release}`);
  if (!tags.length) throw new Error(`No ${release} or v${release} release tag`);
  const refs = [...new Set(tags.map((tag) => git("rev-parse", `${tag}^{commit}`)))];
  if (refs.length !== 1) throw new Error("Release tags point to different commits");
  const scratch = mkdtempSync(join(tmpdir(), "lokalized-doc-correction-"));
  try {
    const baseline = join(scratch, "release");
    mkdirSync(baseline);
    const archive = execFileSync("git", ["archive", refs[0]], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
    execFileSync("tar", ["-xf", "-", "-C", baseline], { input: archive });
    symlinkSync(join(ROOT, "node_modules"), join(baseline, "node_modules"), "dir");
    for (const path of ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.documentation.json"]) {
      if (!readFileSync(join(ROOT, path)).equals(readFileSync(join(baseline, path))))
        throw new Error(`Release documentation correction changes ${path}`);
    }
    compareDocumentationInputs(ROOT, baseline, "src");
    const supportingTypes = "Documentation/SupportingTypes.d.ts";
    if (withoutComments(readFileSync(join(ROOT, supportingTypes), "utf8"), supportingTypes) !==
        withoutComments(readFileSync(join(baseline, supportingTypes), "utf8"), supportingTypes))
      throw new Error("Release documentation correction changes supporting types");
    // JSDoc can change types while leaving JavaScript unchanged. Emit both sets
    // afresh and compare the complete declaration trees, ignoring prose only.
    for (const root of [ROOT, baseline]) {
      const outDir = root === ROOT ? join(scratch, "current/types") : join(baseline, "types");
      execFileSync(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"),
        "--project", join(root, "tsconfig.json"), "--outDir", outDir], { cwd: root, stdio: "pipe" });
    }
    compareDocumentationInputs(join(scratch, "current"), baseline, "types");
    compareDocumentationInputs(ROOT, join(scratch, "current"), "types");
    return { releaseSourceRef: refs[0], correctionReason: reason, runtimeAndDeclarations: "unchanged" };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function validatePublicComments(model) {
  const internalNote = /BOOT-M0-\d+|\bM-R S\d+\b|\bamendment A\d+\b|\b[A-Za-z]+\.java:\d+|\b(?:test|tools)\/[\w/-]+\.(?:test\.js|mjs)|\bconformance\.mjs\b/i;
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.comment && internalNote.test(JSON.stringify(value.comment)))
      throw new Error(`Internal maintenance notes in public documentation: ${value.name}`);
    for (const [key, child] of Object.entries(value)) if (key !== "comment") visit(child);
  }
  visit(model);
}

export function prepareDeclarationInputs(packageRoot, output) {
  const snapshot = join(output, "declarations");
  rmSync(snapshot, { recursive: true, force: true });
  mkdirSync(join(snapshot, "Documentation"), { recursive: true });
  cpSync(join(packageRoot, "types"), join(snapshot, "types"), { recursive: true });
  cpSync(join(packageRoot, "Documentation/SupportingTypes.d.ts"), join(snapshot, "Documentation/SupportingTypes.d.ts"));
  // TypeScript consumes JSDoc's @interface tag when emitting .d.ts files. Add
  // this presentation directive to a private copy of the declaration, retaining
  // its exact ReturnType expression. The shipped declarations are never edited.
  const core = join(snapshot, "types/core/index.d.ts");
  const text = readFileSync(core, "utf8");
  const marked = text.replace(/\*\/(\s+export type Strings = ReturnType<typeof createStrings>;)/,
    "* @interface\n */$1");
  if (marked === text) throw new Error("Cannot identify the declaration-derived Strings type alias");
  writeFileSync(core, marked);
  writeFileSync(join(snapshot, "tsconfig.json"), JSON.stringify({
    extends: join(packageRoot, "tsconfig.documentation.json"),
    include: ["types/**/*.d.ts", "Documentation/SupportingTypes.d.ts"], exclude: []
  }, null, 2));
  return snapshot;
}

function inputFingerprint() {
  const paths = [];
  function collect(directory) {
    for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) collect(path);
      else paths.push(path);
    }
  }
  collect("src"); collect("Documentation");
  paths.push("package.json", "package-lock.json", "tsconfig.json", "tsconfig.documentation.json", "tools/api-documentation.mjs");
  const digest = createHash("sha256");
  for (const path of paths.sort()) digest.update(path).update("\0").update(readFileSync(join(ROOT, path))).update("\0");
  return digest.digest("hex");
}

function writeLanding(site) {
  const editions = readdirSync(site, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .map((entry) => join(site, entry.name, "reference-build.json")).filter(existsSync)
    .map((path) => JSON.parse(readFileSync(path, "utf8"))).sort((a, b) => b.edition.localeCompare(a.edition, "en", { numeric: true }));
  writeFileSync(join(site, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lokalized JavaScript API reference</title><style>body{font:18px/1.6 system-ui,sans-serif;max-width:50rem;margin:4rem auto;padding:0 1.5rem;color:#172033}a{color:#0758ba}li{margin:.7rem 0}code{font-size:.9em}</style></head>
<body><h1>Lokalized JavaScript API reference</h1><p>Functions, types, options, and callbacks for browser, Node.js, and TypeScript consumers.</p>
<ul>${editions.map((build) => `<li><a href="${escapeHtml(build.edition)}/index.html">${escapeHtml(build.label)}</a>${build.edition === "development" ? " — unreleased source; APIs may change" : ""}</li>`).join("\n")}</ul>
<p><a href="https://www.lokalized.com/?platform=javascript">Guides and examples</a> · <a href="https://github.com/lokalized/lokalized-js">Source repository</a></p></body></html>\n`);
}

export async function buildDocumentation({ release, correctionReason, output = join(ROOT, ".build/api-documentation") } = {}) {
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const entries = publicEntryPoints(packageJson);
  const edition = editionFor(release, packageJson.version);
  const sourceRef = git("rev-parse", "HEAD");
  const dirty = git("status", "--porcelain").length > 0;
  const correction = correctionReason === undefined ? undefined : verifyDocumentationCorrection(release, correctionReason);
  if (release && !correction) {
    const tags = git("tag", "--points-at", "HEAD").split("\n");
    validateReleaseSource(release, dirty, tags);
  }
  for (const entry of entries) if (!existsSync(join(ROOT, entry.path))) throw new Error("Emit declarations with npm run types before building the reference");
  const fingerprint = inputFingerprint();
  const label = release ? `Version ${release}` : `Development (package version ${packageJson.version})`;
  const site = join(resolve(output), "site");
  const destination = join(site, edition);
  const declarationsRoot = prepareDeclarationInputs(ROOT, resolve(output));
  const app = await Application.bootstrapWithPlugins({
    entryPoints: [...entries.map((entry) => join(declarationsRoot, entry.path)), join(declarationsRoot, "Documentation/SupportingTypes.d.ts")],
    tsconfig: join(declarationsRoot, "tsconfig.json"),
    displayBasePath: join(declarationsRoot, "types"),
    name: `Lokalized JavaScript — ${label}`,
    readme: join(ROOT, "Documentation/API.md"),
    disableSources: true,
    excludePrivate: true, excludeInternal: true,
    validation: { invalidLink: true, notExported: true },
    treatWarningsAsErrors: true,
    navigationLinks: { "Guides and examples": "https://www.lokalized.com/?platform=javascript", "All versions": "/" },
    searchInComments: true
  });
  const project = await app.convert();
  if (!project || app.logger.hasErrors()) throw new Error("TypeDoc failed to convert the public declarations");
  for (const entry of entries) {
    const oldName = entry.path.replace(/^\.\/types\//, "").replace(/\/index\.d\.ts$/, "").replace(/\.d\.ts$/, "");
    const module = project.children?.find((child) => child.name === oldName);
    if (!module) throw new Error(`TypeDoc omitted the public entry point ${entry.name}`);
    module.name = entry.name;
  }
  // The shipped Strings alias is ReturnType<typeof createStrings>. The @interface
  // tag exposes its inferred methods without duplicating the declaration by hand.
  // Link the factory to that equivalent named shape rather than printing its
  // entire inferred object twice on the factory page. This affects only reference
  // presentation, never the source or the emitted consumer declarations.
  const core = project.children.find((module) => module.name === "lokalized/core");
  const dereference = (reflection) => reflection?.kindOf(ReflectionKind.Reference) ? reflection.tryGetTargetReflectionDeep() : reflection;
  const factory = dereference(core.children.find((reflection) => reflection.name === "createStrings"));
  const strings = dereference(core.children.find((reflection) => reflection.name === "Strings"));
  if (!strings?.kindOf(ReflectionKind.Interface) || !factory?.signatures?.length)
    throw new Error("The reference needs the declaration-derived Strings shape and factory signature");
  for (const signature of factory.signatures) signature.type = ReferenceType.createResolvedReference("Strings", strings, project);
  app.validate(project);
  if (app.logger.hasWarnings() || app.logger.hasErrors()) throw new Error("TypeDoc reference validation failed");
  validatePublicComments(app.serializer.projectToObject(project, ROOT));
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  await app.generateDocs(project, destination);
  await app.generateJson(project, join(destination, "api.json"));
  if (app.logger.hasWarnings() || app.logger.hasErrors()) throw new Error("TypeDoc rendering failed");
  if (!existsSync(join(destination, "index.html"))) throw new Error("TypeDoc produced no reference home page");
  if (fingerprint !== inputFingerprint()) throw new Error("Documentation inputs changed during the build");
  const reflections = Object.values(project.reflections);
  const declarations = reflections.filter((reflection) => reflection.kindOf(ReflectionKind.All) && project.children?.includes(reflection.parent));
  const report = { status: "passed", generator: `TypeDoc ${JSON.parse(readFileSync(join(ROOT, "node_modules/typedoc/package.json"), "utf8")).version}`,
    edition, label, packageVersion: packageJson.version, sourceRef, dirty, sourceSha256: fingerprint,
    ...(correction ? { documentationCorrection: correction } : {}),
    entry: "index.html", publicEntryPoints: entries.map((entry) => entry.name),
    declarationOccurrences: declarations.length,
    documentedDeclarationOccurrences: declarations.filter((reflection) => reflection.comment?.hasVisibleComponent()).length,
    output: destination };
  writeFileSync(join(destination, "reference-build.json"), JSON.stringify(report, null, 2) + "\n");
  writeLanding(site);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const flag = process.argv[index], value = process.argv[index + 1];
    if (!["--release", "--output", "--correction-reason"].includes(flag) || !value)
      throw new Error("Usage: node tools/api-documentation.mjs [--release VERSION] [--correction-reason REASON] [--output DIRECTORY]");
    options[{ "--release": "release", "--output": "output", "--correction-reason": "correctionReason" }[flag]] = value;
  }
  await buildDocumentation(options);
}
