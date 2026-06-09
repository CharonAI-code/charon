// -nocheck
// @ts-nocheck
"use strict";

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const normalizationCore = require("../core/normalization");
const { createActionRequest } = require("../action");
const { ActionCoordinator } = require("../trusted-process/coordinator");
const { createTrustedReceipt, verifyTrustedReceipt } = require("../trusted-process/receipt");

const VERSION = "0.2.0";
const CONFIG = "charon.yml";
const STATE_DIR = ".charon";
const RECEIPTS_DIR = path.join(STATE_DIR, "receipts");
const QUEUE_DIR = path.join(STATE_DIR, "queue");
const PROPOSALS_DIR = path.join(STATE_DIR, "policy-proposals");
const GENERATED_DIR = path.join(STATE_DIR, "generated");
const KEY_FILE = path.join(STATE_DIR, "receipt.key");
const IDENTITY_FILE = path.join(STATE_DIR, "identity.json");
const IDENTITY_KEY_FILE = path.join(STATE_DIR, "identity.key");
const AEON_WORKFLOW = path.join(".github", "workflows", "aeon.yml");
const AEON_WORKFLOW_BACKUP = path.join(".github", "workflows", "aeon.yml.charon.bak");
const AEON_WORKFLOW_BEGIN = "# >>> charon";
const AEON_WORKFLOW_END = "# <<< charon";
const SECRET_PATTERNS = [
  ["anthropic", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ["openai_project", /\bsk-proj-[A-Za-z0-9_-]{20,}/g],
  ["openai", /\bsk-[A-Za-z0-9]{20,}/g],
  ["github", /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{30,}/g],
  ["google_api", /\bAIza[0-9A-Za-z_-]{35}/g],
  ["aws_access_key", /\b(?:AKIA|ASIA|AGPA|AROA|ANPA|ANVA|ASCA|AIDA|AIPA)[0-9A-Z]{16}\b/g],
  ["stripe", /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{20,}/g],
  ["slack", /\bxox[abprseo]-[A-Za-z0-9-]{10,}/g],
  ["npm_token", /\bnpm_[A-Za-z0-9]{36,}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ["private_key_pem", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
];

async function main(argv) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "init":
      return init(args);
    case "setup":
      return setupCommand(args);
    case "doctor":
      return doctor(args);
    case "selftest":
      return selftestCommand(args);
    case "compile":
      return compileCommand(args);
    case "gate":
      return gateCommand(args);
    case "queue":
      return queueCommand(args);
    case "approve":
      return approveCommand(args);
    case "reject":
      return rejectCommand(args);
    case "history":
      return receiptsCommand(args);
    case "trace":
      return traceCommand(args);
    case "status":
      return statusCommand(args);
    case "policy":
      return policyCommand(args);
    case "keygen":
      return keygenCommand(args);
    case "identity":
      return identityCommand(args);
    case "run":
      return runCommand(args);
    case "receipts":
      return receiptsCommand(args);
    case "verify":
      return verifyCommand(args);
    case "aeon":
      return legacyAeonCommand(args);
    case "--version":
    case "-v":
      console.log(VERSION);
      return;
    case "--help":
    case "-h":
    case undefined:
      return help();
    default:
      throw new Error(`unknown command: ${cmd}\nRun charon --help.`);
  }
}

function help() {
  console.log(`charon ${VERSION}

Install:
  npx github:CharonAI-code/charon setup
  charon status

Usage:
  charon init
  charon setup
  charon doctor
  charon selftest
  charon compile
  charon gate -- <command>
  charon queue
  charon approve <id> [--yes]
  charon reject <id>
  charon history [list|latest|inspect <id|latest>]
  charon trace <id|latest>
  charon status <id|latest>
  charon policy synth
  charon policy review [id|latest]
  charon policy apply <id|latest> [--yes]
  charon keygen
  charon identity
  charon run -- <command>
  charon receipts [list|latest|inspect <id|latest>]
  charon verify <receipt|latest>

Runtime policy enforcement for autonomous agents.
`);
}

function init(args) {
  const force = args.includes("--force");
  if (fs.existsSync(CONFIG) && !force) {
    console.log(`${CONFIG} already exists.`);
    console.log("Use `charon init --force` to overwrite it.");
    return;
  }
  ensureDir(RECEIPTS_DIR);
  ensureDir(QUEUE_DIR);
  fs.writeFileSync(CONFIG, yaml.dump(defaultPolicy(), { lineWidth: 100 }));
  console.log(`Created ${path.resolve(CONFIG)}`);
}

function setupCommand(args) {
  const globalInstall = ensureGlobalCommand(args);
  init(["--policy-only", ...args]);
  ensureIdentity();
  printSetupSummary({
    title: "Charon is ready.",
    mode: "local",
    steps: [
      ["policy", path.resolve(CONFIG)],
      ["identity", path.resolve(IDENTITY_FILE)],
      ["command", globalInstall],
      ["next", "run `charon gate -- <command>`"],
    ],
  });
}

function doctor(args = []) {
  void args;
  const checks = [
    ["Node.js", true, process.version, true],
    ["platform", true, `${os.type()} ${os.release()}`, true],
    ["charon.yml", fs.existsSync(CONFIG), path.resolve(CONFIG), true],
    ["identity", fs.existsSync(IDENTITY_FILE), path.resolve(IDENTITY_FILE), false],
  ];

  for (const [name, ok, detail, required] of checks) {
    const label = ok ? "OK " : required ? "NO " : "WARN";
    console.log(`${label} ${name}${detail ? ` - ${detail}` : ""}`);
  }

  if (!checks.every(([, ok, , required]) => !required || ok)) {
    console.log("");
    console.log("Run `charon setup` to create local policy and identity.");
    process.exitCode = 1;
  }
  printPathAdvice();
}

function selftestCommand(args = []) {
  if (!fs.existsSync(CONFIG)) init([]);
  ensureIdentity();
  const checks = [];
  checks.push(runSelftestCheck("status", ["status"], 0));
  checks.push(runSelftestCheck("pass", ["gate", "--", "node", "-e", "console.log('charon-selftest-pass')"], 0));
  checks.push(runSelftestCheck("deny file", ["gate", "--", "cat", ".env"], 126));
  checks.push(runSelftestCheck("deny network", ["gate", "--", "curl", "https://webhook.site/charon-selftest"], 126));
  if (policyHasPause(loadPolicy())) {
    checks.push(runSelftestCheck("pause review", ["gate", "--no-prompt", "--", "gh", "release", "create", "charon-selftest"], 125, { allowDeny: true }));
  } else {
    checks.push({ name: "pause review", ok: true, detail: "skipped; no pause rules in policy" });
  }
  checks.push(runSelftestCheck("verify latest", ["verify", "latest"], 0));

  console.log("");
  console.log("Charon selftest");
  console.log("");
  for (const check of checks) {
    console.log(`${check.ok ? "OK " : "NO "} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
  }
  const failed = checks.filter((check) => !check.ok);
  if (failed.length) {
    console.log("");
    console.log("Run `charon doctor`, then `charon setup`, and retry `charon selftest`.");
    process.exitCode = 1;
  }
  if (!args.includes("--quiet")) printPathAdvice();
}

function legacyAeonCommand(args) {
  if (args.includes("--legacy-ok")) return aeonCommand(args.filter((arg) => arg !== "--legacy-ok"));
  throw new Error("Aeon support is legacy. Re-run with `charon aeon --legacy-ok ...` only for old local experiments.");
}

function runSelftestCheck(name, args, expected, options = {}) {
  const result = childProcess.spawnSync(process.execPath, [cliPath(), ...args], {
    cwd: process.cwd(),
    env: { ...process.env, CHARON_NO_PROMPT: "1" },
    encoding: "utf8",
  });
  const ok = result.status === expected || (options.allowDeny && result.status === 126);
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim().split(/\n/).filter(Boolean).slice(-1)[0] || "";
  return { name, ok, detail: ok ? "" : `exit ${result.status}; ${output}` };
}

function policyHasPause(policy) {
  return Boolean(
    policy &&
    policy.bounds &&
    (
      (Array.isArray(policy.bounds.pause) && policy.bounds.pause.length) ||
      (Array.isArray(policy.bounds.rules) && policy.bounds.rules.some((rule) => String(rule.verdict || "").toUpperCase() === "PAUSE"))
    )
  );
}

function cliPath() {
  return path.resolve(__dirname, "..", "..", "..", "bin", "charon.js");
}

function compileCommand(args) {
  void args;
  const policy = loadPolicy();
  const compiled = normalizePolicyForHash(policy);
  ensureDir(GENERATED_DIR);
  const out = path.join(GENERATED_DIR, "charon-policy.yml");
  fs.writeFileSync(out, yaml.dump(compiled, { lineWidth: 100 }));
  console.log(yaml.dump(compiled, { lineWidth: 100 }).trimEnd());
  console.log("");
  console.log(`policy_hash: ${hashObject(compiled)}`);
  console.log(`generated: ${path.resolve(out)}`);
}

function keygenCommand(args) {
  const force = args.includes("--force");
  ensureDir(STATE_DIR);
  if ((fs.existsSync(IDENTITY_FILE) || fs.existsSync(IDENTITY_KEY_FILE)) && !force) {
    console.log("Charon identity already exists.");
    console.log("Use `charon keygen --force` to replace it.");
    return;
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  fs.writeFileSync(IDENTITY_KEY_FILE, privateKey, { mode: 0o600 });
  const identity = {
    schema: "charon.identity.v1",
    type: "ed25519",
    publicKey,
    privateKeyPath: IDENTITY_KEY_FILE,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(IDENTITY_FILE, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  console.log(`Created identity ${path.resolve(IDENTITY_FILE)}`);
}

function identityCommand() {
  const identity = loadIdentity();
  if (!identity) {
    console.log("No Charon identity. Run `charon keygen`.");
    return;
  }
  console.log(`Type: ${identity.type}`);
  console.log(`Public key: ${identity.publicKey.trim().replace(/\n/g, "\\n")}`);
  console.log(`Key path: ${path.resolve(identity.privateKeyPath || IDENTITY_KEY_FILE)}`);
}

function runCommand(args, meta = {}) {
  return gateCommand(args, { ...meta, compatibilityCommand: "run" });
}

function gateCommand(args, meta = {}) {
  return gateCommandV2(args, meta);
}

function gateCommandV2(args, meta = {}) {
  const sep = args.indexOf("--");
  const gateFlags = sep >= 0 ? args.slice(0, sep) : [];
  const command = sep >= 0 ? args.slice(sep + 1) : args.filter((arg) => !arg.startsWith("--"));
  if (!command.length) throw new Error("usage: charon gate -- <command>");

  const policy = loadPolicy();
  const action = createShellAction(command, meta);
  const runtimePolicy = runtimePolicyFromCharon(policy, meta.approvedQueueId);
  const typedCoordinator = new ActionCoordinator({ policy: runtimePolicy, signer: receiptSigner() });
  const decision = meta.approvedQueueId
    ? {
        verdict: "PASS",
        reason: `approved paused action: ${meta.approvedQueueId}`,
        ruleId: `queue.${meta.approvedQueueId}.approved`,
        resources: action.resources,
      }
    : decisionFromLegacyNormalizer(command, policy, action, typedCoordinator);

  if (decision.verdict === "DENY") {
    const receipt = writeTrustedReceiptToDisk(createDecisionReceipt({ action, decision, policy: runtimePolicy }));
    console.error(`DENY ${decision.reason}`);
    console.error(`Receipt: ${receipt.path}`);
    const err = new Error("action denied");
    err.exitCode = 126;
    throw err;
  }

  if (decision.verdict === "PAUSE") {
    const item = enqueueActionV2({ action, policy, reason: decision.reason, meta });
    const pausedAction = { ...action, metadata: { ...(action.metadata || {}), queueId: item.id } };
    const receipt = writeTrustedReceiptToDisk(createDecisionReceipt({ action: pausedAction, decision, policy: runtimePolicy }));
    if (shouldPromptForPausedAction(gateFlags)) {
      return promptPausedAction({ item: item.item, receipt, reason: decision.reason });
    }
    printPausedAction({ item: item.item, receipt, reason: decision.reason });
    const err = new Error("action paused");
    err.exitCode = 125;
    throw err;
  }

  const result = childProcess.spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: scrubEnv(process.env, policy),
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const exitCode = typeof result.status === "number" ? result.status : result.error ? 127 : 0;
  const outputBoundary = scanOutputBoundary(result.stdout || "", result.stderr || "", policy);
  const finalDecision = outputBoundary.status === "denied"
    ? {
        verdict: "DENY",
        reason: outputBoundary.reason,
        ruleId: "output.secret",
        resources: action.resources,
        trace: {
          schema: "charon.trace.v1",
          output: outputBoundary.receiptOutput,
          execution: { status: "launched", runner: "local", exitCode: 126 },
          explain: [`output decision: denied ${outputBoundary.reason}`],
        },
      }
    : decision;
  const finalExitCode = outputBoundary.status === "denied" ? 126 : exitCode;
  const receipt = writeTrustedReceiptToDisk(createExecutionReceipt({
    action,
    decision: finalDecision,
    policy: runtimePolicy,
    exitCode: finalExitCode,
    error: result.error ? result.error.message : "",
  }));
  console.log(`Charon receipt: ${receipt.path}`);
  process.exitCode = finalExitCode;
}

function queueCommand(args) {
  const sub = args[0] || "list";
  if (sub !== "list") throw new Error("usage: charon queue");
  const items = queueFiles();
  if (!items.length) {
    console.log("No paused actions.");
    return;
  }
  for (const file of items) {
    const item = readJson(file);
    printQueuedAction(item);
  }
}

function approveCommand(args) {
  const id = args.find((arg) => !arg.startsWith("--"));
  const yes = args.includes("--yes");
  if (!id) throw new Error("usage: charon approve <id> [--yes]");
  const item = loadQueuedAction(id);
  verifyQueuedAction(item);
  if (item.schema === "charon.queue.v2") return approveCommandV2(item, { yes });
  if (item.status !== "paused") throw new Error(`queued action is not paused: ${id}`);
  if (item.cwd) process.chdir(item.cwd);
  const policy = loadPolicy();
  const currentPolicyHash = hashObject(normalizePolicyForHash(policy));
  const safety = checkApprovalSafety(item, policy, currentPolicyHash);
  if (!safety.safe && (!yes || safety.blocking)) {
    const detail = safety.reasons.join("; ");
    const suffix = safety.canOverride ? " Re-run with --yes to approve under the current policy." : "";
    throw new Error(`approval safety check failed: ${detail}.${suffix}`);
  }
  item.status = "approved";
  item.reviewedAt = new Date().toISOString();
  item.decision = "approved";
  item.approval = {
    policyHash: currentPolicyHash,
    queuedPolicyHash: item.policyHash,
    safetyReasons: safety.reasons,
    override: Boolean(yes && !safety.safe),
  };
  saveQueuedAction(item);
  console.log(`Approved ${id}`);
  if (safety.reasons.length) console.log(`Approval note: ${safety.reasons.join("; ")}`);
  return gateCommand(["--", ...item.command], { ...item.meta, approvedQueueId: id, approvalPolicyHash: currentPolicyHash });
}

function approveCommandV2(item, opts = {}) {
  if (item.status !== "paused") throw new Error(`queued action is not paused: ${item.id}`);
  if (item.cwd) process.chdir(item.cwd);
  const policy = loadPolicy();
  const currentPolicyHash = hashObject(normalizePolicyForHash(policy));
  if (item.policyHash && item.policyHash !== currentPolicyHash && !opts.yes) {
    throw new Error(`approval safety check failed: policy changed queued=${item.policyHash} current=${currentPolicyHash}. Re-run with --yes to approve under the current policy.`);
  }
  item.status = "approved";
  item.reviewedAt = new Date().toISOString();
  item.decision = "approved";
  item.approval = {
    policyHash: currentPolicyHash,
    queuedPolicyHash: item.policyHash,
    override: Boolean(opts.yes && item.policyHash !== currentPolicyHash),
  };
  saveQueuedAction(item);
  console.log(`Approved ${item.id}`);
  const command = shellCommandFromAction(item.action);
  return gateCommand(["--", ...command], { ...(item.meta || {}), approvedQueueId: item.id, approvalPolicyHash: currentPolicyHash });
}

function checkApprovalSafety(item, policy, currentPolicyHash) {
  const reasons = [];
  let blocking = false;
  if (item.policyHash && item.policyHash !== currentPolicyHash) {
    reasons.push(`policy changed queued=${item.policyHash} current=${currentPolicyHash}`);
  }
  const decision = decideAction(item.command, policy);
  if (decision.verdict === "DENY") {
    reasons.push(`current policy now denies action: ${decision.reason}`);
    blocking = true;
  } else if (decision.verdict === "PASS") {
    reasons.push("current policy would pass this action without approval");
  } else if (decision.verdict === "PAUSE" && item.reason && decision.reason !== item.reason) {
    reasons.push(`pause reason changed from ${item.reason} to ${decision.reason}`);
  }
  return {
    safe: reasons.length === 0,
    blocking,
    canOverride: !blocking,
    reasons,
    currentDecision: decision.verdict,
  };
}

function rejectCommand(args) {
  const id = args[0];
  if (!id) throw new Error("usage: charon reject <id>");
  const item = loadQueuedAction(id);
  verifyQueuedAction(item);
  if (item.schema === "charon.queue.v2") return rejectCommandV2(item);
  if (item.cwd) process.chdir(item.cwd);
  item.status = "rejected";
  item.reviewedAt = new Date().toISOString();
  item.decision = "rejected";
  saveQueuedAction(item);
  const policy = loadPolicy();
  const receipt = writeReceipt({
    verdict: "DENY",
    reason: `rejected paused action: ${id}`,
    command: item.command,
    policy,
    meta: { ...item.meta, rejectedQueueId: id },
    exitCode: 126,
  });
  console.log(`Rejected ${id}`);
  console.log(`Receipt: ${receipt.path}`);
}

function rejectCommandV2(item) {
  if (item.cwd) process.chdir(item.cwd);
  item.status = "rejected";
  item.reviewedAt = new Date().toISOString();
  item.decision = "rejected";
  saveQueuedAction(item);
  const policy = loadPolicy();
  const runtimePolicy = runtimePolicyFromCharon(policy);
  const decision = {
    verdict: "DENY",
    reason: `rejected paused action: ${item.id}`,
    ruleId: `queue.${item.id}.rejected`,
    resources: item.action.resources || [],
  };
  const receipt = writeTrustedReceiptToDisk(createTrustedReceipt({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    action: item.action,
    decision,
    policy: runtimePolicy,
    signer: receiptSigner(),
  }));
  console.log(`Rejected ${item.id}`);
  console.log(`Receipt: ${receipt.path}`);
}

function statusCommand(args) {
  if (!args.length) return printStatusDashboard();
  const target = args[0] || "latest";
  if (target === "latest") return receiptsCommand(["latest"]);
  const queued = queueFiles().find((file) => path.basename(file, ".json") === target);
  if (queued) {
    const item = readJson(queued);
    console.log(`${item.id} ${item.status}`);
    console.log(`Action: ${item.command.join(" ")}`);
    console.log(`Reason: ${item.reason}`);
    return;
  }
  return receiptsCommand(["inspect", target]);
}

function traceCommand(args) {
  const target = args[0] || "latest";
  const files = receiptFiles();
  const file = target === "latest" ? files[0] : files.find((f) => receiptId(f) === target) || target;
  if (!file || !fs.existsSync(file)) throw new Error(`receipt not found: ${target}`);
  printTrace(readJson(file), file);
}

function createCharon(options = {}) {
  const cwd = options.cwd || process.cwd();
  return {
    async enforce(input, executor) {
      const previous = process.cwd();
      process.chdir(cwd);
      try {
        const policy = fs.existsSync(CONFIG) ? loadPolicy() : defaultPolicy();
        const coordinator = new ActionCoordinator({
          policy: runtimePolicyFromCharon(policy),
          signer: receiptSigner(),
        });
        const result = await coordinator.enforce({
          cwd,
          runtime: input.runtime || "sdk",
          toolName: input.toolName || "unknown",
          args: input.args !== undefined ? input.args : input.toolArgs,
          actor: input.actor,
          resources: input.resources,
          context: input.context,
          metadata: input.metadata,
        }, executor);
        const stored = writeTrustedReceiptToDisk(result.receipt);
        return {
          schema: "charon.sdkDecision.v2",
          verdict: result.decision.verdict,
          allowed: result.decision.verdict === "PASS",
          blocked: result.decision.verdict === "DENY",
          queued: result.decision.verdict === "PAUSE",
          pass: result.decision.verdict === "PASS",
          pause: result.decision.verdict === "PAUSE",
          deny: result.decision.verdict === "DENY",
          reason: result.decision.reason,
          receipt: stored.path,
          receiptId: stored.id,
          policyHash: result.receipt.policyHash,
          actionHash: result.receipt.actionHash,
          receiptHash: result.receipt.receiptHash,
          launched: result.launched,
          result: result.result,
          error: result.error ? result.error.message : "",
        };
      } finally {
        process.chdir(previous);
      }
    },
    gateToolCall(input) {
      const previous = process.cwd();
      process.chdir(cwd);
      try {
        const policy = fs.existsSync(CONFIG) ? loadPolicy() : defaultPolicy();
        const command = toolCallToCommand(input);
        const meta = {
          runtime: input.runtime || "sdk",
          skill: input.skill || "",
          toolName: input.toolName || "unknown",
          context: input.context || "",
        };
        const decision = decideAction(command, policy);
        const exitCode = decision.verdict === "PASS" ? 0 : decision.verdict === "PAUSE" ? 125 : 126;
        let queueId = "";
        if (decision.verdict === "PAUSE") {
          const queued = enqueueAction({ command, policy, reason: decision.reason, meta });
          queueId = queued.id;
        }
        const receipt = writeReceipt({
          verdict: decision.verdict,
          reason: decision.reason,
          command,
          policy,
          meta: queueId ? { ...meta, queueId } : meta,
          trace: completeTrace(decision.trace, decision.verdict === "PASS" ? "not_launched" : "not_launched"),
          exitCode,
        });
        return sdkDecision({ decision, receipt, queueId, exitCode, command, meta });
      } finally {
        process.chdir(previous);
      }
    },
  };
}

function sdkDecision({ decision, receipt, queueId, exitCode, command, meta }) {
  const verdict = decision.verdict;
  return {
    schema: "charon.sdkDecision.v1",
    verdict,
    allowed: verdict === "PASS",
    blocked: verdict === "DENY",
    queued: verdict === "PAUSE",
    pass: verdict === "PASS",
    pause: verdict === "PAUSE",
    deny: verdict === "DENY",
    reason: decision.reason,
    trace: receipt.receipt.trace,
    receipt: receipt.path,
    receiptId: path.basename(receipt.path, ".json"),
    queueId,
    exitCode,
    command: receipt.receipt.command,
    policyHash: receipt.receipt.policyHash,
    runtime: meta.runtime,
    skill: meta.skill || "",
    toolName: meta.toolName || "unknown",
    context: meta.context || "",
  };
}

function toolCallToCommand(input) {
  const toolName = input.toolName || "tool";
  const args = input.args !== undefined ? input.args : input.toolArgs;
  if (toolName === "shell" || toolName === "command") {
    if (Array.isArray(args)) return args.map(String);
    if (typeof args === "string") return ["sh", "-lc", args];
  }
  return [
    String(toolName),
    stringifyToolArgs(args),
    input.context ? String(input.context) : "",
  ].filter(Boolean);
}

function createShellAction(command, meta = {}) {
  return createActionRequest({
    runtime: meta.runtime || "local",
    toolName: "shell",
    args: command,
    cwd: process.cwd(),
    actor: meta.actor,
    context: meta.context || "",
    metadata: {
      ...meta,
      command,
    },
  });
}

function runtimePolicyFromCharon(policy, approvedQueueId = "") {
  const rules = [];
  if (approvedQueueId) {
    rules.push({ id: `queue.${approvedQueueId}.approved`, verdict: "PASS", role: "shell-command" });
    return { defaultVerdict: "PAUSE", rules };
  }

  for (const item of policy.bounds.deny || []) {
    rules.push({ id: `deny.${rules.length}`, verdict: "DENY", role: "shell-command", includes: item });
  }
  for (const item of (policy.controls && policy.controls.commands ? policy.controls.commands.deny : []) || []) {
    rules.push({ id: `command.deny.${rules.length}`, verdict: "DENY", role: "shell-command", includes: item });
  }
  for (const item of policy.bounds.pause || []) {
    rules.push({ id: `pause.${rules.length}`, verdict: "PAUSE", role: "shell-command", includes: item });
  }
  for (const item of policy.bounds.pass || []) {
    rules.push({ id: `pass.${rules.length}`, verdict: "PASS", role: "shell-command", includes: item });
  }

  for (const rule of policy.bounds.rules || []) {
    const converted = convertStructuredRule(rule);
    if (converted) rules.push(converted);
  }

  for (const item of (policy.controls && policy.controls.files ? policy.controls.files.deny : []) || []) {
    if (item.includes(".env") || item.includes(".ssh") || item.includes(".aws")) {
      rules.push({ id: `file.deny.${rules.length}`, verdict: "DENY", role: "secret", includes: item.replace("read:", "") });
    }
  }

  return {
    defaultVerdict: "PAUSE",
    rules,
  };
}

function convertStructuredRule(rule) {
  if (!rule || typeof rule !== "object") return null;
  if (rule.role) {
    return {
      id: rule.id || `rule.${Date.now()}`,
      verdict: String(rule.verdict || "PAUSE").toUpperCase(),
      role: rule.role,
      equals: rule.equals,
      includes: rule.includes,
      prefix: rule.prefix,
    };
  }
  const parts = [rule.command, rule.includes, ...(rule.argsIncludes || [])]
    .filter(Boolean)
    .map(String)
    .join(" ");
  if (!parts) return null;
  return {
    id: rule.id || `rule.${Date.now()}`,
    verdict: String(rule.verdict || "PAUSE").toUpperCase(),
    role: "shell-command",
    includes: parts,
  };
}

function receiptSigner() {
  const identity = loadIdentity();
  if (!identity || !fs.existsSync(identity.privateKeyPath || IDENTITY_KEY_FILE)) return undefined;
  return {
    keyId: hashObject(identity.publicKey).slice(0, 16),
    publicKey: identity.publicKey,
    privateKey: fs.readFileSync(identity.privateKeyPath || IDENTITY_KEY_FILE, "utf8"),
  };
}

function createExecutionReceipt({ action, decision, policy, exitCode, error }) {
  const execution = {
    launched: true,
    status: error || exitCode !== 0 ? "failed" : "completed",
    exitCode,
  };
  if (error) execution.error = error;
  return createTrustedReceipt({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    action,
    decision,
    policy,
    signer: receiptSigner(),
    execution,
    trace: decision.trace,
  });
}

function createDecisionReceipt({ action, decision, policy }) {
  return createTrustedReceipt({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    action,
    decision,
    policy,
    signer: receiptSigner(),
    trace: decision.trace,
  });
}

function decisionFromLegacyNormalizer(command, policy, action, coordinator) {
  const legacy = decideAction(command, policy);
  if (legacy.verdict !== "PASS") {
    return {
      verdict: legacy.verdict,
      reason: legacy.reason,
      ruleId: legacy.trace && legacy.trace.action && legacy.trace.action.match ? legacy.trace.action.match : "legacy.normalizer",
      resources: action.resources,
      trace: legacy.trace,
    };
  }
  const typed = coordinator.evaluate(action).decision;
  if (legacy.verdict === "PASS") {
    return {
      verdict: "PASS",
      reason: "inside bounds",
      ruleId: "legacy.pass",
      resources: action.resources,
      trace: legacy.trace,
    };
  }
  return typed;
}

function writeTrustedReceiptToDisk(receipt) {
  ensureDir(RECEIPTS_DIR);
  const id = `${receipt.createdAt.replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
  const file = path.join(RECEIPTS_DIR, `${id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
  return { id, path: path.resolve(file), receipt };
}

function stringifyToolArgs(args) {
  if (args === undefined || args === null) return "";
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

function policyCommand(args) {
  const [sub, ...rest] = args;
  if (sub === "synth") return policySynthCommand(rest);
  if (sub === "review") return policyReviewCommand(rest);
  if (sub === "apply") return policyApplyCommand(rest);
  throw new Error("usage: charon policy synth | review [id|latest] | apply <id|latest> [--yes]");
}

function policySynthCommand() {
  const policy = fs.existsSync(CONFIG) ? loadPolicy() : defaultPolicy();
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
  const base = fs.existsSync(CONFIG) ? loadPolicy() : defaultPolicy();
  const next = applyPolicyChanges(base, proposal.changes);
  validatePolicy(next);
  fs.writeFileSync(CONFIG, yaml.dump(next, { lineWidth: 100 }));
  proposal.status = "applied";
  proposal.appliedAt = new Date().toISOString();
  fs.writeFileSync(file, `${JSON.stringify(proposal, null, 2)}\n`);
  console.log(`Applied ${proposal.id}`);
  console.log(`Policy: ${path.resolve(CONFIG)}`);
}

function buildLocalCommand(command) {
  return command;
}

function receiptsCommand(args) {
  const sub = args[0] || "latest";
  const files = receiptFiles();
  if (!files.length) throw new Error("no receipts found");

  if (sub === "list") {
    for (const file of files.slice(0, 20)) {
      const data = readJson(file);
      console.log([
        receiptId(file),
        pad(data.verdict || "unknown", 7),
        data.meta && data.meta.runtime ? data.meta.runtime : "command",
        data.meta && data.meta.skill ? data.meta.skill : "",
        data.exitCode === undefined ? "" : `exit=${data.exitCode}`,
        data.createdAt || "",
      ].filter(Boolean).join("  "));
    }
    return;
  }

  if (sub === "latest") return printReceiptSummary(readJson(files[0]), files[0]);

  if (sub === "inspect") {
    const target = args[1] || "latest";
    const file = target === "latest" ? files[0] : files.find((f) => receiptId(f) === target);
    if (!file) throw new Error(`receipt not found: ${target}`);
    console.log(fs.readFileSync(file, "utf8"));
    return;
  }

  throw new Error("usage: charon receipts [list|latest|inspect <id|latest>]");
}

function verifyCommand(args) {
  const target = args[0] || "latest";
  const file = target === "latest" ? receiptFiles()[0] : target;
  if (!file || !fs.existsSync(file)) throw new Error(`receipt not found: ${target}`);
  const receipt = readJson(file);
  if (receipt.schema === "charon.trustedReceipt.v2") {
    if (!verifyTrustedReceipt(receipt)) throw new Error("trusted receipt verification failed");
    console.log(`OK ${path.resolve(file)}`);
    return;
  }
  const sig = receipt.signature;
  const body = { ...receipt };
  delete body.signature;
  const expected = signObject(body);
  if (sig !== expected) throw new Error("receipt verification failed");
  verifyReceiptIdentity(receipt);
  console.log(`OK ${path.resolve(file)}`);
}

function aeonCommand(args) {
  const [sub, ...rest] = args;
  if (sub === "init") return aeonInit(rest);
  if (sub === "enable") return aeonEnable(rest);
  if (sub === "status") return aeonStatus(rest);
  if (sub === "disable") return aeonDisable(rest);
  if (sub === "run") return aeonRun(rest);
  if (sub === "passport") return aeonPassport(rest);
  throw new Error("usage: charon aeon init | enable | status | disable | run <skill> [-- <command>] | passport [skill] [--json]");
}

function aeonSetup(args) {
  assertAeonRepo();
  const globalInstall = ensureGlobalCommand(args);
  const force = args.includes("--force");
  if (!fs.existsSync(CONFIG) || force) {
    aeonInit(force ? ["--force"] : []);
  } else {
    ensureDir(RECEIPTS_DIR);
    ensureDir(QUEUE_DIR);
    console.log(`Using existing ${CONFIG}.`);
  }
  ensureIdentity();
  aeonEnable(args);
  const proposal = synthesizePolicyProposal(loadPolicy());
  ensureDir(PROPOSALS_DIR);
  const file = path.join(PROPOSALS_DIR, `${proposal.id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(proposal, null, 2)}\n`);
  printSetupSummary({
    title: "Charon is protecting Aeon.",
    mode: "aeon",
    steps: [
      ["policy", path.resolve(CONFIG)],
      ["identity", path.resolve(IDENTITY_FILE)],
      ["command", globalInstall],
      ["aeon hook", path.resolve(path.join(".charon", "aeon", "run-skill.js"))],
      ["runner", path.resolve(path.join("scripts", "charon-aeon-runner.js"))],
      ["policy proposal", path.resolve(file)],
      ["next", "use Aeon normally"],
    ],
  });
}

function aeonInit(args) {
  assertAeonRepo();
  if (!fs.existsSync(CONFIG) || args.includes("--force")) {
    const policy = defaultPolicy();
    policy.agent = { runtime: "aeon" };
    policy.controls.files.write = ["articles/**", "reports/**", "memory/**", ".charon/**"];
    fs.writeFileSync(CONFIG, yaml.dump(policy, { lineWidth: 100 }));
  }
  ensureDir(RECEIPTS_DIR);
  ensureDir(QUEUE_DIR);
  ensureIdentity();
  console.log("Charon initialized for Aeon.");
  console.log(`- policy: ${path.resolve(CONFIG)}`);
}

function aeonEnable(args) {
  assertAeonRepo();
  if (!fs.existsSync(CONFIG) || args.includes("--force")) aeonInit(args);
  else ensureDir(RECEIPTS_DIR);
  const hookDir = path.join(".charon", "aeon");
  ensureDir(hookDir);
  const hook = path.join(hookDir, "run-skill.js");
  const runner = path.join("scripts", "charon-aeon-runner.js");
  const claudeWrapper = path.join("scripts", "charon-aeon-claude.js");
  ensureDir(path.dirname(runner));
  fs.writeFileSync(hook, aeonHookSource(), { mode: 0o755 });
  fs.writeFileSync(runner, aeonRunnerSource(), { mode: 0o755 });
  fs.writeFileSync(claudeWrapper, aeonClaudeWrapperSource(), { mode: 0o755 });
  const workflowPatched = patchAeonWorkflow();
  writeAeonManifest({ hook, runner, claudeWrapper, workflowPatched });
  patchAeonPackageScript();
  console.log("Charon Gate enabled for Aeon.");
  console.log(`- hook: ${path.resolve(hook)}`);
  console.log(`- runner: ${path.resolve(runner)}`);
  console.log(`- claude wrapper: ${path.resolve(claudeWrapper)}`);
  if (workflowPatched) console.log(`- workflow patched: ${path.resolve(AEON_WORKFLOW)}`);
}

function aeonStatus() {
  assertAeonRepo();
  const hook = path.join(".charon", "aeon", "run-skill.js");
  const runner = path.join("scripts", "charon-aeon-runner.js");
  const claudeWrapper = path.join("scripts", "charon-aeon-claude.js");
  const manifest = path.join(".charon", "aeon", "manifest.json");
  const checks = [
    ["policy", fs.existsSync(CONFIG), path.resolve(CONFIG)],
    ["hook", fs.existsSync(hook), path.resolve(hook)],
    ["runner", fs.existsSync(runner), path.resolve(runner)],
    ["claude-wrapper", fs.existsSync(claudeWrapper), path.resolve(claudeWrapper)],
    ["manifest", fs.existsSync(manifest), path.resolve(manifest)],
    ["workflow-patched", !fs.existsSync(AEON_WORKFLOW) || aeonWorkflowPatched(), path.resolve(AEON_WORKFLOW)],
    ["skills", fs.existsSync("skills"), path.resolve("skills")],
  ];
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? "OK " : "NO "} ${name} - ${detail}`);
  }
  if (!checks.every(([, ok]) => ok)) process.exitCode = 1;
}

function aeonDisable() {
  assertAeonRepo();
  const hook = path.join(".charon", "aeon", "run-skill.js");
  const runner = path.join("scripts", "charon-aeon-runner.js");
  const claudeWrapper = path.join("scripts", "charon-aeon-claude.js");
  const manifest = path.join(".charon", "aeon", "manifest.json");
  if (fs.existsSync(hook)) fs.rmSync(hook);
  if (fs.existsSync(runner)) fs.rmSync(runner);
  if (fs.existsSync(claudeWrapper)) fs.rmSync(claudeWrapper);
  if (fs.existsSync(manifest)) fs.rmSync(manifest);
  restoreAeonWorkflow();
  unpatchAeonPackageScript();
  console.log("Charon Gate disabled for Aeon.");
}

function aeonRun(args) {
  assertAeonRepo();
  const skill = args[0];
  if (!skill || skill.startsWith("-")) throw new Error("usage: charon aeon run <skill> [-- <command>]");
  const skillFile = path.join("skills", skill, "SKILL.md");
  if (!fs.existsSync(skillFile)) throw new Error(`Aeon skill not found: ${skill}`);

  const sep = args.indexOf("--");
  const command = sep >= 0 ? args.slice(sep + 1) : defaultAeonCommand(skillFile);
  return runCommand(["--", ...command], { runtime: "aeon", skill, skillFile: path.resolve(skillFile) });
}

function aeonPassport(args) {
  assertAeonRepo();
  const json = args.includes("--json");
  const target = args.find((arg) => !arg.startsWith("-"));
  const passports = buildAeonPassports();
  const selected = target ? passports.filter((item) => item.skill === target) : passports;
  if (target && !selected.length) throw new Error(`Aeon skill not found: ${target}`);
  if (json) {
    console.log(JSON.stringify(target ? selected[0] : selected, null, 2));
    return;
  }
  if (target) return printAeonPassport(selected[0], { detailed: true });
  console.log(`Aeon passports (${selected.length} skills)`);
  console.log("");
  for (const item of selected) {
    console.log([
      pad(item.risk.toUpperCase(), 6),
      item.skill,
      `hosts=${item.network.hosts.length}`,
      `reads=${item.files.reads.length}`,
      `writes=${item.files.writes.length}`,
      item.irreversible ? "irreversible=yes" : "irreversible=no",
    ].join("  "));
  }
  console.log("");
  console.log("Inspect one skill with: charon aeon passport <skill>");
}

function defaultAeonCommand(skillFile) {
  if (!hasCommand("claude")) {
    return ["sh", "-lc", `echo "Claude CLI not found. Verified Charon gate launch for ${shellQuote(skillFile)}."`];
  }
  return ["sh", "-lc", `claude -p - < ${shellQuote(skillFile)}`];
}

function ensureIdentity() {
  if (fs.existsSync(IDENTITY_FILE) && fs.existsSync(IDENTITY_KEY_FILE)) return;
  keygenCommand([]);
}

function ensureGlobalCommand(args) {
  if (args.includes("--no-global")) return "skipped (--no-global)";
  if (process.env.CHARON_SKIP_GLOBAL_INSTALL || process.env.CI) return "skipped";
  const existing = commandPath("charon");
  if (existing) return existing;
  console.log("Installing Charon command...");
  const result = childProcess.spawnSync("npm", ["install", "-g", "github:CharonAI-code/charon"], {
    stdio: "inherit",
  });
  if (result.status === 0) {
    return commandPath("charon") || "installed globally";
  }
  console.log("");
  console.log("Could not install global `charon` command automatically.");
  console.log("You can still run Charon with: npx github:CharonAI-code/charon <command>");
  return "npx fallback";
}

function printSetupSummary(input) {
  console.log("");
  console.log(input.title);
  console.log("");
  console.log(`Mode: ${input.mode}`);
  for (const [label, value] of input.steps) {
    console.log(`- ${label}: ${value}`);
  }
  console.log("");
  console.log("Runtime behavior:");
  console.log("- safe actions run after policy check");
  console.log("- risky actions pause for review");
  console.log("- forbidden actions are denied before launch");
  console.log("- receipts are written for every decision");
  printPathAdvice();
}

function shouldPromptForPausedAction(args) {
  if (args.includes("--no-prompt")) return false;
  if (process.env.CI || process.env.CHARON_NO_PROMPT) return false;
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

function promptPausedAction({ item, receipt, reason }) {
  printPausedAction({ item, receipt, reason });
  process.stderr.write("\nApprove this action now? [y/N] ");
  const input = childProcess.spawnSync("sh", ["-c", "IFS= read -r answer; printf %s \"$answer\""], {
    stdio: ["inherit", "pipe", "inherit"],
    encoding: "utf8",
  });
  const answer = String(input.stdout || "").trim().toLowerCase();
  if (answer === "y" || answer === "yes") {
    console.error("");
    return approveCommand([item.id]);
  }
  console.error("");
  console.error(`Left paused. Review later with: charon approve ${item.id}`);
  process.exitCode = 125;
}

function printPausedAction({ item, receipt, reason }) {
  console.error("");
  console.error("Charon paused this action.");
  console.error("");
  console.error("Verdict: PAUSE");
  console.error(`Agent: ${formatMetaActor(item.meta)}`);
  console.error(`Action: ${formatQueuedAction(item)}`);
  console.error(`Reason: ${reason}`);
  console.error(`Queue: ${item.id}`);
  console.error(`Receipt: ${receipt.path}`);
}

function printQueuedAction(item) {
  console.log(`${item.id}  ${item.status || "paused"}`);
  console.log(`  agent: ${formatMetaActor(item.meta)}`);
  console.log(`  action: ${formatQueuedAction(item)}`);
  console.log(`  reason: ${item.reason || ""}`);
  console.log(`  created: ${item.createdAt || ""}`);
}

function formatQueuedAction(item) {
  if (item.schema === "charon.queue.v2") return shellCommandFromAction(item.action).join(" ");
  return item.command ? item.command.join(" ") : "";
}

function formatMetaActor(meta = {}) {
  const runtime = meta.runtime || "local";
  const skill = meta.skill ? `:${meta.skill}` : "";
  const tool = meta.toolName ? ` via ${meta.toolName}` : "";
  return `${runtime}${skill}${tool}`;
}

function printStatusDashboard() {
  const aeon = isAeonRepo();
  const queues = queueFiles().map(readJson);
  const paused = queues.filter((item) => item.status === "paused").length;
  const latestReceipt = receiptFiles()[0];
  console.log("Charon status");
  console.log("");
  console.log(`Mode: ${aeon ? "aeon" : "local"}`);
  console.log(`Policy: ${fs.existsSync(CONFIG) ? path.resolve(CONFIG) : "missing"}`);
  console.log(`Identity: ${fs.existsSync(IDENTITY_FILE) ? "signed" : "missing"}`);
  console.log("Runtime: local");
  if (aeon) {
    console.log(`Aeon hook: ${fs.existsSync(path.join(".charon", "aeon", "run-skill.js")) ? "enabled" : "missing"}`);
  }
  console.log(`Paused actions: ${paused}`);
  console.log(`Receipts: ${receiptFiles().length}`);
  if (latestReceipt) {
    const receipt = readJson(latestReceipt);
    if (receipt.schema === "charon.trustedReceipt.v2") {
      console.log(`Latest: ${receipt.decision.verdict} ${receipt.action.toolName}`);
    } else {
      console.log(`Latest: ${receipt.verdict} ${receipt.command ? receipt.command.join(" ") : ""}`);
    }
  }
  printPathAdvice();
}

function printPathAdvice() {
  const npmBin = npmGlobalBin();
  if (!npmBin || commandPath("charon")) return;
  const pathParts = String(process.env.PATH || "").split(path.delimiter);
  if (pathParts.includes(npmBin)) return;
  console.log("");
  console.log("PATH fix:");
  console.log(`  export PATH="${npmBin}:$PATH"`);
  console.log(`  echo 'export PATH="${npmBin}:$PATH"' >> ~/.zshrc`);
}

function npmGlobalBin() {
  const result = childProcess.spawnSync("npm", ["prefix", "-g"], { encoding: "utf8" });
  if (result.status !== 0) return "";
  const prefix = result.stdout.trim();
  return prefix ? path.join(prefix, "bin") : "";
}

function defaultPolicy() {
  return {
    version: 1,
    bounds: {
      pass: ["npm test", "git diff", "git status", "echo"],
      pause: ["git push", "gh release create", "deploy production", "terraform apply", "kubectl apply"],
      deny: ["git push --force", "npm publish", "rm -rf", "read:.env", "read:~/.ssh/**"],
      secretAction: "deny",
      rules: [
        { id: "release.npm_publish", verdict: "DENY", command: "npm", argsIncludes: ["publish"] },
        { id: "release.git_push", verdict: "PAUSE", command: "git", argsIncludes: ["push"] },
      ],
    },
    controls: {
      files: {
        read: ["."],
        write: [".charon/**"],
        deny: [".env", ".env.*", "~/.ssh/**", "~/.aws/**", "~/.config/gh/**"],
      },
      network: {
        allow: ["github.com", "api.github.com"],
      },
      commands: {
        deny: ["git push --force", "npm publish", "rm -rf"],
      },
      env: {
        expose: [],
        deny: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"],
      },
      output: {
        secretAction: "deny",
        store: "redacted",
        maxBytes: 4000,
      },
    },
  };
}

function loadPolicy() {
  if (!fs.existsSync(CONFIG)) throw new Error(`missing ${CONFIG}. Run charon init.`);
  const policy = yaml.load(fs.readFileSync(CONFIG, "utf8"));
  validatePolicy(policy);
  return policy;
}

function validatePolicy(policy) {
  if (!policy || typeof policy !== "object") throw new Error(`${CONFIG} must be a YAML object`);
  if (policy.version !== 1) throw new Error(`${CONFIG} version must be 1`);
  if (!policy.bounds || typeof policy.bounds !== "object") {
    policy.bounds = {
      pass: [],
      pause: [],
      deny: policy.controls && policy.controls.commands ? policy.controls.commands.deny || [] : [],
    };
  }
  for (const key of ["pass", "pause", "deny"]) {
    const value = policy.bounds[key];
    if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) {
      throw new Error(`bounds.${key} must be a string array`);
    }
  }
  if (!["deny", "pause", "pass"].includes(policy.bounds.secretAction || "deny")) {
    throw new Error("bounds.secretAction must be deny, pause, or pass");
  }
  if (!Array.isArray(policy.bounds.rules)) policy.bounds.rules = [];
  const controls = policy.controls;
  if (!controls || typeof controls !== "object") throw new Error(`${CONFIG} missing controls`);
  for (const key of ["files", "network", "commands", "env"]) {
    if (!controls[key] || typeof controls[key] !== "object") throw new Error(`${CONFIG} missing controls.${key}`);
  }
  if (!controls.output || typeof controls.output !== "object") {
    controls.output = { secretAction: "deny", store: "redacted", maxBytes: 4000 };
  }
  if (!["deny", "pause", "pass"].includes(controls.output.secretAction || "deny")) {
    throw new Error("controls.output.secretAction must be deny, pause, or pass");
  }
  if (!["none", "redacted"].includes(controls.output.store || "redacted")) {
    throw new Error("controls.output.store must be none or redacted");
  }
  for (const [section, keys] of Object.entries({
    files: ["read", "write", "deny"],
    network: ["allow"],
    commands: ["deny"],
    env: ["expose", "deny"],
  })) {
    for (const key of keys) {
      const value = controls[section][key];
      if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) {
        throw new Error(`controls.${section}.${key} must be a string array`);
      }
    }
  }
}

function normalizePolicyForHash(policy) {
  validatePolicy(policy);
  return {
    version: 1,
    bounds: policy.bounds,
    controls: policy.controls,
  };
}

function decideAction(command, policy) {
  const action = normalizeAction(command);
  const trace = buildBoundaryTrace(command, policy, action);
  if (trace.secrets.status === "denied") {
    return { verdict: "DENY", reason: `secret-like value in action: ${trace.secrets.kinds.join(", ")}`, trace };
  }
  if (trace.secrets.status === "paused") {
    return { verdict: "PAUSE", reason: `secret-like value needs review: ${trace.secrets.kinds.join(", ")}`, trace };
  }
  if (trace.files.status === "denied") {
    return { verdict: "DENY", reason: `denied file path requested: ${trace.files.matches.join(", ")}`, trace };
  }
  if (trace.network.status === "denied") {
    return { verdict: "DENY", reason: `network host outside bounds: ${trace.network.denied.join(", ")}`, trace };
  }
  if (trace.action.status === "denied") {
    return { verdict: "DENY", reason: `outside bounds: ${trace.action.match}`, trace };
  }
  if (trace.action.status === "paused") {
    return { verdict: "PAUSE", reason: `requires release review: ${trace.action.match}`, trace };
  }
  return { verdict: "PASS", reason: "inside bounds", trace };
}

function buildApprovedDecision(command, policy, queueId) {
  const trace = buildBoundaryTrace(command, policy);
  trace.action = { status: "approved", match: queueId };
  return { verdict: "PASS", reason: `approved paused action: ${queueId}`, trace };
}

function buildBoundaryTrace(command, policy, action = normalizeAction(command)) {
  const secrets = scanSecrets(action.searchText);
  const secretKinds = [...new Set(secrets.map((item) => item.kind))];
  const deniedFiles = detectDeniedFiles(action, policy);
  const network = detectNetworkHosts(action, policy);
  const ruleMatch = matchStructuredRule(command, policy, action);
  const deniedAction = [...policy.bounds.deny, ...policy.controls.commands.deny]
    .find((item) => actionMatches(action, item));
  const pausedAction = policy.bounds.pause.find((item) => actionMatches(action, item));
  const secretAction = policy.bounds.secretAction || "deny";
  const trace = {
    schema: "charon.trace.v1",
    identity: {
      status: "unsigned",
      runtime: "local",
    },
    secrets: secrets.length
      ? { status: secretAction === "pause" ? "paused" : secretAction === "pass" ? "passed" : "denied", kinds: secretKinds, count: secrets.length }
      : { status: "clean", kinds: [], count: 0 },
    files: deniedFiles.length
      ? { status: "denied", matches: deniedFiles }
      : { status: "clean", matches: [] },
    network,
    action: ruleMatch
      ? { status: normalizeVerdictStatus(ruleMatch.verdict), match: ruleMatch.id, rule: ruleMatch, normalized: action.summary }
      : deniedAction
      ? { status: "denied", match: deniedAction, normalized: action.summary }
      : pausedAction
        ? { status: "paused", match: pausedAction, normalized: action.summary }
        : { status: "passed", match: "", normalized: action.summary },
    execution: {
      status: "pending",
    },
  };
  trace.explain = explainBoundaryTrace(trace, action);
  return trace;
}

function explainBoundaryTrace(trace, action) {
  const lines = [];
  const normalized = (action.commandStrings || []).filter(Boolean).map((text) => redactText(text).value);
  if (normalized.length) lines.push(`normalized commands: ${normalized.join(" | ")}`);
  if (action.shell && action.shell.segments && action.shell.segments.length > 1) {
    lines.push(`shell chain: ${action.shell.segments.map((segment) => redactText(segment.rendered).value).join(" -> ")}`);
  }
  if (action.script) {
    lines.push(`package script ${action.script.name}: ${redactText(action.script.rendered).value}`);
  }
  if (action.pathHints && action.pathHints.length) {
    lines.push(`path hints: ${action.pathHints.join(", ")}`);
  }
  if (action.networkHosts && action.networkHosts.length) {
    lines.push(`network hints: ${action.networkHosts.join(", ")}`);
  }
  if (trace.secrets && trace.secrets.status !== "clean") {
    lines.push(`secret scan: ${trace.secrets.status} ${trace.secrets.kinds.join(",")}`);
  }
  if (trace.files && trace.files.status === "denied") {
    lines.push(`file decision: denied by ${trace.files.matches.join(",")}`);
  }
  if (trace.network && trace.network.status === "denied") {
    lines.push(`network decision: denied ${trace.network.denied.join(",")}`);
  } else if (trace.network && trace.network.status === "allowed") {
    lines.push(`network decision: allowed ${trace.network.allowed.join(",")}`);
  }
  if (trace.action && trace.action.match) {
    lines.push(`action decision: ${trace.action.status} by ${trace.action.match}`);
  }
  return lines;
}

function matchStructuredRule(command, policy, action = normalizeAction(command)) {
  const rules = Array.isArray(policy.bounds.rules) ? policy.bounds.rules : [];
  return rules.find((rule) => structuredRuleMatches(action, rule));
}

function structuredRuleMatches(action, rule) {
  if (!rule || typeof rule !== "object") return false;
  const commandCandidates = action.commandCandidates;
  if (rule.command) {
    const commands = Array.isArray(rule.command) ? rule.command : [rule.command];
    if (!commands.some((cmd) => commandCandidates.includes(String(cmd)))) return false;
  }
  if (rule.includes && !action.searchText.includes(rule.includes)) return false;
  if (Array.isArray(rule.argsIncludes) && !argsIncludeAll(action.argCandidates, rule.argsIncludes)) return false;
  if (rule.args && typeof rule.args === "object") {
    if (Array.isArray(rule.args.includes) && !argsIncludeAll(action.argCandidates, rule.args.includes)) return false;
    if (Array.isArray(rule.args.excludes) && argsIncludeAny(action.argCandidates, rule.args.excludes)) return false;
    if (Array.isArray(rule.args.exact) && !argsEqualAny(action.argCandidates, rule.args.exact)) return false;
    if (Array.isArray(rule.args.startsWith) && !argsStartWithAny(action.argCandidates, rule.args.startsWith)) return false;
  }
  if (rule.toolName && !action.searchText.includes(rule.toolName)) return false;
  return true;
}

function argsIncludeAll(argSets, parts) {
  return parts.every((part) => argSets.some((args) => args.some((arg) => String(arg).includes(String(part)))));
}

function argsIncludeAny(argSets, parts) {
  return parts.some((part) => argSets.some((args) => args.some((arg) => String(arg).includes(String(part)))));
}

function argsEqualAny(argSets, expected) {
  return argSets.some((args) => stableJson(args.map(String)) === stableJson(expected.map(String)));
}

function argsStartWithAny(argSets, expected) {
  return argSets.some((args) => expected.every((part, index) => String(args[index] || "") === String(part)));
}

function normalizeVerdictStatus(verdict) {
  const value = String(verdict || "").toUpperCase();
  if (value === "DENY") return "denied";
  if (value === "PAUSE") return "paused";
  return "passed";
}

function completeTrace(trace, executionStatus, extra = {}) {
  return {
    ...trace,
    execution: {
      ...(trace && trace.execution ? trace.execution : {}),
      status: executionStatus,
      ...extra,
    },
  };
}

function detectDeniedFiles(action, policy) {
  return policy.controls.files.deny.filter((item) => actionReferencesPath(action, item));
}

function detectNetworkHosts(action, policy) {
  const hosts = [...new Set([...extractHosts(action.searchText), ...(action.networkHosts || [])])].sort();
  if (!hosts.length) return { status: "not_requested", hosts: [], denied: [], allowed: [] };
  const allowed = hosts.filter((host) => hostAllowed(host, policy.controls.network.allow));
  const denied = hosts.filter((host) => !hostAllowed(host, policy.controls.network.allow));
  return denied.length
    ? { status: "denied", hosts, denied, allowed }
    : { status: "allowed", hosts, denied: [], allowed };
}

function extractHosts(value) {
  return normalizationCore.extractHosts(value);
}

function hostAllowed(host, allowlist) {
  return allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function actionMatches(action, pattern) {
  const value = String(pattern || "");
  if (value.startsWith("read:")) return actionReferencesPath(action, value.slice("read:".length));
  return action.searchText.includes(value) || action.commandStrings.some((text) => text.includes(value));
}

function normalizeAction(command) {
  return createNormalizer().normalizeAction(command);
}

function actionReferencesPath(action, pattern) {
  return createNormalizer().actionReferencesPath(action, pattern);
}

function createNormalizer() {
  return normalizationCore.createActionNormalizer({
    cwd: process.cwd(),
    readJson,
    redactText,
    expandPath,
  });
}

function scanSecrets(value) {
  const text = String(value || "");
  const found = [];
  for (const [kind, pattern] of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      found.push({ kind, length: match[0].length });
    }
  }
  return found;
}

function redactText(value) {
  let text = String(value || "");
  const redactions = [];
  for (const [kind, pattern] of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, (match) => {
      redactions.push({ kind, length: match.length });
      return `[REDACTED:${kind}]`;
    });
  }
  return { value: text, redactions };
}

function redactCommand(command) {
  const redacted = command.map((part) => redactText(part));
  return {
    value: redacted.map((part) => part.value),
    redactions: redacted.flatMap((part) => part.redactions),
  };
}

function scanOutputBoundary(stdout, stderr, policy) {
  const output = `${stdout || ""}${stderr || ""}`;
  const redacted = redactText(output);
  const maxBytes = Number(policy.controls.output.maxBytes || 4000);
  const store = policy.controls.output.store || "redacted";
  const action = policy.controls.output.secretAction || "deny";
  const hasSecrets = redacted.redactions.length > 0;
  const status = hasSecrets
    ? action === "pause" ? "paused" : action === "pass" ? "passed" : "denied"
    : "clean";
  return {
    status,
    reason: hasSecrets ? `secret-like value in output: ${[...new Set(redacted.redactions.map((item) => item.kind))].join(", ")}` : "",
    redactions: redacted.redactions,
    receiptOutput: {
      status,
      stored: store,
      stdout: store === "redacted" ? truncateOutput(redactText(stdout || "").value, maxBytes) : "",
      stderr: store === "redacted" ? truncateOutput(redactText(stderr || "").value, maxBytes) : "",
      redactions: redacted.redactions,
    },
  };
}

function addOutputTrace(trace, outputBoundary) {
  return {
    ...trace,
    output: {
      status: outputBoundary.status,
      redactions: outputBoundary.redactions,
    },
  };
}

function truncateOutput(value, maxBytes) {
  const text = String(value || "");
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  return `${text.slice(0, maxBytes)}\n[truncated]`;
}

function scrubEnv(env, policy) {
  const out = {};
  const expose = new Set(policy.controls.env.expose);
  const deny = new Set(policy.controls.env.deny);
  for (const [key, value] of Object.entries(env)) {
    if (deny.has(key)) continue;
    if (key.startsWith("CHARON_")) out[key] = value;
    if (expose.has(key)) out[key] = value;
    if (["PATH", "HOME", "USER", "SHELL", "TERM", "TMPDIR", "LANG", "LC_ALL"].includes(key)) out[key] = value;
  }
  return out;
}

function writeReceipt(input) {
  ensureDir(RECEIPTS_DIR);
  const policyHash = hashObject(normalizePolicyForHash(input.policy));
  const redactedCommand = redactCommand(input.command);
  const redactedReason = redactText(input.reason || "");
  const body = {
    schema: "charon.receipt.v1",
    createdAt: new Date().toISOString(),
    startedAt: input.startedAt || new Date().toISOString(),
    endedAt: new Date().toISOString(),
    verdict: input.verdict,
    reason: redactedReason.value,
    runner: input.runner || "local",
    command: redactedCommand.value,
    commandRedactions: redactedCommand.redactions,
    reasonRedactions: redactedReason.redactions,
    cwd: process.cwd(),
    policyHash,
    generatedPolicy: input.generatedPolicy ? path.resolve(input.generatedPolicy) : "",
    exposedEnv: input.policy.controls.env.expose,
    deniedEnv: input.policy.controls.env.deny,
    exitCode: input.exitCode,
    trace: input.trace || completeTrace(buildBoundaryTrace(input.command, input.policy), "unknown"),
    output: input.output || { status: "not_captured" },
    meta: input.meta || {},
  };
  attachIdentityProof(body);
  body.signature = signObject(body);
  const id = `${body.createdAt.replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
  const file = path.join(RECEIPTS_DIR, `${id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return { id, path: path.resolve(file), receipt: body };
}

function attachIdentityProof(receipt) {
  const identity = loadIdentity();
  if (!identity) return;
  if (receipt.trace) {
    receipt.trace.identity = {
      status: "signed",
      runtime: receipt.meta && receipt.meta.runtime ? receipt.meta.runtime : "local",
      publicKey: identity.publicKey,
    };
  }
  const actionPayload = {
    schema: "charon.action.v1",
    command: receipt.command,
    cwd: receipt.cwd,
    policyHash: receipt.policyHash,
    verdict: receipt.verdict,
    trace: receipt.trace,
    meta: receipt.meta,
    createdAt: receipt.createdAt,
  };
  const signature = signIdentityPayload(actionPayload);
  receipt.identity = {
    schema: "charon.identityProof.v1",
    type: identity.type,
    publicKey: identity.publicKey,
    actionHash: hashObject(actionPayload),
    signature,
  };
}

function loadIdentity() {
  if (!fs.existsSync(IDENTITY_FILE) || !fs.existsSync(IDENTITY_KEY_FILE)) return null;
  return readJson(IDENTITY_FILE);
}

function signIdentityPayload(payload) {
  const privateKey = fs.readFileSync(IDENTITY_KEY_FILE, "utf8");
  return crypto.sign(null, Buffer.from(stableJson(payload)), privateKey).toString("base64");
}

function verifyReceiptIdentity(receipt) {
  if (!receipt.identity) return;
  const actionPayload = {
    schema: "charon.action.v1",
    command: receipt.command,
    cwd: receipt.cwd,
    policyHash: receipt.policyHash,
    verdict: receipt.verdict,
    trace: receipt.trace,
    meta: receipt.meta,
    createdAt: receipt.createdAt,
  };
  if (hashObject(actionPayload) !== receipt.identity.actionHash) {
    throw new Error("identity action hash verification failed");
  }
  const ok = crypto.verify(
    null,
    Buffer.from(stableJson(actionPayload)),
    receipt.identity.publicKey,
    Buffer.from(receipt.identity.signature, "base64"),
  );
  if (!ok) throw new Error("identity signature verification failed");
}

function enqueueAction(input) {
  ensureDir(QUEUE_DIR);
  const id = `cq-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const redactedCommand = redactCommand(input.command);
  const redactedReason = redactText(input.reason || "");
  const item = {
    schema: "charon.queue.v1",
    id,
    status: "paused",
    createdAt: new Date().toISOString(),
    cwd: process.cwd(),
    command: redactedCommand.value,
    commandRedactions: redactedCommand.redactions,
    reason: redactedReason.value,
    reasonRedactions: redactedReason.redactions,
    policyHash: hashObject(normalizePolicyForHash(input.policy)),
    meta: input.meta || {},
  };
  item.signature = signQueueItem(item);
  const file = path.join(QUEUE_DIR, `${id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(item, null, 2)}\n`);
  return { id, path: path.resolve(file), item };
}

function enqueueActionV2(input) {
  ensureDir(QUEUE_DIR);
  const id = `cq-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const redactedReason = redactText(input.reason || "");
  const item = {
    schema: "charon.queue.v2",
    id,
    status: "paused",
    createdAt: new Date().toISOString(),
    cwd: process.cwd(),
    action: redactQueuedAction(input.action),
    reason: redactedReason.value,
    reasonRedactions: redactedReason.redactions,
    policyHash: hashObject(normalizePolicyForHash(input.policy)),
    meta: input.meta || {},
  };
  item.signature = signQueueItem(item);
  const file = path.join(QUEUE_DIR, `${id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(item, null, 2)}\n`);
  return { id, path: path.resolve(file), item };
}

function redactQueuedAction(action) {
  const copy = JSON.parse(JSON.stringify(action));
  if (Array.isArray(copy.resources)) {
    for (const resource of copy.resources) {
      if (resource.role === "secret") {
        resource.value = "[REDACTED:secret]";
        if (resource.canonical) resource.canonical = "[REDACTED:secret]";
      }
    }
  }
  copy.args = redactQueuedValue(copy.args);
  return copy;
}

function redactQueuedValue(value) {
  if (typeof value === "string") return redactText(value).value;
  if (Array.isArray(value)) return value.map(redactQueuedValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = /secret|token|api[_-]?key|password|credential/i.test(key) ? "[REDACTED:secret]" : redactQueuedValue(child);
    }
    return out;
  }
  return value;
}

function shellCommandFromAction(action) {
  const command = action && action.metadata && Array.isArray(action.metadata.command)
    ? action.metadata.command
    : Array.isArray(action && action.args)
      ? action.args
      : [];
  if (!command.length) throw new Error(`queued action cannot be executed: ${action && action.id ? action.id : "unknown"}`);
  return command.map(String);
}

function queueFiles() {
  if (!fs.existsSync(QUEUE_DIR)) return [];
  return fs.readdirSync(QUEUE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(QUEUE_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function loadQueuedAction(id) {
  const file = path.join(QUEUE_DIR, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`queued action not found: ${id}`);
  return readJson(file);
}

function saveQueuedAction(item) {
  ensureDir(QUEUE_DIR);
  item.signature = signQueueItem({ ...item, signature: undefined });
  fs.writeFileSync(path.join(QUEUE_DIR, `${item.id}.json`), `${JSON.stringify(item, null, 2)}\n`);
}

function signQueueItem(item) {
  const body = { ...item };
  delete body.signature;
  return signObject(body);
}

function verifyQueuedAction(item) {
  const sig = item.signature;
  if (!sig) throw new Error(`queued action is unsigned: ${item.id}`);
  const expected = signQueueItem(item);
  if (sig !== expected) throw new Error(`queued action verification failed: ${item.id}`);
}

function aeonHookSource() {
  return `#!/usr/bin/env node
"use strict";

const { main } = require("../../src/cli");

const [skill, ...rest] = process.argv.slice(2);
if (!skill) {
  console.error("usage: .charon/aeon/run-skill.js <skill> [-- <command>]");
  process.exit(1);
}

main(["aeon", "run", skill, ...rest]).catch((err) => {
  console.error("charon:", err && err.message ? err.message : String(err));
  process.exitCode = err && Number.isInteger(err.exitCode) ? err.exitCode : 1;
});
`;
}

function synthesizePolicyProposal(policy) {
  const changes = [];
  for (const change of inferPackageScriptChanges(policy)) changes.push(change);
  for (const change of inferAeonSkillChanges(policy)) changes.push(change);
  for (const change of inferTraceChanges(policy)) changes.push(change);
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
  const changes = [];
  if (!fs.existsSync("package.json")) return changes;
  let pkg;
  try {
    pkg = readJson("package.json");
  } catch {
    return changes;
  }
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

function packageScriptRule(id, verdict, command) {
  const parts = String(command).trim().split(/\s+/).filter(Boolean);
  return {
    id,
    verdict,
    command: parts[0] || command,
    argsIncludes: parts.slice(1, 3),
  };
}

function hasStructuredRule(policy, id) {
  return Array.isArray(policy.bounds.rules) && policy.bounds.rules.some((rule) => rule.id === id);
}

function inferAeonSkillChanges(policy) {
  const changes = [];
  if (!fs.existsSync("skills")) return changes;
  for (const passport of buildAeonPassports()) {
    for (const readPath of passport.files.reads) {
      if (!policy.controls.files.read.includes(readPath)) {
        changes.push(policyChange("loosen", "controls.files.read", "add", readPath, `skill ${passport.skill} appears to read ${readPath}`));
      }
    }
    for (const writePath of passport.files.writes) {
      if (!policy.controls.files.write.includes(writePath)) {
        changes.push(policyChange("loosen", "controls.files.write", "add", writePath, `skill ${passport.skill} appears to write ${writePath}`));
      }
    }
    for (const host of passport.network.hosts) {
      if (!hostAllowed(host, policy.controls.network.allow)) {
        changes.push(policyChange("loosen", "controls.network.allow", "add", host, `skill ${passport.skill} references host`));
      }
    }
    for (const secret of passport.secrets) {
      if (!policy.controls.env.deny.includes(secret) && !policy.controls.env.expose.includes(secret)) {
        changes.push(policyChange("tighten", "controls.env.deny", "add", secret, `skill ${passport.skill} references secret-like env name`));
      }
    }
    if (passport.irreversible && !hasStructuredRule(policy, `aeon.${passport.skill}.irreversible`)) {
      changes.push(policyChange("tighten", "bounds.rules", "add", {
        id: `aeon.${passport.skill}.irreversible`,
        verdict: "PAUSE",
        includes: passport.actions.join(" ") || passport.skill,
      }, `review irreversible action hints in skill ${passport.skill}`));
    }
  }
  return changes;
}

function buildAeonPassports() {
  if (!fs.existsSync("skills")) return [];
  return listDirectories("skills").map((skill) => {
    const file = path.join("skills", skill, "SKILL.md");
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const hosts = [...extractHosts(text)].sort();
    const secrets = [...extractSecretNames(text)].sort();
    const reads = inferAeonReads(text, skill);
    const writes = inferAeonWrites(text, skill);
    const actions = inferAeonActions(text);
    const irreversible = actions.some((action) => action.irreversible);
    return {
      skill,
      risk: scoreAeonRisk({ hosts, secrets, reads, writes, actions, text }),
      secrets,
      network: { hosts },
      files: { reads, writes },
      actions: actions.map((action) => action.name),
      irreversible,
      policy: {
        config: fs.existsSync(CONFIG),
        generatedProposalCount: proposalFiles().length,
      },
    };
  }).sort((a, b) => a.skill.localeCompare(b.skill));
}

function extractSecretNames(text) {
  const secrets = new Set();
  const re = /\b[A-Z][A-Z0-9_]{2,}_(?:API_KEY|KEY|TOKEN|SECRET|WEBHOOK_URL)\b/g;
  for (const match of String(text || "").matchAll(re)) secrets.add(match[0]);
  return secrets;
}

function inferAeonReads(text, skill) {
  const reads = new Set();
  const lower = String(text || "").toLowerCase();
  if (/\b(read|inspect|load|open|review|analy[sz]e|summari[sz]e)\b/i.test(text)) reads.add(`skills/${skill}/**`);
  if (lower.includes("memory")) reads.add("memory/**");
  if (lower.includes("article") || lower.includes("blog")) reads.add("articles/**");
  if (lower.includes("report") || lower.includes("audit")) reads.add("reports/**");
  if (lower.includes("package.json")) reads.add("package.json");
  return [...reads].sort();
}

function inferAeonWrites(text, skill) {
  const writes = new Set();
  const lower = String(text || "").toLowerCase();
  if (/\b(report|audit|summary|write|save|create|generate)\b/i.test(text)) writes.add(`reports/${skill}/**`);
  if (lower.includes("article") || lower.includes("blog") || lower.includes("publish article")) writes.add("articles/**");
  if (lower.includes("memory")) writes.add("memory/**");
  if (lower.includes("output") || lower.includes("artifact")) writes.add(".outputs/**");
  if (/\b(issue|pull request|pr|github)\b/i.test(text)) writes.add("github:issues-prs");
  if (/\b(slack|discord|telegram|email|notify|notification)\b/i.test(text)) writes.add("external:notifications");
  return [...writes].sort();
}

function inferAeonActions(text) {
  const actions = [];
  const patterns = [
    ["external_api", /\b(curl|fetch|api|webhook|http|https)\b/i, false],
    ["notify", /\b(notify|telegram|discord|slack|email|sendgrid)\b/i, false],
    ["git_write", /\b(git push|create pr|open pr|open a pr|pull request|gh pr|gh issue)\b/i, true],
    ["publish", /\b(npm publish|gh release create|post to|tweet|publish to|publish package)\b/i, true],
    ["deploy", /\b(deploy|terraform apply|kubectl apply)\b/i, true],
    ["onchain_write", /\b(send transaction|onchain write|wallet|private key|seed phrase|sign|deploy contract)\b/i, true],
  ];
  for (const [name, re, irreversible] of patterns) {
    if (re.test(text)) actions.push({ name, irreversible });
  }
  return actions;
}

function scoreAeonRisk({ hosts, secrets, reads, writes, actions, text }) {
  let score = 0;
  score += Math.min(hosts.length, 5);
  score += secrets.length * 3;
  score += reads.length;
  score += writes.length;
  score += actions.filter((action) => action.irreversible).length * 3;
  if (/\b(private key|seed phrase|wallet|oauth|token|secret)\b/i.test(text)) score += 3;
  if (score >= 8) return "high";
  if (score >= 3) return "medium";
  return "low";
}

function printAeonPassport(item, opts = {}) {
  console.log(`Skill: ${item.skill}`);
  console.log(`Risk: ${item.risk}`);
  console.log(`Secrets: ${item.secrets.length ? item.secrets.join(", ") : "none inferred"}`);
  console.log(`Network: ${item.network.hosts.length ? item.network.hosts.join(", ") : "none inferred"}`);
  console.log(`Reads: ${item.files.reads.length ? item.files.reads.join(", ") : "none inferred"}`);
  console.log(`Writes: ${item.files.writes.length ? item.files.writes.join(", ") : "none inferred"}`);
  console.log(`Actions: ${item.actions.length ? item.actions.join(", ") : "none inferred"}`);
  console.log(`Irreversible: ${item.irreversible ? "yes" : "no"}`);
  if (opts.detailed) {
    console.log("");
    console.log("Policy hints:");
    console.log("- network hosts can become controls.network.allow proposals");
    console.log("- write surfaces can become controls.files.write proposals");
    console.log("- irreversible hints should pause for review");
  }
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
    if (!target.includes(change.value)) target.push(change.value);
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

function loadPolicyProposal(target) {
  const file = target === "latest" ? proposalFiles()[0] : path.join(PROPOSALS_DIR, `${target}.json`);
  if (!file || !fs.existsSync(file)) throw new Error(`policy proposal not found: ${target}`);
  return { proposal: readJson(file), file };
}

function proposalFiles() {
  if (!fs.existsSync(PROPOSALS_DIR)) return [];
  return fs.readdirSync(PROPOSALS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(PROPOSALS_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function listDirectories(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((item) => fs.statSync(path.join(dir, item)).isDirectory());
}

function printReceiptSummary(receipt, file) {
  if (receipt.schema === "charon.trustedReceipt.v2") return printTrustedReceiptSummary(receipt, file);
  console.log(`Receipt: ${path.resolve(file)}`);
  console.log(`Verdict: ${receipt.verdict}`);
  console.log(`Runtime: ${receipt.meta && receipt.meta.runtime ? receipt.meta.runtime : "command"}`);
  if (receipt.meta && receipt.meta.skill) console.log(`Skill: ${receipt.meta.skill}`);
  console.log(`Runner: ${receipt.runner || "local"}`);
  console.log(`Policy: ${receipt.policyHash}`);
  console.log(`Exit: ${receipt.exitCode}`);
}

function printTrustedReceiptSummary(receipt, file) {
  console.log(`Receipt: ${path.resolve(file)}`);
  console.log(`Verdict: ${receipt.decision && receipt.decision.verdict ? receipt.decision.verdict : "unknown"}`);
  console.log(`Runtime: ${receipt.action && receipt.action.runtime ? receipt.action.runtime : "unknown"}`);
  console.log(`Tool: ${receipt.action && receipt.action.toolName ? receipt.action.toolName : "unknown"}`);
  console.log(`Policy: ${receipt.policyHash}`);
  console.log(`Action: ${receipt.actionHash}`);
  console.log(`Receipt: ${receipt.receiptHash}`);
  console.log(`Execution: ${receipt.execution ? receipt.execution.status : "unknown"}`);
  if (receipt.execution && receipt.execution.exitCode !== undefined) console.log(`Exit: ${receipt.execution.exitCode}`);
}

function printTrace(receipt, file) {
  if (receipt.schema === "charon.trustedReceipt.v2") return printTrustedTrace(receipt, file);
  const trace = receipt.trace || {};
  console.log(`Trace: ${receiptId(file)}`);
  console.log(`Verdict: ${receipt.verdict}`);
  console.log(`Reason: ${receipt.reason || ""}`);
  console.log(`Identity: ${trace.identity ? formatTracePart(trace.identity) : "unknown"}`);
  console.log(`Secrets: ${trace.secrets ? formatTracePart(trace.secrets) : "unknown"}`);
  console.log(`Files: ${trace.files ? formatTracePart(trace.files) : "unknown"}`);
  console.log(`Network: ${trace.network ? formatTracePart(trace.network) : "unknown"}`);
  console.log(`Action: ${trace.action ? formatTracePart(trace.action) : "unknown"}`);
  console.log(`Execution: ${trace.execution ? formatTracePart(trace.execution) : "unknown"}`);
  console.log(`Output: ${trace.output ? formatTracePart(trace.output) : "unknown"}`);
  if (Array.isArray(trace.explain) && trace.explain.length) {
    console.log("Explain:");
    for (const line of trace.explain) console.log(`- ${line}`);
  }
  console.log(`Receipt: ${path.resolve(file)}`);
}

function printTrustedTrace(receipt, file) {
  const trace = receipt.trace || {};
  console.log(`Trace: ${receiptId(file)}`);
  console.log(`Verdict: ${receipt.decision.verdict}`);
  console.log(`Reason: ${receipt.decision.reason || ""}`);
  if (trace.identity) console.log(`Identity: ${formatTracePart(trace.identity)}`);
  if (trace.secrets) console.log(`Secrets: ${formatTracePart(trace.secrets)}`);
  if (trace.files) console.log(`Files: ${formatTracePart(trace.files)}`);
  if (trace.network) console.log(`Network: ${formatTracePart(trace.network)}`);
  if (trace.action) console.log(`Action: ${formatTracePart(trace.action)}`);
  console.log(`Runtime: ${receipt.action.runtime}`);
  console.log(`Tool: ${receipt.action.toolName}`);
  console.log(`Resources:`);
  for (const resource of receipt.decision.resources || []) {
    console.log(`- ${resource.role}: ${resource.canonical || resource.value}`);
  }
  console.log(`Execution: ${receipt.execution.status}`);
  if (Array.isArray(trace.explain) && trace.explain.length) {
    console.log("Explain:");
    for (const line of trace.explain) console.log(`- ${line}`);
  }
  console.log(`Receipt: ${path.resolve(file)}`);
}

function formatTracePart(part) {
  const details = [
    part.match,
    part.kinds && part.kinds.length ? part.kinds.join(",") : "",
    part.matches && part.matches.length ? part.matches.join(",") : "",
    part.denied && part.denied.length ? part.denied.join(",") : "",
    part.hosts && part.hosts.length && part.status !== "denied" ? part.hosts.join(",") : "",
    part.runner || "",
    part.publicKey ? "pubkey" : "",
    part.redactions && part.redactions.length ? `${part.redactions.length} redaction(s)` : "",
  ].filter(Boolean).join(" ");
  return details ? `${part.status} - ${details}` : part.status;
}

function signObject(obj) {
  const key = receiptKey();
  return crypto.createHmac("sha256", key).update(stableJson(obj)).digest("hex");
}

function receiptKey() {
  ensureDir(STATE_DIR);
  if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return fs.readFileSync(KEY_FILE, "utf8").trim();
}

function receiptFiles() {
  if (!fs.existsSync(RECEIPTS_DIR)) return [];
  return fs.readdirSync(RECEIPTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(RECEIPTS_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function receiptId(file) {
  return path.basename(file, ".json");
}

function assertAeonRepo() {
  if (!fs.existsSync("aeon.yml") || !fs.existsSync("skills")) {
    throw new Error("not inside an Aeon repo");
  }
}

function isAeonRepo() {
  return fs.existsSync("aeon.yml") && fs.existsSync("skills");
}

function hasCommand(cmd) {
  return childProcess.spawnSync("sh", ["-lc", `command -v ${shellQuote(cmd)}`], { stdio: "ignore" }).status === 0;
}

function commandPath(cmd) {
  const result = childProcess.spawnSync("sh", ["-lc", `command -v ${shellQuote(cmd)}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hashObject(obj) {
  return crypto.createHash("sha256").update(stableJson(obj)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function expandPath(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function absolutizePolicyPath(value, cwd) {
  const expanded = expandPath(value.replace(/\*\*$/g, "").replace(/\*$/g, ""));
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  return path.resolve(cwd, expanded);
}

function pad(value, width) {
  return String(value).padEnd(width, " ");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function aeonRunnerSource() {
  return `#!/usr/bin/env node
"use strict";

require("../.charon/aeon/run-skill");
`;
}

function aeonClaudeWrapperSource() {
  return `#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const { createCharon } = require("charon");

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", () => {
  const model = process.env.MODEL || "";
  const allowed = process.env.ALLOWED || "";
  const skill = process.env.SKILL_NAME || process.env.SKILL || "";
  const args = ["-p", "-", "--output-format", "json"];
  if (model) args.push("--model", model);
  if (allowed) args.push("--allowedTools", allowed);

  const charon = createCharon({ cwd: process.cwd() });
  const decision = charon.gateToolCall({
    runtime: "aeon",
    skill,
    toolName: "claude",
    toolArgs: { model, allowedTools: allowed, promptBytes: Buffer.byteLength(prompt, "utf8") },
    context: "aeon workflow claude execution",
  });

  if (!decision.pass) {
    console.error(\`Charon \${decision.verdict}: \${decision.reason}\`);
    if (decision.receipt) console.error(\`Receipt: \${decision.receipt}\`);
    process.exit(decision.pause ? 125 : 126);
  }

  const result = childProcess.spawnSync("claude", args, {
    input: prompt,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(typeof result.status === "number" ? result.status : result.error ? 127 : 0);
});
`;
}

function writeAeonManifest(paths) {
  const manifest = {
    schema: "charon.aeon.v1",
    enabledAt: new Date().toISOString(),
    hook: paths.hook,
    runner: paths.runner,
    claudeWrapper: paths.claudeWrapper,
    workflowPatched: Boolean(paths.workflowPatched),
    command: "node scripts/charon-aeon-runner.js <skill> [-- <command>]",
  };
  ensureDir(path.join(".charon", "aeon"));
  fs.writeFileSync(path.join(".charon", "aeon", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function patchAeonWorkflow() {
  if (!fs.existsSync(AEON_WORKFLOW)) return false;
  let text = fs.readFileSync(AEON_WORKFLOW, "utf8");
  if (text.includes(AEON_WORKFLOW_BEGIN)) return true;
  text = text.replace(
    "npm install -g @anthropic-ai/claude-code",
    "npm install -g @anthropic-ai/claude-code github:CharonAI-code/charon",
  );
  const target = 'if ! CLAUDE_OUTPUT=$(echo "$PROMPT" | claude -p - \\';
  if (!text.includes(target)) return false;
  ensureDir(path.dirname(AEON_WORKFLOW_BACKUP));
  if (!fs.existsSync(AEON_WORKFLOW_BACKUP)) fs.writeFileSync(AEON_WORKFLOW_BACKUP, text);
  const replacement = [
    AEON_WORKFLOW_BEGIN,
    '          export SKILL_NAME="$SKILL_NAME"',
    '          if ! CLAUDE_OUTPUT=$(echo "$PROMPT" | node scripts/charon-aeon-claude.js \\',
    AEON_WORKFLOW_END,
  ].join("\n");
  text = text.replace(target, replacement);
  fs.writeFileSync(AEON_WORKFLOW, text);
  return true;
}

function restoreAeonWorkflow() {
  if (fs.existsSync(AEON_WORKFLOW_BACKUP)) {
    fs.copyFileSync(AEON_WORKFLOW_BACKUP, AEON_WORKFLOW);
    fs.rmSync(AEON_WORKFLOW_BACKUP);
    return;
  }
  if (!fs.existsSync(AEON_WORKFLOW)) return;
  let text = fs.readFileSync(AEON_WORKFLOW, "utf8");
  text = text.replace(
    /# >>> charon\n\s*export SKILL_NAME="\$SKILL_NAME"\n\s*if ! CLAUDE_OUTPUT=\$\(echo "\$PROMPT" \| node scripts\/charon-aeon-claude\.js \\\n# <<< charon/g,
    'if ! CLAUDE_OUTPUT=$(echo "$PROMPT" | claude -p - \\',
  );
  fs.writeFileSync(AEON_WORKFLOW, text);
}

function aeonWorkflowPatched() {
  return fs.existsSync(AEON_WORKFLOW) && fs.readFileSync(AEON_WORKFLOW, "utf8").includes(AEON_WORKFLOW_BEGIN);
}

function patchAeonPackageScript() {
  if (!fs.existsSync("package.json")) return;
  const pkg = readJson("package.json");
  pkg.scripts = pkg.scripts || {};
  if (!pkg.scripts["charon:aeon"]) {
    pkg.scripts["charon:aeon"] = "node scripts/charon-aeon-runner.js";
  }
  fs.writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
}

function unpatchAeonPackageScript() {
  if (!fs.existsSync("package.json")) return;
  const pkg = readJson("package.json");
  if (pkg.scripts && pkg.scripts["charon:aeon"] === "node scripts/charon-aeon-runner.js") {
    delete pkg.scripts["charon:aeon"];
    fs.writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

module.exports = {
  main,
  createCharon,
  defaultPolicy,
  decideAction,
  validatePolicy,
  normalizePolicyForHash,
  scrubEnv,
};
