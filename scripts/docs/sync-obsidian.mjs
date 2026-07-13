import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const sourceDocs = path.join(repoRoot, "docs");
const mkdocsConfig = path.join(repoRoot, "mkdocs.yml");

const defaultVaultRoot = path.resolve("D:/AI/Codex/ProductDocsVault");
const vaultRoot = path.resolve(process.env.OBSIDIAN_DOCS_VAULT || defaultVaultRoot);
const projectName = process.env.OBSIDIAN_PROJECT_NAME || "Tiny Office";
const targetRoot = path.join(vaultRoot, projectName);

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertSafeTarget() {
  const resolvedSource = path.resolve(sourceDocs);
  const resolvedTarget = path.resolve(targetRoot);
  const resolvedRepo = path.resolve(repoRoot);

  if (resolvedTarget === resolvedSource || isInside(resolvedSource, resolvedTarget)) {
    throw new Error(`Refusing to sync into source docs directory: ${resolvedTarget}`);
  }

  if (resolvedTarget === resolvedRepo || isInside(resolvedTarget, resolvedRepo)) {
    throw new Error(`Refusing to sync into a parent of the repository: ${resolvedTarget}`);
  }

  if (resolvedTarget.length < 12) {
    throw new Error(`Refusing suspiciously short target path: ${resolvedTarget}`);
  }
}

async function collectMarkdownFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(base, fullPath);
    if (entry.isDirectory()) {
      if (toPosix(relativePath).startsWith("archive/")) continue;
      files.push(...await collectMarkdownFiles(fullPath, base));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

    files.push({
      source: fullPath,
      relative: relativePath,
    });
  }

  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

async function collectAssetFiles(dir, base = sourceDocs) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectAssetFiles(fullPath, base));
      continue;
    }

    if (!entry.isFile()) continue;

    files.push({
      source: fullPath,
      relative: path.relative(base, fullPath),
    });
  }

  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim();
}

function parseMkdocsNav(configText) {
  const lines = configText.split(/\r?\n/);
  const navStart = lines.findIndex((line) => line.trim() === "nav:");
  if (navStart === -1) return [];

  const navEntries = [];
  const stack = [];

  for (let index = navStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (/^\S/.test(line)) break;

    const match = line.match(/^(\s*)-\s+"?([^":]+)"?:\s*(.*)$/);
    if (!match) continue;

    const indent = match[1].length;
    const label = sanitizeName(match[2]);
    const rest = match[3].trim();

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (rest.endsWith(".md")) {
      const sourceRelative = rest.replaceAll("/", path.sep);
      const targetRelative = path.join(...stack.map((item) => item.label), `${label}.md`);
      navEntries.push({
        label,
        sourceRelative,
        targetRelative,
      });
    } else {
      stack.push({ indent, label });
    }
  }

  return navEntries;
}

function buildNavFilePlan(files, navEntries) {
  const fileByRelative = new Map(files.map((file) => [toPosix(file.relative), file]));
  const planned = [];
  const plannedSource = new Set();

  for (const entry of navEntries) {
    const sourceKey = toPosix(entry.sourceRelative);
    const file = fileByRelative.get(sourceKey);
    if (!file) continue;

    planned.push({
      ...file,
      displayLabel: entry.label,
      targetRelative: entry.targetRelative,
    });
    plannedSource.add(sourceKey);
  }

  for (const file of files) {
    const sourceKey = toPosix(file.relative);
    if (plannedSource.has(sourceKey)) continue;

    planned.push({
      ...file,
      displayLabel: path.basename(file.relative, ".md"),
      targetRelative: path.join("99 未归档", file.relative),
    });
  }

  return planned;
}

function stripHash(url) {
  const hashIndex = url.indexOf("#");
  if (hashIndex === -1) return { pathPart: url, hashPart: "" };
  return {
    pathPart: url.slice(0, hashIndex),
    hashPart: url.slice(hashIndex),
  };
}

function isExternalUrl(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("/") || url.startsWith("#");
}

function rewriteInternalLinks(content, file, targetBySource) {
  const sourceDir = path.posix.dirname(toPosix(file.relative));
  const targetDir = path.posix.dirname(toPosix(file.targetRelative));

  return content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, rawUrl) => {
    const trimmedUrl = rawUrl.trim();
    if (isExternalUrl(trimmedUrl)) return match;

    const { pathPart, hashPart } = stripHash(trimmedUrl);
    if (!pathPart.endsWith(".md")) return match;

    const normalizedSourceTarget = path.posix.normalize(path.posix.join(sourceDir, pathPart));
    const mappedTarget = targetBySource.get(normalizedSourceTarget);
    if (!mappedTarget) return match;

    const relativeTarget = path.posix.relative(targetDir, mappedTarget);
    const finalTarget = relativeTarget.startsWith(".") ? relativeTarget : `./${relativeTarget}`;
    return `[${label}](${encodeURI(finalTarget + hashPart)})`;
  });
}

function stripDuplicateH1(content, file) {
  const normalized = content.replace(/^\uFEFF/, "");
  const match = normalized.match(/^(#\s+(.+?)\s*)\r?\n(?:\r?\n)?/);
  if (!match) return content;

  const heading = match[2].replace(/\s+#*$/, "").trim();
  const fileTitle = path.basename(file.targetRelative, ".md").trim();
  const sourceTitle = path.basename(file.relative, ".md").trim();
  const displayTitle = file.displayLabel.trim();

  if (![fileTitle, sourceTitle, displayTitle].includes(heading)) {
    return content;
  }

  return normalized.slice(match[0].length);
}

async function copyMarkdownFiles(files, targetBySource) {
  for (const file of files) {
    const target = path.join(targetRoot, file.targetRelative);
    const sourceContent = await readFile(file.source, "utf8");
    const linkedContent = rewriteInternalLinks(sourceContent, file, targetBySource);
    const content = stripDuplicateH1(linkedContent, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

async function copyAssetFiles(files) {
  for (const file of files) {
    const target = path.join(targetRoot, file.relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file.source, target);
  }
}

async function writeVaultIndex(files) {
  const now = new Date().toISOString();
  const links = files
    .map((file) => {
      const displayName = toPosix(file.targetRelative).replace(/\.md$/, "");
      return `- [[${displayName}|${file.displayLabel}]]`;
    })
    .join("\n");

  const content = `---\n` +
    `title: Tiny Office Docs\n` +
    `tags:\n` +
    `  - tinyoffice\n` +
    `  - product-docs\n` +
    `source: ${sourceDocs.replaceAll("\\", "/")}\n` +
    `synced: ${now}\n` +
    `---\n\n` +
    `# Tiny Office Docs\n\n` +
    `> [!warning] 单向同步副本\n` +
    `> 这里是从项目仓库 \`docs/\` 同步出来的 Obsidian 阅读副本。不要把这里当修改源头；需要修改产品真相时，请回到项目仓库里的 Markdown。\n\n` +
    `## 常用入口\n\n` +
    `- [[00 开始阅读/产品架构手册|产品架构手册]]\n` +
    `- [[00 开始阅读/产品功能地图|产品功能地图]]\n` +
    `- [[00 开始阅读/当前仪表盘|当前仪表盘]]\n` +
    `- [[00 开始阅读/功能能力清单|功能能力清单]]\n` +
    `- [[07 运行手册/开发协作流程|开发协作流程]]\n\n` +
    `## 全部页面\n\n` +
    `${links}\n`;

  await writeFile(path.join(targetRoot, "README.md"), content, "utf8");
}

async function main() {
  await assertSafeTarget();
  await stat(sourceDocs);

  const files = await collectMarkdownFiles(sourceDocs);
  const assetsDir = path.join(sourceDocs, "assets");
  const assetFiles = await stat(assetsDir)
    .then(() => collectAssetFiles(assetsDir))
    .catch((error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    });
  const navEntries = parseMkdocsNav(await readFile(mkdocsConfig, "utf8"));
  const plannedFiles = buildNavFilePlan(files, navEntries);
  const targetBySource = new Map(
    plannedFiles.map((file) => [
      toPosix(file.relative),
      toPosix(file.targetRelative),
    ]),
  );

  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });
  await copyMarkdownFiles(plannedFiles, targetBySource);
  await copyAssetFiles(assetFiles);
  await writeVaultIndex(plannedFiles);

  console.log(`Synced ${plannedFiles.length} Markdown files`);
  console.log(`Synced ${assetFiles.length} asset files`);
  console.log(`Source: ${sourceDocs}`);
  console.log(`Target: ${targetRoot}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
