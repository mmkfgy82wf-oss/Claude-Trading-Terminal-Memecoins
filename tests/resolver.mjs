/**
 * Minimal resolution hook so `node --test` can load the app's source directly.
 *
 * Next.js resolves the `@/` alias and extensionless imports through its bundler;
 * plain Node does neither. Teaching the test runner those two rules is cheaper
 * than pulling in a second toolchain just to run unit tests.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATES = [".ts", ".tsx", "/index.ts", "/index.tsx", ".js"];

function withExtension(absolute) {
  if (existsSync(absolute) && path.extname(absolute)) return absolute;
  for (const suffix of CANDIDATES) {
    const candidate = `${absolute}${suffix}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = withExtension(path.join(ROOT, "src", specifier.slice(2)));
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  if (specifier.startsWith(".") && !path.extname(specifier)) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : ROOT;
    const resolved = withExtension(path.resolve(path.dirname(parentPath), specifier));
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
