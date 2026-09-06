import { resolve } from "node:path";
import { ESLint } from "eslint";
import { qualityConfig } from "./config.mts";
import { checkStrictProjects } from "./strict-projects.mts";

const root = resolve(process.argv[2] ?? ".");
const patterns = process.argv.slice(3);
const compilerFailures = checkStrictProjects(root);
compilerFailures.forEach((failure) => {
  process.stderr.write(`${failure}\n`);
});
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: qualityConfig(root),
});
const results = await eslint.lintFiles(patterns.length === 0 ? ["."] : patterns);
const formatter = await eslint.loadFormatter("stylish");
process.stdout.write(await formatter.format(results));
process.exitCode =
  compilerFailures.length > 0 ||
  results.some((result) => result.errorCount + result.warningCount > 0)
    ? 1
    : 0;
