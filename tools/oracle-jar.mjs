/**
 * Resolve the `lokalized-java` oracle jar, by DISCOVERY rather than by a pinned version string.
 *
 * **IT WAS A PINNED STRING AND THE STRING WENT STALE THE HOUR THE VERSION MOVED.** Both
 * `tools/load-diff/run.mjs` and `tools/lookup-diff/run.mjs` carried
 * `join(javaDir, "target/lokalized-3.0.0.jar")`; lokalized-java went to `3.1.0-SNAPSHOT` to carry
 * its registry-sourced IANA table and `npm run diff:all` stopped at the first of the two with "the
 * oracle jar is missing", naming a path that was correct the day it was written. A version constant
 * in a sibling repo's build output is not something this repository can keep true.
 *
 * ONE COPY, for `tools/graph-walk.mjs`'s reason: the exclusion below (`-sources`, `-javadoc`) is
 * non-obvious and a second hand-written copy of it drifts.
 *
 * AMBIGUITY IS A FAILURE, NOT A PREFERENCE. `mvn package` leaves exactly one main jar, but a
 * `target/` holding two — a stale release beside a fresh snapshot — is precisely the situation
 * where silently picking one makes a differential compare against the wrong oracle and report
 * green. `LOKALIZED_JAR` is the deliberate override and is honoured verbatim.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {string} javaDir the lokalized-java checkout
 * @returns {{ jar: string | null, problem: string | null }}
 */
export function oracleJar(javaDir) {
  if (process.env.LOKALIZED_JAR)
    return existsSync(process.env.LOKALIZED_JAR)
      ? { jar: process.env.LOKALIZED_JAR, problem: null }
      : { jar: null, problem: `LOKALIZED_JAR points at ${process.env.LOKALIZED_JAR}, which does not exist` };

  const target = join(javaDir, "target");
  if (!existsSync(target))
    return { jar: null, problem: `${target} does not exist; build lokalized-java, or set LOKALIZED_JAR` };

  const jars = readdirSync(target).filter((name) =>
    name.startsWith("lokalized-") && name.endsWith(".jar") &&
    !name.endsWith("-sources.jar") && !name.endsWith("-javadoc.jar")).sort();

  if (jars.length === 0)
    return { jar: null, problem: `no lokalized-*.jar in ${target}; run 'mvn package' there, or set LOKALIZED_JAR` };
  if (jars.length > 1)
    return { jar: null, problem: `${jars.length} candidate oracle jars in ${target} (${jars.join(", ")}). ` +
      `Which one a differential compares against decides what its green means, so this refuses to ` +
      `choose: remove the stale one, or name the right one in LOKALIZED_JAR` };

  return { jar: join(target, /** @type {string} */ (jars[0])), problem: null };
}
