import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(appRoot, "src");
const lowLevelUiPackages = new Set(["radix-ui", "cmdk", "@shadcn/react"]);
const competingUiPackages = [
  "@chakra-ui/",
  "@emotion/",
  "@headlessui/",
  "@mantine/",
  "@mui/",
  "antd",
  "bootstrap",
  "framer-motion",
  "semantic-ui-react",
  "styled-components",
];
const violations = [];

for (const file of await sourceFiles(sourceRoot)) {
  const relativePath = normalize(path.relative(appRoot, file));
  const source = await readFile(file, "utf8");
  const imports = [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].map((match) => match[1]);

  for (const specifier of imports) {
    const isUiPrimitive = relativePath.startsWith("src/components/ui/");
    if (lowLevelUiPackages.has(packageRoot(specifier)) && !isUiPrimitive) {
      violations.push(`${relativePath}: import ${specifier} through src/components/ui instead of using the low-level package directly`);
    }
    if (competingUiPackages.some((prefix) => specifier === prefix || specifier.startsWith(prefix))) {
      violations.push(`${relativePath}: competing UI dependency ${specifier} is outside the accepted shadcn/Radix foundation`);
    }
  }
}

if (violations.length) {
  throw new Error(`Frontend UI boundary violations:\n${violations.join("\n")}`);
}

console.log("Frontend UI boundaries passed: product code uses the shared shadcn component layer and one icon system.");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(target));
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(target);
    }
  }
  return files;
}

function packageRoot(specifier) {
  if (specifier.startsWith("@shadcn/react/")) return "@shadcn/react";
  return specifier;
}

function normalize(value) {
  return value.replaceAll(path.sep, "/");
}
