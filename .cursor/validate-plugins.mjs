#!/usr/bin/env node
// Validates every plugin in plugins/*: Codex and Cursor manifests, SKILL.md,
// commands/agents frontmatter, and syntax-checks bundled .mjs scripts.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginsDir = path.join(repoRoot, "plugins");
const cursorMarketplacePath = path.join(repoRoot, ".cursor-plugin", "marketplace.json");

const errors = [];
const summary = [];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    errors.push(label);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${label}（JSON 无效: ${error.message}）`);
    return null;
  }
}

function walkNamedMarkdown(dir, fileName = "SKILL.md") {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === fileName) found.push(full);
    }
  };
  walk(dir);
  return found;
}

function walkMarkdownFiles(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|mdc|markdown)$/.test(entry.name)) found.push(full);
    }
  };
  walk(dir);
  return found;
}

function requireFrontmatterFields(filePath, pluginName, requiredFields) {
  const text = fs.readFileSync(filePath, "utf8");
  if (!text.startsWith("---")) {
    errors.push(`${pluginName}: ${path.relative(repoRoot, filePath)} 缺少 YAML frontmatter`);
    return;
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    errors.push(`${pluginName}: ${path.relative(repoRoot, filePath)} frontmatter 未闭合`);
    return;
  }
  const frontmatter = text.slice(4, end);
  for (const field of requiredFields) {
    const matched = frontmatter.match(new RegExp(`^${field}\\s*:\\s*\\S`, "m"));
    if (!matched) {
      errors.push(`${pluginName}: ${path.relative(repoRoot, filePath)} 缺少 frontmatter 字段 ${field}`);
    }
  }
}

if (!fs.existsSync(pluginsDir)) {
  console.error(`plugins 目录不存在: ${pluginsDir}`);
  process.exit(1);
}

const pluginNames = fs
  .readdirSync(pluginsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const marketplace = readJson(cursorMarketplacePath, "缺少 .cursor-plugin/marketplace.json");
if (marketplace) {
  if (!isNonEmptyString(marketplace.name)) {
    errors.push(".cursor-plugin/marketplace.json 缺少 name");
  }
  if (!marketplace.owner || !isNonEmptyString(marketplace.owner.name)) {
    errors.push(".cursor-plugin/marketplace.json 缺少 owner.name");
  }
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    errors.push(".cursor-plugin/marketplace.json 缺少 plugins");
  } else {
    const listed = marketplace.plugins.map((entry) => entry?.name).filter(Boolean).sort();
    const expected = [...pluginNames];
    if (JSON.stringify(listed) !== JSON.stringify(expected)) {
      errors.push(
        `.cursor-plugin/marketplace.json plugins 与 plugins/* 不一致: listed=[${listed.join(", ")}] dirs=[${expected.join(", ")}]`
      );
    }
    for (const entry of marketplace.plugins) {
      if (!isNonEmptyString(entry?.source)) {
        errors.push(`marketplace 条目 ${entry?.name ?? "?"} 缺少 source`);
        continue;
      }
      const pluginRoot = marketplace.metadata?.pluginRoot
        ? path.join(repoRoot, marketplace.metadata.pluginRoot, entry.source)
        : path.join(repoRoot, entry.source);
      if (!fs.existsSync(pluginRoot)) {
        errors.push(`marketplace 条目 ${entry.name} 的 source 不存在: ${entry.source}`);
      }
    }
  }
}

for (const pluginName of pluginNames) {
  const pluginPath = path.join(pluginsDir, pluginName);
  const codexManifest = readJson(
    path.join(pluginPath, ".codex-plugin", "plugin.json"),
    `${pluginName}: 缺少 .codex-plugin/plugin.json`
  );
  const cursorManifest = readJson(
    path.join(pluginPath, ".cursor-plugin", "plugin.json"),
    `${pluginName}: 缺少 .cursor-plugin/plugin.json`
  );

  if (codexManifest) {
    for (const field of ["name", "version", "skills"]) {
      if (!isNonEmptyString(codexManifest[field])) {
        errors.push(`${pluginName}: Codex plugin.json 缺少字段 ${field}`);
      }
    }
    if (isNonEmptyString(codexManifest.name) && codexManifest.name !== pluginName) {
      errors.push(`${pluginName}: Codex plugin.json name 应为 ${pluginName}`);
    }
  }

  if (cursorManifest) {
    for (const field of ["name", "version", "description"]) {
      if (!isNonEmptyString(cursorManifest[field])) {
        errors.push(`${pluginName}: Cursor plugin.json 缺少字段 ${field}`);
      }
    }
    if (isNonEmptyString(cursorManifest.name) && cursorManifest.name !== pluginName) {
      errors.push(`${pluginName}: Cursor plugin.json name 应为 ${pluginName}`);
    }
  }

  const skillFiles = walkNamedMarkdown(path.join(pluginPath, "skills"));
  if (skillFiles.length === 0) {
    errors.push(`${pluginName}: 未找到任何 SKILL.md`);
  }
  for (const skillFile of skillFiles) {
    requireFrontmatterFields(skillFile, pluginName, ["name", "description"]);
  }

  const commandFiles = walkMarkdownFiles(path.join(pluginPath, "commands"));
  for (const commandFile of commandFiles) {
    requireFrontmatterFields(commandFile, pluginName, ["name", "description"]);
  }

  const agentFiles = walkMarkdownFiles(path.join(pluginPath, "agents"));
  for (const agentFile of agentFiles) {
    requireFrontmatterFields(agentFile, pluginName, ["name", "description"]);
  }

  const mjsFiles = [];
  const walkScripts = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkScripts(full);
      else if (entry.name.endsWith(".mjs")) mjsFiles.push(full);
    }
  };
  walkScripts(pluginPath);
  for (const mjs of mjsFiles) {
    try {
      execFileSync(process.execPath, ["--check", mjs], { stdio: "pipe" });
    } catch (error) {
      errors.push(`${pluginName}: ${path.relative(repoRoot, mjs)} 语法检查失败 (${error.message})`);
    }
  }

  const cursorVersion = cursorManifest?.version ?? "?";
  summary.push(
    `  ✓ ${pluginName} (cursor ${cursorVersion}, ${skillFiles.length} skill, ${commandFiles.length} command, ${agentFiles.length} agent, ${mjsFiles.length} script)`
  );
}

console.log(`已校验 ${pluginNames.length} 个插件:`);
console.log(summary.join("\n"));

if (errors.length > 0) {
  console.error(`\n发现 ${errors.length} 个问题:`);
  for (const err of errors) console.error(`  ✗ ${err}`);
  process.exit(1);
}

console.log("\n全部插件校验通过。");
