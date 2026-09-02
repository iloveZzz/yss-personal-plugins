#!/usr/bin/env node
// Validates every Codex plugin in plugins/*: manifest shape, SKILL.md presence,
// and syntax-checks bundled .mjs scripts. Idempotent and read-only.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginsDir = path.join(repoRoot, "plugins");

const errors = [];
const summary = [];

if (!fs.existsSync(pluginsDir)) {
  console.error(`plugins 目录不存在: ${pluginsDir}`);
  process.exit(1);
}

const pluginNames = fs
  .readdirSync(pluginsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const pluginName of pluginNames) {
  const pluginPath = path.join(pluginsDir, pluginName);
  const manifestPath = path.join(pluginPath, ".codex-plugin", "plugin.json");

  if (!fs.existsSync(manifestPath)) {
    errors.push(`${pluginName}: 缺少 .codex-plugin/plugin.json`);
    continue;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    errors.push(`${pluginName}: plugin.json 不是有效 JSON (${error.message})`);
    continue;
  }

  for (const field of ["name", "version", "skills"]) {
    if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
      errors.push(`${pluginName}: plugin.json 缺少字段 ${field}`);
    }
  }

  const skillFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "SKILL.md") skillFiles.push(full);
    }
  };
  const skillsRoot = path.join(pluginPath, "skills");
  if (fs.existsSync(skillsRoot)) walk(skillsRoot);
  if (skillFiles.length === 0) {
    errors.push(`${pluginName}: 未找到任何 SKILL.md`);
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

  summary.push(
    `  ✓ ${pluginName} (v${manifest.version ?? "?"}, ${skillFiles.length} skill, ${mjsFiles.length} script)`
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
