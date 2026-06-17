// @ts-nocheck
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { createActionRequest } = require("../action");
const { evaluateAction } = require("../core/policy");
const { loadMcpPolicy } = require("../mcp/policy");
const { createTrustedReceipt } = require("../trusted-process/receipt");

const CONFIG = "charon.aeon.yml";
const RECEIPTS_DIR = path.join(".charon", "receipts");
const PREFLIGHT_START = "# >>> charon aeon preflight";
const PREFLIGHT_END = "# <<< charon aeon preflight";

function installAeonEnforcement(input = {}) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const workflowPath = path.join(cwd, ".github", "workflows", "aeon.yml");
  if (!fs.existsSync(workflowPath)) throw new Error("Aeon workflow not found: .github/workflows/aeon.yml");
  const before = fs.readFileSync(workflowPath, "utf8");
  const after = insertPreflightBlock(before);
  if (after !== before) fs.writeFileSync(workflowPath, after);
  const policyPath = path.join(cwd, CONFIG);
  if (!fs.existsSync(policyPath)) fs.writeFileSync(policyPath, `${yaml.dump(defaultAeonPolicy(), { lineWidth: 100 })}`);
  return {
    workflowPath,
    policyPath,
    changed: after !== before,
  };
}

function readAeonEnforcementReport(input = {}) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const workflowPath = path.join(cwd, ".github", "workflows", "aeon.yml");
  const policyPath = path.join(cwd, CONFIG);
  const workflow = fs.existsSync(workflowPath) ? fs.readFileSync(workflowPath, "utf8") : "";
  const preflightInstalled = workflow.includes(PREFLIGHT_START) && workflow.includes(PREFLIGHT_END);
  const preflightCommandValid = /charon\s+aeon\s+preflight/.test(workflow) && /--policy\s+charon\.aeon\.yml/.test(workflow);
  const beforeClaude = workflow.indexOf(PREFLIGHT_START) >= 0 && workflow.indexOf("claude -p") >= 0
    ? workflow.indexOf(PREFLIGHT_START) < workflow.indexOf("claude -p")
    : false;
  const policyExists = fs.existsSync(policyPath);
  let policyValid = false;
  let policyError = "";
  if (policyExists) {
    try {
      const loaded = yaml.load(fs.readFileSync(policyPath, "utf8"));
      policyValid = Boolean(loaded && typeof loaded === "object" && loaded.version === 1);
    } catch (error) {
      policyError = error.message;
    }
  }
  return {
    workflowExists: fs.existsSync(workflowPath),
    policyExists,
    policyValid,
    policyError,
    preflightInstalled,
    preflightCommandValid,
    preflightBeforeClaude: beforeClaude,
    enforced: fs.existsSync(workflowPath) && policyExists && policyValid && preflightInstalled && preflightCommandValid && beforeClaude,
    workflowPath,
    policyPath,
  };
}

function runAeonPreflight(input = {}) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const policyPath = path.resolve(cwd, input.policy || CONFIG);
  const policy = loadMcpPolicy(policyPath);
  const action = createAeonAction({ ...input, cwd });
  const decision = evaluateAction(action, policy);
  const receipt = createTrustedReceipt({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    action,
    decision,
    policy,
    execution: { launched: false, status: "not_launched" },
  });
  const written = writeReceipt(cwd, receipt);
  return {
    schema: "charon.aeonPreflight.v1",
    verdict: decision.verdict,
    reason: decision.reason,
    ruleId: decision.ruleId,
    launched: false,
    action,
    receiptPath: written.path,
    receipt,
  };
}

function createAeonAction(input) {
  const skill = String(input.skill || "");
  const trigger = String(input.trigger || "unknown");
  const repo = String(input.repo || process.env.GITHUB_REPOSITORY || "");
  const variable = String(input.var || "");
  const resources = [
    { role: "mcp-tool", value: `aeon.skill:${skill}`, source: "aeon.skill" },
    { role: "unknown", value: `aeon.trigger:${trigger}`, source: "aeon.trigger" },
  ];
  if (variable) resources.push({ role: "unknown", value: `aeon.var:${variable}`, source: "aeon.var" });
  if (repo) resources.push({ role: "git-remote-url", value: `https://github.com/${repo}`, source: "github.repository" });
  const skillMeta = readSkillMetadata(input.cwd, skill);
  if (skillMeta.commits) resources.push({ role: "write-path", value: ".", source: "skill.commits" });
  for (const permission of skillMeta.permissions) resources.push({ role: "unknown", value: `aeon.permission:${permission}`, source: "skill.permissions" });
  for (const required of skillMeta.requires) resources.push({ role: "unknown", value: `aeon.requires:${required}`, source: "skill.requires" });
  for (const mcp of skillMeta.mcp) resources.push({ role: "mcp-tool", value: `aeon.mcp:${mcp}`, source: "skill.mcp" });
  return createActionRequest({
    id: input.id || `aeon-${crypto.randomUUID()}`,
    runtime: "aeon",
    toolName: "aeon.skill.preflight",
    args: {
      skill,
      var: variable,
      trigger,
      repo,
      runId: input.runId,
      actor: input.actor,
    },
    cwd: input.cwd,
    actor: { id: String(input.actor || ""), runtime: "github-actions" },
    resources,
    context: `Aeon preflight for skill ${skill}`,
    metadata: {
      skill,
      trigger,
      repo,
      runId: input.runId,
      actor: input.actor,
      skillMeta,
    },
  });
}

function readSkillMetadata(cwd, skill) {
  const empty = { commits: false, permissions: [], requires: [], mcp: [] };
  if (!skill || !/^[a-zA-Z0-9_-]+$/.test(skill)) return empty;
  const file = path.join(cwd, "skills", skill, "SKILL.md");
  if (!fs.existsSync(file)) return empty;
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return empty;
  try {
    const meta = yaml.load(match[1]) || {};
    return {
      commits: meta.commits === true,
      permissions: arrayOfStrings(meta.permissions),
      requires: arrayOfStrings(meta.requires),
      mcp: arrayOfStrings(meta.mcp),
    };
  } catch {
    return empty;
  }
}

function arrayOfStrings(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

function insertPreflightBlock(workflow) {
  const cleaned = removeBlock(workflow, PREFLIGHT_START, PREFLIGHT_END);
  const target = "\n      - name: Run pre-fetch scripts\n";
  const index = cleaned.indexOf(target);
  if (index < 0) throw new Error("Could not find Aeon pre-fetch step insertion point");
  return `${cleaned.slice(0, index)}\n${preflightBlock()}${cleaned.slice(index)}`;
}

function removeBlock(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) return text;
  const end = text.indexOf(endMarker, start);
  if (end < 0) return text;
  const after = text.indexOf("\n", end);
  return `${text.slice(0, start).replace(/\n+$/, "\n")}${text.slice(after >= 0 ? after + 1 : text.length)}`;
}

function preflightBlock() {
  return [
    `      ${PREFLIGHT_START}`,
    "      - name: Charon preflight",
    "        id: charon_preflight",
    "        if: steps.work.outputs.mode != ''",
    "        env:",
    "          SKILL: ${{ steps.skill.outputs.name }}",
    "          SKILL_VAR: ${{ inputs.var }}",
    "          AEON_ACTOR: ${{ github.actor }}",
    "          AEON_TRIGGER: ${{ github.event_name == 'repository_dispatch' && github.event.action || github.event_name }}",
    "        run: |",
    "          npx -y github:CharonAI-code/charon aeon preflight \\",
    "            --skill \"$SKILL\" \\",
    "            --var \"$SKILL_VAR\" \\",
    "            --trigger \"$AEON_TRIGGER\" \\",
    "            --repo \"$GITHUB_REPOSITORY\" \\",
    "            --run-id \"$GITHUB_RUN_ID\" \\",
    "            --actor \"$AEON_ACTOR\" \\",
    "            --policy charon.aeon.yml",
    `      ${PREFLIGHT_END}`,
    "",
  ].join("\n");
}

function defaultAeonPolicy() {
  return {
    version: 1,
    defaultVerdict: "PASS",
    bounds: {
      pass: [],
      pause: [],
      deny: [],
      rules: [
        { id: "aeon.workflow_write.pause", verdict: "PAUSE", role: "write-path", includes: "" },
        { id: "aeon.external_feature.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:external-feature" },
        { id: "aeon.auto_merge.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:auto-merge" },
        { id: "aeon.deploy.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:deploy-prototype" },
        { id: "aeon.wallet.pause", verdict: "PAUSE", role: "mcp-tool", includes: "aeon.skill:vigil-revoke" },
        { id: "aeon.workflow_edit.deny", verdict: "DENY", role: "mcp-tool", includes: "aeon.skill:workflow-audit" },
      ],
    },
  };
}

function writeReceipt(cwd, receipt) {
  const dir = path.join(cwd, RECEIPTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${receipt.createdAt.replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}.json`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
  return { path: file };
}

module.exports = {
  CONFIG,
  installAeonEnforcement,
  readAeonEnforcementReport,
  runAeonPreflight,
  createAeonAction,
  defaultAeonPolicy,
};
