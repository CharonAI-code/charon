// -nocheck
// @ts-nocheck
"use strict";

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const { createActionRequest } = require("../action");
const { ActionCoordinator } = require("../trusted-process/coordinator");
const { createTrustedReceipt, verifyTrustedReceipt } = require("../trusted-process/receipt");
const { codexCommand, enforceCommand, mcpCommand } = require("./commands/codex-mcp");
const { policyCommand } = require("./commands/policy");
const { aeonCommand } = require("./commands/aeon");
const { interlockCommand } = require("./commands/interlock");
const { inspectOutput, InspectionSession } = require("../inspection");
const {
  defaultPolicy,
  validatePolicy,
  normalizePolicyForHash,
  decideAction,
  buildApprovedDecision,
  buildBoundaryTrace,
  completeTrace,
  normalizeAction,
  redactText,
  redactCommand,
} = require("../core/policy/runtime");

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
const INSPECTION_SESSION = new InspectionSession();

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
    case "restore":
      return restoreCommand(args);
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
    case "mcp":
      return mcpCommand(args);
    case "codex":
      return codexCommand(args);
    case "enforce":
      return enforceCommand(args);
    case "aeon":
      return aeonCommand(args);
    case "interlock":
      return interlockCommand(args);
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

Start:
  npx github:CharonAI-code/charon setup
  charon status
  charon receipts
  charon restore

Advanced:
  charon init
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
  charon receipts search <query>
  charon receipts explain <id|latest>
  charon verify <receipt|latest>
  charon enforce codex
  charon enforce aeon
  charon aeon smoke [--json]
  charon aeon preflight --skill <name>
  charon aeon review list|inspect|export|approve|reject
  charon enforce status
  charon enforce restore
  charon mcp server [--cwd <path>]
  charon mcp install codex
  charon mcp guard codex
  charon mcp status codex
  charon mcp unguard codex
  charon mcp wrap <name> -- <mcp-server-command>
  charon mcp config <name> -- <mcp-server-command>
  charon mcp proxy -- <mcp-server-command>
  charon aeon map [--json] [--cwd <path>]
  charon interlock setup [--cwd <path>] [--no-codex]
  charon interlock status [--cwd <path>]

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
  const localOnly = args.includes("--local") || args.includes("--no-codex");
  const globalInstall = ensureGlobalCommand(args);
  init(["--policy-only", ...args]);
  ensureIdentity();
  let codexStatus = "skipped (--local)";
  if (!localOnly) {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    const configPath = path.join(codexHome, "config.toml");
    ensureDir(codexHome);
    const configBefore = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
    const guardedBefore = (configBefore.match(/^#\s*charon\.guarded\s*=\s*true\s*$/gm) || []).length;
    enforceCommand(["codex", "--quiet"]);
    const configAfter = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
    const guardedAfter = (configAfter.match(/^#\s*charon\.guarded\s*=\s*true\s*$/gm) || []).length;
    codexStatus = `enforced; MCP guarded=${guardedAfter}${guardedAfter !== guardedBefore ? ` (+${guardedAfter - guardedBefore})` : ""}`;
  }
  const selftest = runSelftestCheck("selftest", ["selftest", "--quiet"], 0);
  printSetupSummary({ command: globalInstall, codex: codexStatus, selftest });
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
  const typedCoordinator = new ActionCoordinator({ policy: runtimePolicy, signer: receiptSigner(), session: INSPECTION_SESSION });
  const decision = meta.approvedQueueId
    ? {
        verdict: "PASS",
        reason: `approved paused action: ${meta.approvedQueueId}`,
        ruleId: `queue.${meta.approvedQueueId}.approved`,
        resources: action.resources,
      }
    : decisionFromCommandPolicy(command, policy, action, typedCoordinator);

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

function restoreCommand(args) {
  if (args.length) throw new Error("usage: charon restore");
  return enforceCommand(["restore"]);
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
    return { defaultVerdict: "PASS", rules };
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
    if (!rule || typeof rule !== "object" || !rule.role) continue;
    rules.push({
      id: rule.id || `rule.${rules.length}`,
      verdict: String(rule.verdict || "PAUSE").toUpperCase(),
      role: rule.role,
      equals: rule.equals,
      includes: rule.includes,
      prefix: rule.prefix,
    });
  }

  for (const item of (policy.controls && policy.controls.files ? policy.controls.files.deny : []) || []) {
    if (item.includes(".env") || item.includes(".ssh") || item.includes(".aws")) {
      rules.push({ id: `file.deny.${rules.length}`, verdict: "DENY", role: "secret", includes: item.replace("read:", "") });
    }
  }

  return {
    defaultVerdict: policyDefaultVerdict(policy),
    rules,
  };
}

function policyDefaultVerdict(policy) {
  const value = String(policy.default || policy.defaultVerdict || (policy.bounds && policy.bounds.default) || "PASS").toUpperCase();
  return ["PASS", "PAUSE", "DENY"].includes(value) ? value : "PASS";
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

function decisionFromCommandPolicy(command, policy, action, coordinator) {
  const shellDecision = decideAction(command, policy);
  if (shellDecision.verdict !== "PASS") {
    return {
      verdict: shellDecision.verdict,
      reason: shellDecision.reason,
      ruleId: shellDecision.trace && shellDecision.trace.action && shellDecision.trace.action.match ? shellDecision.trace.action.match : "command.policy",
      resources: action.resources,
      trace: shellDecision.trace,
    };
  }
  const typed = coordinator.evaluate(action).decision;
  if (typed.verdict && typed.verdict !== "PASS") {
    return {
      ...typed,
      resources: typed.resources || action.resources,
      trace: typed.trace || shellDecision.trace,
    };
  }
  return {
    ...typed,
    verdict: "PASS",
    reason: typed.reason || "inside bounds",
    ruleId: typed.ruleId || "command.pass",
    resources: typed.resources || action.resources,
    trace: typed.trace || shellDecision.trace,
  };
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

function buildLocalCommand(command) {
  return command;
}

function receiptsCommand(args) {
  const sub = args[0] || "summary";
  const files = receiptFiles();
  if (!files.length) {
    console.log("No receipts yet.");
    return;
  }

  if (sub === "summary") {
    console.log("Charon receipts");
    console.log("");
    printReceiptSummary(readJson(files[0]), files[0]);
    if (files.length > 1) {
      console.log("");
      console.log("Recent:");
      for (const file of files.slice(1, 6)) console.log(formatReceiptListLine(readJson(file), file));
    }
    return;
  }

  if (sub === "list") {
    for (const file of files.slice(0, 20)) {
      console.log(formatReceiptListLine(readJson(file), file));
    }
    return;
  }

  if (sub === "latest") return printReceiptSummary(readJson(files[0]), files[0]);

  if (sub === "search") {
    const query = args.slice(1).join(" ").trim().toLowerCase();
    if (!query) throw new Error("usage: charon receipts search <query>");
    const matches = files
      .map((file) => ({ file, data: readJson(file), text: fs.readFileSync(file, "utf8").toLowerCase() }))
      .filter((item) => item.text.includes(query));
    for (const item of matches.slice(0, 50)) console.log(formatReceiptListLine(item.data, item.file));
    if (!matches.length) console.log("No matching receipts.");
    return;
  }

  if (sub === "explain") {
    const target = args[1] || "latest";
    const file = findReceiptFile(target, files);
    if (!file) throw new Error(`receipt not found: ${target}`);
    return printReceiptExplanation(readJson(file), file);
  }

  if (sub === "inspect") {
    const target = args[1] || "latest";
    const file = findReceiptFile(target, files);
    if (!file) throw new Error(`receipt not found: ${target}`);
    console.log(fs.readFileSync(file, "utf8"));
    return;
  }

  throw new Error("usage: charon receipts [list|latest|inspect <id|latest>|search <query>|explain <id|latest>]");
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
  console.log("Charon installed");
  console.log("");
  console.log("Policy: balanced");
  console.log(`Codex: ${input.codex}`);
  console.log("Receipts: enabled");
  console.log(`Identity: signed`);
  console.log(`Command: ${input.command}`);
  console.log(`Selftest: ${input.selftest.ok ? "passed" : `failed - ${input.selftest.detail}`}`);
  console.log("");
  console.log("Restart Codex to activate.");
  if (!input.selftest.ok) process.exitCode = 1;
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
  const queues = queueFiles().map(readJson);
  const paused = queues.filter((item) => item.status === "paused").length;
  const latestReceipt = receiptFiles()[0];
  console.log("Charon is active");
  console.log("");
  const policy = fs.existsSync(CONFIG) ? loadPolicy() : null;
  console.log(`Policy: ${policy ? (policy.mode || "balanced") : "missing"}`);
  console.log(`Identity: ${fs.existsSync(IDENTITY_FILE) ? "signed" : "missing"}`);
  console.log("Runtime: local");
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

function loadPolicy() {
  if (!fs.existsSync(CONFIG)) throw new Error(`missing ${CONFIG}. Run charon init.`);
  const policy = yaml.load(fs.readFileSync(CONFIG, "utf8"));
  validatePolicy(policy);
  return policy;
}

function scanOutputBoundary(stdout, stderr, policy) {
  const inspected = inspectOutput(stdout || "", stderr || "", {
    session: INSPECTION_SESSION,
    mode: policy.controls.output.secretAction || "deny",
    store: policy.controls.output.store || "redacted",
    maxBytes: Number(policy.controls.output.maxBytes || 4000),
  });
  return {
    status: inspected.status,
    reason: inspected.reason,
    redactions: inspected.redactions,
    receiptOutput: {
      status: inspected.status,
      stored: policy.controls.output.store || "redacted",
      stdout: inspected.stdout,
      stderr: inspected.stderr,
      redactions: inspected.redactions,
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

function formatReceiptListLine(receipt, file) {
  const trusted = receipt.schema === "charon.trustedReceipt.v2";
  const verdict = trusted ? receipt.decision && receipt.decision.verdict : receipt.verdict;
  const runtime = trusted ? receipt.action && receipt.action.runtime : receipt.meta && receipt.meta.runtime;
  const tool = trusted ? receipt.action && receipt.action.toolName : receipt.meta && receipt.meta.skill;
  const execution = trusted ? receipt.execution && receipt.execution.status : receipt.exitCode === undefined ? "" : `exit=${receipt.exitCode}`;
  return [
    receiptId(file),
    pad(verdict || "unknown", 7),
    runtime || "command",
    tool || "",
    execution || "",
    receipt.createdAt || "",
  ].filter(Boolean).join("  ");
}

function findReceiptFile(target, files = receiptFiles()) {
  if (target === "latest") return files[0];
  return files.find((file) => receiptId(file) === target || path.resolve(file) === path.resolve(target) || file === target);
}

function printReceiptExplanation(receipt, file) {
  if (receipt.schema === "charon.trustedReceipt.v2") return printTrustedReceiptExplanation(receipt, file);
  console.log(`Receipt: ${receiptId(file)}`);
  console.log(`Verdict: ${receipt.verdict}`);
  console.log(`Reason: ${receipt.reason || "inside policy"}`);
  console.log(`Command: ${Array.isArray(receipt.command) ? receipt.command.join(" ") : ""}`);
  console.log(`Policy: ${receipt.policyHash || ""}`);
  console.log(`Execution: ${receipt.exitCode === 126 ? "blocked" : receipt.exitCode === 125 ? "paused" : "launched"}`);
  const trace = receipt.trace || {};
  if (trace.action) console.log(`Action: ${formatTracePart(trace.action)}`);
  if (trace.files) console.log(`Files: ${formatTracePart(trace.files)}`);
  if (trace.network) console.log(`Network: ${formatTracePart(trace.network)}`);
  if (trace.secrets) console.log(`Secrets: ${formatTracePart(trace.secrets)}`);
  if (Array.isArray(trace.explain) && trace.explain.length) {
    console.log("Why:");
    for (const line of trace.explain) console.log(`- ${line}`);
  }
  console.log(`Path: ${path.resolve(file)}`);
}

function printTrustedReceiptExplanation(receipt, file) {
  const decision = receipt.decision || {};
  const action = receipt.action || {};
  const execution = receipt.execution || {};
  console.log(`Receipt: ${receiptId(file)}`);
  console.log(`Verdict: ${decision.verdict || "unknown"}`);
  console.log(`Reason: ${decision.reason || "inside policy"}`);
  console.log(`Runtime: ${action.runtime || "unknown"}`);
  console.log(`Tool: ${action.toolName || "unknown"}`);
  console.log(`Policy: ${receipt.policyHash || ""}`);
  console.log(`Action: ${receipt.actionHash || ""}`);
  console.log(`Execution: ${execution.status || "unknown"}${execution.exitCode === undefined ? "" : ` exit=${execution.exitCode}`}`);
  const resources = decision.resources || action.resources || [];
  if (resources.length) {
    console.log("Resources:");
    for (const resource of resources) console.log(`- ${resource.role}: ${resource.canonical || resource.value}`);
  }
  const trace = receipt.trace || {};
  if (Array.isArray(trace.explain) && trace.explain.length) {
    console.log("Why:");
    for (const line of trace.explain) console.log(`- ${line}`);
  }
  console.log(`Path: ${path.resolve(file)}`);
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

module.exports = {
  main,
  createCharon,
  defaultPolicy,
  decideAction,
  validatePolicy,
  normalizePolicyForHash,
  scrubEnv,
};
