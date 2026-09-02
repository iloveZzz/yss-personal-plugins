#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_VERIFICATION_COMMANDS = ["./mvnw validate", "./mvnw test", "./mvnw package"];
const CANONICAL_ROLE_ID = "role.backend-engineer";
const LEGACY_ROLE_ID = "role.backend-agent";
const ALLOWED_RUNTIME_IDS = new Set(["runtime.skill-projection", "runtime.generic"]);
const EXECUTION_STATES = new Set(["Explorer", "Drafter", "Worker", "Reviewer", "Verifier"]);
const WORKFLOW_STATUSES = new Set(["not-started", "active", "paused", "resolved", "failed"]);
const CONTRACT_KINDS = new Set(["lifecycle-work-unit", "slice-implementation", "template-maintenance"]);

function fail(message) {
  throw new Error(`blocked: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${field} 不能为空`);
  }
  return value.trim();
}

function requireStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    fail(`${field} 必须是非空字符串数组`);
  }
  return value.map((item) => item.trim());
}

function optionalStringArray(value, field) {
  if (value === undefined || value === null) return [];
  return requireStringArray(value, field);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function parseArgs(argv) {
  const [inputPath, ...rest] = argv;
  if (!inputPath || inputPath.startsWith("--")) {
    fail("用法: render_backend_prompt.mjs <task.json> [--repo-root <repository-root>]");
  }
  let repoRoot;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token !== "--repo-root") {
      fail(`未知参数: ${token}`);
    }
    repoRoot = rest[index + 1];
    if (!repoRoot || repoRoot.startsWith("--")) {
      fail("--repo-root 必须提供目录");
    }
    index += 1;
  }
  return { inputPath: path.resolve(inputPath), repoRoot: repoRoot ? path.resolve(repoRoot) : undefined };
}

function readTask(inputPath) {
  let raw;
  try {
    raw = fs.readFileSync(inputPath, "utf8");
  } catch (error) {
    fail(`无法读取任务文件 ${inputPath}: ${error.message}`);
  }
  try {
    const task = JSON.parse(raw);
    if (!isRecord(task)) fail("任务文件必须是 JSON 对象");
    return task;
  } catch (error) {
    if (error.message.startsWith("blocked:")) throw error;
    fail(`任务文件不是有效 JSON: ${error.message}`);
  }
}

function normalizeRoleId(value) {
  const raw = requireString(value, "role_id");
  if (raw === LEGACY_ROLE_ID) {
    return { roleId: CANONICAL_ROLE_ID, warnings: [`兼容角色名 ${LEGACY_ROLE_ID} 已归一化为 ${CANONICAL_ROLE_ID}`] };
  }
  if (raw !== CANONICAL_ROLE_ID) {
    fail(`后端 Harness 只接受 ${CANONICAL_ROLE_ID}（收到 ${raw}）`);
  }
  return { roleId: CANONICAL_ROLE_ID, warnings: [] };
}

function normalizeReference(value, field) {
  const reference = requireString(value, field);
  if (/^not-applicable\b/i.test(reference) && !/^not-applicable\s*[:：].+/.test(reference)) {
    fail(`${field} 使用 not-applicable 时必须写明原因`);
  }
  return reference;
}

async function loadRoleDefaults(repoRoot) {
  const modulePath = path.join(repoRoot, "scripts/lib/digital-human-roles.mjs");
  if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
    fail(`找不到角色注册表加载器: ${modulePath}`);
  }
  let module;
  try {
    module = await import(pathToFileURL(modulePath).href);
  } catch (error) {
    fail(`无法加载角色注册表加载器 ${modulePath}: ${error.message}`);
  }
  if (typeof module.taskPackageDefaults !== "function") {
    fail(`${modulePath} 未导出 taskPackageDefaults`);
  }
  try {
    return module.taskPackageDefaults(CANONICAL_ROLE_ID);
  } catch (error) {
    fail(`无法读取 ${CANONICAL_ROLE_ID} 的 taskPackageDefaults: ${error.message}`);
  }
}

function compareSnapshot(task, defaults) {
  const providedCore = firstDefined(task.core_skills, task.skill_source?.core_skills);
  const providedForbidden = firstDefined(task.forbidden_skills, task.skill_source?.forbidden_skills);
  const drift = [];
  if (providedCore !== undefined) {
    const core = requireStringArray(providedCore, "core_skills");
    if (JSON.stringify(core) !== JSON.stringify(defaults.core_skills)) {
      drift.push("core_skills 与角色注册表 taskPackageDefaults 不一致");
    }
  }
  if (providedForbidden !== undefined) {
    const forbidden = requireStringArray(providedForbidden, "forbidden_skills");
    if (JSON.stringify(forbidden) !== JSON.stringify(defaults.forbidden_skills)) {
      drift.push("forbidden_skills 与角色注册表 taskPackageDefaults 不一致");
    }
  }
  if (drift.length > 0) fail(`drift: ${drift.join("；")}`);
}

function validateTask(task, args, defaults) {
  const warnings = [];
  const normalized = normalizeRoleId(task.role_id);
  warnings.push(...normalized.warnings);

  const runtimeId = requireString(task.runtime_id, "runtime_id");
  if (!ALLOWED_RUNTIME_IDS.has(runtimeId)) {
    fail(`runtime_id 必须是 runtime.skill-projection 或 runtime.generic（收到 ${runtimeId}）`);
  }
  if (runtimeId === "runtime.generic") {
    warnings.push("runtime.generic 仅用于兼容通用 Agent；Codex 默认使用 runtime.skill-projection");
  }

  const executionState = requireString(task.execution_state, "execution_state");
  if (!EXECUTION_STATES.has(executionState)) fail(`execution_state 无效: ${executionState}`);

  const contract = isRecord(task.contract) ? task.contract : {};
  const contractKind = requireString(contract.kind, "contract.kind");
  if (!CONTRACT_KINDS.has(contractKind)) fail(`contract.kind 无效: ${contractKind}`);
  const contractId = requireString(firstDefined(contract.contract_id, task.contract_id), "contract.contract_id");
  const contractVersionValue = firstDefined(contract.contract_version, task.contract_version);
  if (!Number.isInteger(contractVersionValue) || contractVersionValue < 1) {
    fail("contract.contract_version 必须是正整数");
  }
  const contractStatus = requireString(contract.status, "contract.status");
  if (contractStatus !== "issued") fail(`合同状态必须为 issued（收到 ${contractStatus}）`);
  const contractRef = requireString(firstDefined(contract.contract_ref, task.contract_ref), "contract.contract_ref");

  const repositoryRoot = args.repoRoot
    ?? firstDefined(task.repository_root, task.target_repository_root)
    ?? process.cwd();
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  if (!fs.existsSync(resolvedRepositoryRoot) || !fs.statSync(resolvedRepositoryRoot).isDirectory()) {
    fail(`repository_root 不是可读目录: ${resolvedRepositoryRoot}`);
  }
  const implementationRepoRoot = path.resolve(requireString(task.implementation_repo_root, "implementation_repo_root"));
  if (!fs.existsSync(implementationRepoRoot) || !fs.statSync(implementationRepoRoot).isDirectory()) {
    fail(`implementation_repo_root 不是可读目录: ${implementationRepoRoot}`);
  }

  const openapiFreezeRef = firstDefined(task.openapi_freeze_ref, contract.openapi_freeze_ref);
  const noImpactRef = firstDefined(task.no_impact_ref, contract.no_impact_ref);
  if (!openapiFreezeRef && !noImpactRef) {
    fail("必须提供 openapi_freeze_ref 或 no_impact_ref");
  }
  if (openapiFreezeRef && noImpactRef) {
    warnings.push("同时提供了 openapi_freeze_ref 和 no_impact_ref，将优先使用 OpenAPI Freeze 引用");
  }
  const openapiReference = normalizeReference(openapiFreezeRef ?? noImpactRef, openapiFreezeRef ? "openapi_freeze_ref" : "no_impact_ref");
  const tacticalDesignRef = normalizeReference(firstDefined(task.tactical_design_ref, contract.tactical_design_ref), "tactical_design_ref");
  const dataArchitectureRef = normalizeReference(firstDefined(task.data_architecture_ref, contract.data_architecture_ref), "data_architecture_ref");
  const allowedWritePaths = requireStringArray(task.allowed_write_paths, "allowed_write_paths");
  const behavior = requireString(firstDefined(task.behavior, task.objective), "behavior/objective");
  const testSeams = requireStringArray(task.test_seams, "test_seams");
  const verificationCommands = task.verification_commands === undefined
    ? DEFAULT_VERIFICATION_COMMANDS
    : requireStringArray(task.verification_commands, "verification_commands");
  const allowedReadPaths = optionalStringArray(task.allowed_read_paths, "allowed_read_paths");
  const expectedEvidenceFiles = optionalStringArray(task.expected_evidence_files, "expected_evidence_files");
  const stopConditions = task.stop_conditions === undefined
    ? ["合同、API、数据、状态、聚合或事务边界出现 drift/new_impacts", "缺少 ./mvnw 或实际验证证据", "需要生产副作用、Git push 或生物人裁决"]
    : requireStringArray(task.stop_conditions, "stop_conditions");

  compareSnapshot(task, defaults);
  if (task.skill_source?.registry_ref && task.skill_source.registry_ref !== "docs/agents/digital-human-roles.yaml") {
    fail("skill_source.registry_ref 必须指向 docs/agents/digital-human-roles.yaml");
  }

  const workflowStatus = task.workflow_status ? requireString(task.workflow_status, "workflow_status") : "active";
  if (!WORKFLOW_STATUSES.has(workflowStatus)) fail(`workflow_status 无效: ${workflowStatus}`);

  return {
    taskId: requireString(task.task_id, "task_id"),
    workUnitId: requireString(task.work_unit_id, "work_unit_id"),
    actorId: requireString(task.actor_id, "actor_id"),
    roleId: normalized.roleId,
    runtimeId,
    executionState,
    workflowStatus,
    repositoryRoot: resolvedRepositoryRoot,
    implementationRepoRoot,
    contractKind,
    contractId,
    contractVersion: contractVersionValue,
    contractRef,
    openapiReference,
    tacticalDesignRef,
    dataArchitectureRef,
    behavior,
    testSeams,
    allowedReadPaths,
    allowedWritePaths,
    verificationCommands,
    expectedEvidenceFiles,
    stopConditions,
    defaults,
    warnings,
    workflowReference: requireString(firstDefined(task.workflow_reference, contractRef), "workflow_reference"),
    nextRoute: requireString(firstDefined(task.next_route, "work-unit.slice-implementation"), "next_route")
  };
}

function list(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- （无）";
}

function renderPrompt(input) {
  const warnings = input.warnings.length > 0 ? `\n\n兼容 / 警告：\n${list(input.warnings)}` : "";
  const readPaths = input.allowedReadPaths.length > 0 ? list(input.allowedReadPaths) : "- 按任务包与生命周期规则读取，不扩大读取范围";
  const evidence = input.expectedEvidenceFiles.length > 0
    ? list(input.expectedEvidenceFiles)
    : "- 每条验证命令的实际退出码、执行时间、stdout/stderr 与可读取证据引用\n- changed_files、deferred_seams、drift、new_impacts、violation、blocking_signals 和 next_route";
  console.log(`请以 ${input.roleId} / ${input.executionState} 执行后端任务。\n\n任务：${input.taskId}\n工作单元：${input.workUnitId}\n执行者：${input.actorId}\n运行时：${input.runtimeId}\n工作流状态：${input.workflowStatus}\n合同：${input.contractKind} ${input.contractId}@${input.contractVersion}\n合同引用：${input.contractRef}\n工作流引用：${input.workflowReference}\n建议下一路由：${input.nextRoute}\n\n目标项目根：${input.repositoryRoot}\n真实后端项目根：${input.implementationRepoRoot}\n\n上游边界：\n- OpenAPI：${input.openapiReference}\n- Tactical Design：${input.tacticalDesignRef}\n- Data Architecture：${input.dataArchitectureRef}\n\n行为目标：\n${input.behavior}\n\n测试 seam：\n${list(input.testSeams)}\n\n允许读取：\n${readPaths}\n\n只允许写入：\n${list(input.allowedWritePaths)}\n\n动态 Core Skills（来自 taskPackageDefaults）：\n${list(input.defaults.core_skills)}\n\n动态 Forbidden Skills：\n${list(input.defaults.forbidden_skills)}\n\n执行要求：\n- 使用 behavior-tdd；先围绕公开行为和测试 seam 写测试，再实现。\n- 遵守既定聚合、不变量、状态、API、数据和事务边界。\n- 不修改冻结合同，不独立 Freeze OpenAPI，不设置 ready-for-agent，不执行生产副作用，不提交或推送 Git。\n- 只有合同明确授权时才使用 controlled-generation；不得用脚手架替代业务行为测试。\n- 发现新 API、字段、状态、数据模型、聚合边界、事务边界、权限行为或 drift/new_impacts，立即停止并返回 blocked / drift / new_impacts。\n\n停止条件：\n${list(input.stopConditions)}\n\n验证命令：\n${list(input.verificationCommands)}\n\n预期证据：\n${evidence}\n\n返回 Workflow Execution Result（completed / blocked / needs-human / failed），至少包含 workflow_reference、skill、changed_files、evidence_refs、actual_verification、deferred_seams、drift、violation、new_impacts、stale_candidates、blocking_signals 和 next_route。${warnings}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const task = readTask(args.inputPath);
  const repositoryRoot = path.resolve(args.repoRoot ?? firstDefined(task.repository_root, task.target_repository_root) ?? process.cwd());
  const defaults = await loadRoleDefaults(repositoryRoot);
  const normalized = validateTask(task, { ...args, repoRoot: repositoryRoot }, defaults);
  renderPrompt(normalized);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
