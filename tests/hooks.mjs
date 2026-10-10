// Test-only resolver: maps "@/x" to the project root and adds ".ts" to extensionless relative imports.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  let target = null;
  if (specifier.startsWith("@/")) target = path.join(root, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (target && !path.extname(target)) {
    for (const cand of [target + ".ts", path.join(target, "index.ts")]) {
      if (existsSync(cand)) return nextResolve(pathToFileURL(cand).href, context);
    }
  }
  return nextResolve(specifier, context);
}
