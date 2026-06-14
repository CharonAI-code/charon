// -nocheck
// @ts-nocheck
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { defaultPolicy, validatePolicy } = require("../../core/policy/runtime");

const CONFIG = "charon.yml";
const PROPOSALS_DIR = path.join(".charon", "policy-proposals");
const RECEIPTS_DIR = path.join(".charon", "receipts");

function policyCommand(args) {
  const [sub, ...rest] = args;
  if (sub === "synth") return policySynthCommand();
  if (sub === "review") return policyReviewCommand(rest);
  if (sub === "apply") return policyApplyCommand(rest);
  throw new Error("usage: charon policy synth | review [id|latest] | apply <id|latest> [--yes]");
}

function policySynthCommand() {
  const policy = loadPolicy();
  const proposal = synthesizePolicyProposal(policy);
  ensureDir(PROPOSALS_DIR);
  const file = path.join(PROPOSALS_DIR, `${proposal.id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(proposal, null, 2)}\n`);
  printPolicyProposal(proposal, file);
}

function policyReviewCommand(args) {
  const proposal = loadPolicyProposal(args[0] || "latest");
  printPolicyProposal(proposal.proposal, proposal.file);
}

function policyApplyCommand(args) {
  const target = args[0] || "latest";
  const yes = args.includes("--yes");
  const { proposal, file } = loadPolicyProposal(target);
  const loosens = proposal.changes.filter((change) => change.kind === "loosen");
  if (loosens.length && !yes) {
    throw new Error("proposal contains loosening changes. Re-run with --yes to apply explicitly.");
  }
  const next = applyPolicyChanges(loadPolicy(), proposal.changes);
  validatePolicy(next);
  fs.writeFileSync(CONFIG, yaml.dump(next, { lineWidth: 100 }));
  proposal.status = "applied";
  proposal.appliedAt = new Date().toISOString();
  fs.writeFileSync(file, `${JSON.stringify(proposal, null, 2)}\n`);
  console.log(`Applied ${proposal.id}`);
  console.log(`Policy: ${path.resolve(CONFIG)}`);
}

function synthesizePolicyProposal(policy) {
  const changes = [...inferPackageScriptChanges(policy), ...inferTraceChanges(policy)];
  for (const item of [".env", ".env.*", "~/.ssh/**", "~/.aws/**", "~/.config/gh/**"]) {
    if (!policy.controls.files.deny.includes(item)) {
      changes.push(policyChange("tighten", "controls.files.deny", "add", item, "protect common sensitive path"));
    }
  }
  const deduped = dedupeChanges(changes);
  return {
    schema: "charon.policyProposal.v1",
    id: `cp-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    createdAt: new Date().toISOString(),
    status: "pending",
    policyHash: hashObject(policy),
    summary: {
      tighten: deduped.filter((change) => change.kind === "tighten").length,
      loosen: deduped.filter((change) => change.kind === "loosen").length,
    },
    changes: deduped,
  };
}

function inferPackageScriptChanges(policy) {
  if (!fs.existsSync("package.json")) return [];
  let pkg;
  try {
    pkg = readJson("package.json");
  } catch {
    return [];
  }
  const changes = [];
  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  for (const [name, command] of Object.entries(scripts)) {
    if (["test", "lint", "typecheck", "build"].includes(name) && !hasStructuredRule(policy, `package.${name}`)) {
      changes.push(policyChange("loosen", "bounds.rules", "add", packageScriptRule(`package.${name}`, "PASS", command), `allow package script: ${name}`));
    }
    if (/publish|release|deploy/i.test(name) && !hasStructuredRule(policy, `package.${name}`)) {
      changes.push(policyChange("tighten", "bounds.rules", "add", packageScriptRule(`package.${name}`, "PAUSE", command), `review package script: ${name}`));
    }
  }
  return changes;
}

function inferTraceChanges(policy) {
  const changes = [];
  for (const file of receiptFiles().slice(0, 50)) {
    const receipt = readJson(file);
    const trace = receipt.trace || {};
    if (trace.action && trace.action.status === "denied" && trace.action.match && !policy.bounds.deny.includes(trace.action.match)) {
      changes.push(policyChange("tighten", "bounds.deny", "add", trace.action.match, "preserve denied action from trace"));
    }
    if (trace.network && trace.network.status === "denied") {
      for (const host of trace.network.denied || []) {
        if (!hostAllowed(host, policy.controls.network.allow)) {
          changes.push(policyChange("loosen", "controls.network.allow", "add", host, "previous trace requested host"));
        }
      }
    }
    if (trace.files && trace.files.status === "denied") {
      for (const match of trace.files.matches || []) {
        if (!policy.controls.files.deny.includes(match)) {
          changes.push(policyChange("tighten", "controls.files.deny", "add", match, "preserve denied file path from trace"));
        }
      }
    }
  }
  return changes;
}

function packageScriptRule(id, verdict, command) {
  const parts = String(command).trim().split(/\s+/).filter(Boolean);
  return { id, verdict, command: parts[0] || command, argsIncludes: parts.slice(1, 3) };
}

function hasStructuredRule(policy, id) {
  return Array.isArray(policy.bounds.rules) && policy.bounds.rules.some((rule) => rule.id === id);
}

function hostAllowed(host, allowlist) {
  return (allowlist || []).some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function policyChange(kind, target, op, value, reason) {
  return { kind, target, op, value, reason };
}

function dedupeChanges(changes) {
  const seen = new Set();
  return changes.filter((change) => {
    const key = `${change.kind}:${change.target}:${change.op}:${stableJson(change.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyPolicyChanges(policy, changes) {
  const next = JSON.parse(JSON.stringify(policy));
  for (const change of changes) {
    if (change.op !== "add") continue;
    const target = getPolicyArray(next, change.target);
    if (!target.some((value) => stableJson(value) === stableJson(change.value))) target.push(change.value);
  }
  return next;
}

function getPolicyArray(policy, target) {
  const parts = target.split(".");
  let cursor = policy;
  for (const part of parts) {
    if (!cursor[part]) cursor[part] = {};
    cursor = cursor[part];
  }
  if (!Array.isArray(cursor)) throw new Error(`policy target is not an array: ${target}`);
  return cursor;
}

function printPolicyProposal(proposal, file) {
  console.log(`Proposal: ${proposal.id}`);
  console.log(`File: ${path.resolve(file)}`);
  console.log(`Tighten: ${proposal.summary.tighten}`);
  console.log(`Loosen: ${proposal.summary.loosen}`);
  for (const change of proposal.changes) {
    console.log(`${change.kind.toUpperCase()} ${change.target} += ${formatPolicyValue(change.value)} - ${change.reason}`);
  }
}

function formatPolicyValue(value) {
  if (value && typeof value === "object") return value.id || JSON.stringify(value);
  return String(value);
}

function loadPolicy() {
  if (!fs.existsSync(CONFIG)) return defaultPolicy();
  const policy = yaml.load(fs.readFileSync(CONFIG, "utf8"));
  validatePolicy(policy, CONFIG);
  return policy;
}

function loadPolicyProposal(target) {
  const file = target === "latest" ? proposalFiles()[0] : path.join(PROPOSALS_DIR, `${target}.json`);
  if (!file || !fs.existsSync(file)) throw new Error(`policy proposal not found: ${target}`);
  return { proposal: readJson(file), file };
}

function proposalFiles() {
  if (!fs.existsSync(PROPOSALS_DIR)) return [];
  return fs.readdirSync(PROPOSALS_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(PROPOSALS_DIR, file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function receiptFiles() {
  if (!fs.existsSync(RECEIPTS_DIR)) return [];
  return fs.readdirSync(RECEIPTS_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(RECEIPTS_DIR, file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hashObject(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

module.exports = { policyCommand };
