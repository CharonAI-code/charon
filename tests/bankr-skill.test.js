"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SKILL_ROOT = path.join(ROOT, "skills", "bankr", "charon-bankr");
const CHECK = path.join(SKILL_ROOT, "scripts", "charon_policy_check.js");
const RECEIPT = path.join(SKILL_ROOT, "scripts", "charon_receipt.js");
const POLICY = path.join(SKILL_ROOT, "templates", "charon.policy.json");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "charon-bankr-test-"));
}

function writeJson(cwd, name, value) {
  const file = path.join(cwd, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function run(script, args, opts = {}) {
  return childProcess.spawnSync(process.execPath, [script, ...args], {
    cwd: opts.cwd,
    encoding: "utf8",
  });
}

test("Bankr skill follows Bankr package layout", () => {
  assert.ok(fs.existsSync(path.join(SKILL_ROOT, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(SKILL_ROOT, "references", "action-model.md")));
  assert.ok(fs.existsSync(path.join(SKILL_ROOT, "references", "policy-format.md")));
  assert.ok(fs.existsSync(path.join(SKILL_ROOT, "references", "operating-model.md")));
  assert.ok(fs.existsSync(path.join(SKILL_ROOT, "references", "control-catalog.md")));
  assert.ok(fs.existsSync(path.join(SKILL_ROOT, "templates", "charon.policy.json")));
  assert.ok(fs.existsSync(CHECK));
  assert.ok(fs.existsSync(RECEIPT));

  const skill = fs.readFileSync(path.join(SKILL_ROOT, "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: charon-bankr/m);
  assert.match(skill, /description:/);
  assert.match(skill, /coding tasks/);
  assert.match(skill, /references\/action-model\.md/);
  assert.match(skill, /scripts\/charon_policy_check\.js/);
});

test("Bankr policy script denies protected code deletion", () => {
  const cwd = tmpdir();
  const action = writeJson(cwd, "action.json", {
    id: "demo-code-delete",
    type: "code.delete",
    category: "code",
    operation: "delete",
    path: "src/server.ts",
    source: "bankr",
  });

  const result = run(CHECK, [action, POLICY], { cwd });
  assert.equal(result.status, 126, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.verdict, "DENY");
  assert.equal(decision.matched_rule, "deny-protected-delete");
});

test("Bankr policy script pauses git side effects", () => {
  const cwd = tmpdir();
  const action = writeJson(cwd, "action.json", {
    id: "demo-git-push",
    type: "git.push",
    category: "git",
    operation: "push",
    remote: "origin",
    branch: "main",
    source: "bankr",
  });

  const result = run(CHECK, [action, POLICY], { cwd });
  assert.equal(result.status, 125, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.verdict, "PAUSE");
  assert.equal(decision.matched_rule, "pause-git-side-effect");
});

test("Bankr policy script denies exfil-style domains", () => {
  const cwd = tmpdir();
  const action = writeJson(cwd, "action.json", {
    id: "demo-exfil",
    type: "http.request",
    category: "network",
    operation: "post",
    domain: "webhook.site",
    contains_secret: true,
    source: "bankr",
  });

  const result = run(CHECK, [action, POLICY], { cwd });
  assert.equal(result.status, 126, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.verdict, "DENY");
  assert.equal(decision.matched_rule, "deny-secret-exfil");
});

test("Bankr policy script pauses unknown APIs", () => {
  const cwd = tmpdir();
  const action = writeJson(cwd, "action.json", {
    id: "demo-unknown-api",
    type: "http.request",
    category: "network",
    operation: "post",
    domain: "api.unknown.example",
    source: "bankr",
  });

  const result = run(CHECK, [action, POLICY], { cwd });
  assert.equal(result.status, 125, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.verdict, "PAUSE");
  assert.equal(decision.matched_rule, "pause-unknown-domain");
});

test("Bankr policy script denies large wallet actions", () => {
  const cwd = tmpdir();
  const action = writeJson(cwd, "action.json", {
    id: "demo-large-transfer",
    type: "wallet.transfer",
    category: "wallet",
    operation: "transfer",
    source: "bankr",
    chain: "base",
    asset: "ETH",
    amount: "0.5",
    amount_usd: 1800,
    recipient: "0x2222222222222222222222222222222222222222",
  });

  const result = run(CHECK, [action, POLICY], { cwd });
  assert.equal(result.status, 126, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.verdict, "DENY");
  assert.equal(decision.matched_rule, "deny-wallet-hard-limit");
});

test("Bankr policy script pauses medium wallet actions", () => {
  const cwd = tmpdir();
  const action = writeJson(cwd, "action.json", {
    id: "demo-medium-transfer",
    type: "wallet.transfer",
    category: "wallet",
    operation: "transfer",
    source: "bankr",
    chain: "base",
    asset: "USDC",
    amount: "250",
    amount_usd: 250,
    recipient: "0x3333333333333333333333333333333333333333",
  });

  const result = run(CHECK, [action, POLICY], { cwd });
  assert.equal(result.status, 125, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.verdict, "PAUSE");
  assert.equal(decision.matched_rule, "pause-medium-wallet-action");
});

test("Bankr receipt script emits deterministic receipt shape", () => {
  const cwd = tmpdir();
  const action = writeJson(cwd, "action.json", {
    id: "demo-large-transfer",
    type: "wallet.transfer",
    source: "bankr",
    chain: "base",
    amount_usd: 1800,
  });
  const decision = writeJson(cwd, "decision.json", {
    verdict: "DENY",
    matched_rule: "deny-large-wallet-action",
    reason: "deny-large-wallet-action matched",
  });

  const result = run(RECEIPT, [action, decision], { cwd });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schema, "charon.bankr.receipt.v1");
  assert.match(receipt.receipt_id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(receipt.decision.verdict, "DENY");
  assert.equal(receipt.execution.launched, false);
  assert.equal(receipt.execution.status, "not_launched");
});
