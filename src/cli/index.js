"use strict";

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");

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
    case "doctor":
      return doctor(args);
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
      return aeonCommand(args);
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

Usage:
  charon init
  charon doctor
  charon compile
  charon gate -- <command>
  charon queue
  charon approve <id>
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
  charon aeon init
  charon aeon enable
  charon aeon status
  charon aeon disable
  charon aeon run <skill> [-- <command>]
  charon receipts [list|latest|inspect <id|latest>]
  charon verify <receipt|latest>

macOS-only. Local action gates and OpenShell-backed sandboxing for autonomous agents.
`);
}

function init(args) {
  assertMac();
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

function doctor() {
  assertMac();
  const checks = [
    ["macOS", process.platform === "darwin", `${os.type()} ${os.release()}`, true],
    ["OpenShell CLI", hasCommand("openshell"), commandPath("openshell") || "not found", true],
    ["e2fsprogs mkfs.ext4", hasMkfsExt4(), mkfsExt4Path() || "not found", true],
    ["Docker or Colima", hasCommand("docker"), commandPath("docker") || "not found", false],
    ["charon.yml", fs.existsSync(CONFIG), path.resolve(CONFIG), true],
  ];

  const openshell = openshellStatus();
  checks.push(["OpenShell gateway", openshell.ok, openshell.detail, true]);

  for (const [name, ok, detail, required] of checks) {
    const label = ok ? "OK " : required ? "NO " : "WARN";
    console.log(`${label} ${name}${detail ? ` - ${detail}` : ""}`);
  }

  if (!checks.every(([, ok, , required]) => !required || ok)) {
    console.log("");
    console.log("Install OpenShell and VM dependencies:");
    console.log("curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh");
    console.log("brew install e2fsprogs");
    process.exitCode = 1;
  }
}

function compileCommand(args) {
  assertMac();
  const policy = loadPolicy();
  const compiled = compileOpenShell(policy, process.cwd(), args);
  ensureDir(GENERATED_DIR);
  const out = path.join(GENERATED_DIR, "openshell-policy.yml");
  fs.writeFileSync(out, yaml.dump(compiled.config, { lineWidth: 100 }));
  console.log(yaml.dump(compiled.config, { lineWidth: 100 }).trimEnd());
  console.log("");
  console.log(`policy_hash: ${compiled.policyHash}`);
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
  assertMac();
  const sep = args.indexOf("--");
  const command = sep >= 0 ? args.slice(sep + 1) : args;
  if (!command.length) throw new Error("usage: charon gate -- <command>");

  const policy = loadPolicy();
  const decision = meta.approvedQueueId
    ? buildApprovedDecision(command, policy, meta.approvedQueueId)
    : decideAction(command, policy);
  if (decision.verdict === "DENY") {
    const receipt = writeReceipt({
      verdict: "DENY",
      reason: decision.reason,
      command,
      policy,
      meta,
      trace: completeTrace(decision.trace, "not_launched"),
      exitCode: 126,
    });
    console.error(`DENY ${decision.reason}`);
    console.error(`Receipt: ${receipt.path}`);
    const err = new Error("action denied");
    err.exitCode = 126;
    throw err;
  }

  if (decision.verdict === "PAUSE") {
    const item = enqueueAction({ command, policy, reason: decision.reason, meta });
    const receipt = writeReceipt({
      verdict: "PAUSE",
      reason: decision.reason,
      command,
      policy,
      meta: { ...meta, queueId: item.id },
      trace: completeTrace(decision.trace, "not_launched"),
      exitCode: 125,
    });
    console.error(`PAUSE ${decision.reason}`);
    console.error(`Queue: ${item.path}`);
    console.error(`Receipt: ${receipt.path}`);
    const err = new Error("action paused");
    err.exitCode = 125;
    throw err;
  }

  const compiled = compileOpenShell(policy, process.cwd(), []);
  ensureDir(GENERATED_DIR);
  const policyPath = path.join(GENERATED_DIR, "openshell-policy.yml");
  fs.writeFileSync(policyPath, yaml.dump(compiled.config, { lineWidth: 100 }));

  const launcher = buildOpenShellCommand(command, policyPath);
  const startedAt = new Date().toISOString();
  const result = childProcess.spawnSync(launcher[0], launcher.slice(1), {
    cwd: process.cwd(),
    env: scrubEnv(process.env, policy),
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const outputBoundary = scanOutputBoundary(result.stdout || "", result.stderr || "", policy);
  const exitCode = typeof result.status === "number" ? result.status : result.error ? 127 : 0;
  const finalVerdict = outputBoundary.status === "denied" ? "DENY" : exitCode === 0 ? "PASS" : "ERROR";
  const finalExitCode = outputBoundary.status === "denied" ? 126 : exitCode;
  const receipt = writeReceipt({
    verdict: finalVerdict,
    reason: outputBoundary.status === "denied" ? outputBoundary.reason : result.error ? result.error.message : "",
    command,
    policy,
    meta,
    exitCode: finalExitCode,
    startedAt,
    backend: "openshell",
    generatedPolicy: policyPath,
    trace: addOutputTrace(completeTrace(decision.trace, exitCode === 0 ? "launched" : "error", {
      backend: "openshell",
      exitCode: finalExitCode,
    }), outputBoundary),
    output: outputBoundary.receiptOutput,
  });
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
    console.log([
      item.id,
      pad(item.status || "paused", 8),
      item.reason || "",
      item.command ? item.command.join(" ") : "",
      item.createdAt || "",
    ].filter(Boolean).join("  "));
  }
}

function approveCommand(args) {
  const id = args[0];
  if (!id) throw new Error("usage: charon approve <id>");
  const item = loadQueuedAction(id);
  if (item.status !== "paused") throw new Error(`queued action is not paused: ${id}`);
  if (item.cwd) process.chdir(item.cwd);
  item.status = "approved";
  item.reviewedAt = new Date().toISOString();
  item.decision = "approved";
  saveQueuedAction(item);
  console.log(`Approved ${id}`);
  return gateCommand(["--", ...item.command], { ...item.meta, approvedQueueId: id });
}

function rejectCommand(args) {
  const id = args[0];
  if (!id) throw new Error("usage: charon reject <id>");
  const item = loadQueuedAction(id);
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

function statusCommand(args) {
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
        return {
          pass: decision.verdict === "PASS",
          pause: decision.verdict === "PAUSE",
          deny: decision.verdict === "DENY",
          verdict: decision.verdict,
          reason: decision.reason,
          trace: receipt.receipt.trace,
          receipt: receipt.path,
          queueId,
        };
      } finally {
        process.chdir(previous);
      }
    },
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

function buildOpenShellCommand(command, policyPath) {
  const mock = process.env.CHARON_OPEN_SHELL_MOCK;
  if (mock) return [mock, policyPath, ...command];
  if (!hasCommand("openshell")) {
    throw new Error("OpenShell CLI not found. Run `charon doctor` for install guidance.");
  }
  return ["openshell", "sandbox", "create", "--policy", policyPath, "--", ...command];
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
  throw new Error("usage: charon aeon init | enable | status | disable | run <skill> [-- <command>]");
}

function aeonInit(args) {
  assertAeonRepo();
  if (!fs.existsSync(CONFIG) || args.includes("--force")) {
    const policy = defaultPolicy();
    policy.agent = { runtime: "aeon" };
    policy.sandbox.files.write = ["articles/**", "reports/**", "memory/**", ".charon/**"];
    fs.writeFileSync(CONFIG, yaml.dump(policy, { lineWidth: 100 }));
  }
  ensureDir(RECEIPTS_DIR);
  console.log("Charon initialized for Aeon.");
  console.log(`- policy: ${path.resolve(CONFIG)}`);
}

function aeonEnable(args) {
  assertAeonRepo();
  aeonInit(args);
  const hookDir = path.join(".charon", "aeon");
  ensureDir(hookDir);
  const hook = path.join(hookDir, "run-skill.js");
  fs.writeFileSync(hook, aeonHookSource(), { mode: 0o755 });
  console.log("Charon Gate enabled for Aeon.");
  console.log(`- hook: ${path.resolve(hook)}`);
  console.log("Use `charon aeon run <skill>` locally, or call the hook from Aeon automation.");
}

function aeonStatus() {
  assertAeonRepo();
  const hook = path.join(".charon", "aeon", "run-skill.js");
  const checks = [
    ["policy", fs.existsSync(CONFIG), path.resolve(CONFIG)],
    ["hook", fs.existsSync(hook), path.resolve(hook)],
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
  if (fs.existsSync(hook)) fs.rmSync(hook);
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

function defaultAeonCommand(skillFile) {
  if (!hasCommand("claude")) {
    return ["sh", "-lc", `echo "Claude CLI not found. Verified Charon sandbox launch for ${shellQuote(skillFile)}."`];
  }
  return ["sh", "-lc", `claude -p - < ${shellQuote(skillFile)}`];
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
    sandbox: {
      backend: "openshell",
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
      deny: policy.sandbox && policy.sandbox.commands ? policy.sandbox.commands.deny || [] : [],
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
  const sandbox = policy.sandbox;
  if (!sandbox || typeof sandbox !== "object") throw new Error(`${CONFIG} missing sandbox`);
  for (const key of ["files", "network", "commands", "env"]) {
    if (!sandbox[key] || typeof sandbox[key] !== "object") throw new Error(`${CONFIG} missing sandbox.${key}`);
  }
  if (!sandbox.output || typeof sandbox.output !== "object") {
    sandbox.output = { secretAction: "deny", store: "redacted", maxBytes: 4000 };
  }
  if (!["deny", "pause", "pass"].includes(sandbox.output.secretAction || "deny")) {
    throw new Error("sandbox.output.secretAction must be deny, pause, or pass");
  }
  if (!["none", "redacted"].includes(sandbox.output.store || "redacted")) {
    throw new Error("sandbox.output.store must be none or redacted");
  }
  for (const [section, keys] of Object.entries({
    files: ["read", "write", "deny"],
    network: ["allow"],
    commands: ["deny"],
    env: ["expose", "deny"],
  })) {
    for (const key of keys) {
      const value = sandbox[section][key];
      if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) {
        throw new Error(`sandbox.${section}.${key} must be a string array`);
      }
    }
  }
}

function compileOpenShell(policy, cwd) {
  validatePolicy(policy);
  const sandbox = policy.sandbox;
  const readOnly = sandbox.files.read
    .filter((item) => item !== ".")
    .map((item) => absolutizePolicyPath(item, cwd));
  const readWrite = sandbox.files.write
    .filter((item) => item !== ".")
    .map((item) => absolutizePolicyPath(item, cwd));
  const networkPolicies = {};
  for (const host of sandbox.network.allow) {
    const key = host.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "host";
    networkPolicies[key] = {
      name: key,
      endpoints: [
        {
          host,
          port: 443,
          protocol: "rest",
          enforcement: "enforce",
          access: "read-only",
        },
      ],
      binaries: [
        { path: "/bin/**" },
        { path: "/usr/bin/**" },
        { path: "/usr/local/bin/**" },
        { path: "/opt/homebrew/bin/**" },
        { path: "/sandbox/**" },
      ],
    };
  }
  const body = {
    version: 1,
    filesystem_policy: {
      include_workdir: true,
      read_only: readOnly,
      read_write: ["/sandbox", "/tmp", "/dev/null", ...readWrite],
    },
    landlock: {
      compatibility: "best_effort",
    },
    process: {
      run_as_user: "sandbox",
      run_as_group: "sandbox",
    },
    network_policies: networkPolicies,
  };
  return { config: body, policyHash: hashObject(body) };
}

function decideAction(command, policy) {
  const rendered = command.join(" ");
  const trace = buildBoundaryTrace(command, policy);
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

function buildBoundaryTrace(command, policy) {
  const rendered = command.join(" ");
  const secrets = scanSecrets(rendered);
  const secretKinds = [...new Set(secrets.map((item) => item.kind))];
  const deniedFiles = detectDeniedFiles(rendered, policy);
  const network = detectNetworkHosts(rendered, policy);
  const ruleMatch = matchStructuredRule(command, policy);
  const deniedAction = [...policy.bounds.deny, ...policy.sandbox.commands.deny]
    .find((item) => actionMatches(rendered, item));
  const pausedAction = policy.bounds.pause.find((item) => actionMatches(rendered, item));
  const secretAction = policy.bounds.secretAction || "deny";
  return {
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
      ? { status: normalizeVerdictStatus(ruleMatch.verdict), match: ruleMatch.id, rule: ruleMatch }
      : deniedAction
      ? { status: "denied", match: deniedAction }
      : pausedAction
        ? { status: "paused", match: pausedAction }
        : { status: "passed", match: "" },
    sandbox: {
      status: "pending",
      backend: policy.sandbox.backend || "openshell",
    },
  };
}

function matchStructuredRule(command, policy) {
  const rules = Array.isArray(policy.bounds.rules) ? policy.bounds.rules : [];
  return rules.find((rule) => structuredRuleMatches(command, rule));
}

function structuredRuleMatches(command, rule) {
  if (!rule || typeof rule !== "object") return false;
  const first = command[0] || "";
  if (rule.command && first !== rule.command) return false;
  const rendered = command.join(" ");
  if (rule.includes && !rendered.includes(rule.includes)) return false;
  if (Array.isArray(rule.argsIncludes)) {
    for (const part of rule.argsIncludes) {
      if (!command.slice(1).some((arg) => String(arg).includes(part))) return false;
    }
  }
  if (rule.toolName && !rendered.includes(rule.toolName)) return false;
  return true;
}

function normalizeVerdictStatus(verdict) {
  const value = String(verdict || "").toUpperCase();
  if (value === "DENY") return "denied";
  if (value === "PAUSE") return "paused";
  return "passed";
}

function completeTrace(trace, sandboxStatus, extra = {}) {
  return {
    ...trace,
    sandbox: {
      ...(trace && trace.sandbox ? trace.sandbox : {}),
      status: sandboxStatus,
      ...extra,
    },
  };
}

function detectDeniedFiles(rendered, policy) {
  return policy.sandbox.files.deny.filter((item) => rendered.includes(stripGlob(item)));
}

function detectNetworkHosts(rendered, policy) {
  const hosts = extractHosts(rendered);
  if (!hosts.length) return { status: "not_requested", hosts: [], denied: [], allowed: [] };
  const allowed = hosts.filter((host) => hostAllowed(host, policy.sandbox.network.allow));
  const denied = hosts.filter((host) => !hostAllowed(host, policy.sandbox.network.allow));
  return denied.length
    ? { status: "denied", hosts, denied, allowed }
    : { status: "allowed", hosts, denied: [], allowed };
}

function extractHosts(value) {
  const hosts = new Set();
  const urlRe = /\bhttps?:\/\/([a-zA-Z0-9.-]+)(?::\d+)?(?:[/?#][^\s"']*)?/g;
  for (const match of String(value || "").matchAll(urlRe)) {
    hosts.add(match[1].toLowerCase());
  }
  return [...hosts];
}

function hostAllowed(host, allowlist) {
  return allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function stripGlob(value) {
  return expandPath(value).replace(/\*\*$/g, "").replace(/\*$/g, "").replace(/\/$/g, "");
}

function actionMatches(rendered, pattern) {
  if (pattern.startsWith("read:")) return rendered.includes(pattern.slice("read:".length).replace(/\*\*$/g, ""));
  return rendered.includes(pattern);
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
  const maxBytes = Number(policy.sandbox.output.maxBytes || 4000);
  const store = policy.sandbox.output.store || "redacted";
  const action = policy.sandbox.output.secretAction || "deny";
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
  const expose = new Set(policy.sandbox.env.expose);
  const deny = new Set(policy.sandbox.env.deny);
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
  const policyHash = hashObject(compileOpenShell(input.policy, process.cwd()).config);
  const redactedCommand = redactCommand(input.command);
  const redactedReason = redactText(input.reason || "");
  const body = {
    schema: "charon.receipt.v1",
    createdAt: new Date().toISOString(),
    startedAt: input.startedAt || new Date().toISOString(),
    endedAt: new Date().toISOString(),
    verdict: input.verdict,
    reason: redactedReason.value,
    backend: input.backend || "openshell",
    command: redactedCommand.value,
    commandRedactions: redactedCommand.redactions,
    reasonRedactions: redactedReason.redactions,
    cwd: process.cwd(),
    policyHash,
    generatedPolicy: input.generatedPolicy ? path.resolve(input.generatedPolicy) : "",
    exposedEnv: input.policy.sandbox.env.expose,
    deniedEnv: input.policy.sandbox.env.deny,
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
    policyHash: hashObject(compileOpenShell(input.policy, process.cwd()).config),
    meta: input.meta || {},
  };
  const file = path.join(QUEUE_DIR, `${id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(item, null, 2)}\n`);
  return { id, path: path.resolve(file), item };
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
  fs.writeFileSync(path.join(QUEUE_DIR, `${item.id}.json`), `${JSON.stringify(item, null, 2)}\n`);
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
    if (!policy.sandbox.files.deny.includes(item)) {
      changes.push(policyChange("tighten", "sandbox.files.deny", "add", item, "protect common sensitive path"));
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
    if (["test", "lint", "typecheck", "build"].includes(name) && !policy.bounds.pass.includes(command)) {
      changes.push(policyChange("loosen", "bounds.pass", "add", String(command), `allow package script: ${name}`));
    }
    if (/publish|release|deploy/i.test(name) && !policy.bounds.pause.includes(command)) {
      changes.push(policyChange("tighten", "bounds.pause", "add", String(command), `review package script: ${name}`));
    }
  }
  return changes;
}

function inferAeonSkillChanges(policy) {
  const changes = [];
  if (!fs.existsSync("skills")) return changes;
  for (const skill of listDirectories("skills")) {
    const file = path.join("skills", skill, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const reportPath = `reports/${skill}/**`;
    if (/report|audit|summary|write/i.test(text) && !policy.sandbox.files.write.includes(reportPath)) {
      changes.push(policyChange("loosen", "sandbox.files.write", "add", reportPath, `skill ${skill} appears to write reports`));
    }
    for (const host of extractHosts(text)) {
      if (!hostAllowed(host, policy.sandbox.network.allow)) {
        changes.push(policyChange("loosen", "sandbox.network.allow", "add", host, `skill ${skill} references host`));
      }
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
        if (!hostAllowed(host, policy.sandbox.network.allow)) {
          changes.push(policyChange("loosen", "sandbox.network.allow", "add", host, "previous trace requested host"));
        }
      }
    }
    if (trace.files && trace.files.status === "denied") {
      for (const match of trace.files.matches || []) {
        if (!policy.sandbox.files.deny.includes(match)) {
          changes.push(policyChange("tighten", "sandbox.files.deny", "add", match, "preserve denied file path from trace"));
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
    const key = `${change.kind}:${change.target}:${change.op}:${change.value}`;
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
    console.log(`${change.kind.toUpperCase()} ${change.target} += ${change.value} - ${change.reason}`);
  }
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
  console.log(`Receipt: ${path.resolve(file)}`);
  console.log(`Verdict: ${receipt.verdict}`);
  console.log(`Runtime: ${receipt.meta && receipt.meta.runtime ? receipt.meta.runtime : "command"}`);
  if (receipt.meta && receipt.meta.skill) console.log(`Skill: ${receipt.meta.skill}`);
  console.log(`Backend: ${receipt.backend}`);
  console.log(`Policy: ${receipt.policyHash}`);
  console.log(`Exit: ${receipt.exitCode}`);
}

function printTrace(receipt, file) {
  const trace = receipt.trace || {};
  console.log(`Trace: ${receiptId(file)}`);
  console.log(`Verdict: ${receipt.verdict}`);
  console.log(`Reason: ${receipt.reason || ""}`);
  console.log(`Identity: ${trace.identity ? formatTracePart(trace.identity) : "unknown"}`);
  console.log(`Secrets: ${trace.secrets ? formatTracePart(trace.secrets) : "unknown"}`);
  console.log(`Files: ${trace.files ? formatTracePart(trace.files) : "unknown"}`);
  console.log(`Network: ${trace.network ? formatTracePart(trace.network) : "unknown"}`);
  console.log(`Action: ${trace.action ? formatTracePart(trace.action) : "unknown"}`);
  console.log(`Sandbox: ${trace.sandbox ? formatTracePart(trace.sandbox) : "unknown"}`);
  console.log(`Output: ${trace.output ? formatTracePart(trace.output) : "unknown"}`);
  console.log(`Receipt: ${path.resolve(file)}`);
}

function formatTracePart(part) {
  const details = [
    part.match,
    part.kinds && part.kinds.length ? part.kinds.join(",") : "",
    part.matches && part.matches.length ? part.matches.join(",") : "",
    part.denied && part.denied.length ? part.denied.join(",") : "",
    part.hosts && part.hosts.length && part.status !== "denied" ? part.hosts.join(",") : "",
    part.backend || "",
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

function assertMac() {
  if (process.platform !== "darwin") throw new Error("Charon sandbox v1 is macOS-only.");
}

function assertAeonRepo() {
  if (!fs.existsSync("aeon.yml") || !fs.existsSync("skills")) {
    throw new Error("not inside an Aeon repo");
  }
}

function openshellStatus() {
  if (!hasCommand("openshell")) return { ok: false, detail: "openshell not found" };
  const result = childProcess.spawnSync("openshell", ["status"], { encoding: "utf8" });
  const text = `${result.stdout || ""}${result.stderr || ""}`.trim();
  return { ok: result.status === 0, detail: text || `exit ${result.status}` };
}

function hasCommand(cmd) {
  return childProcess.spawnSync("sh", ["-lc", `command -v ${shellQuote(cmd)}`], { stdio: "ignore" }).status === 0;
}

function commandPath(cmd) {
  const result = childProcess.spawnSync("sh", ["-lc", `command -v ${shellQuote(cmd)}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function hasMkfsExt4() {
  return Boolean(mkfsExt4Path());
}

function mkfsExt4Path() {
  const candidates = [
    "/opt/homebrew/opt/e2fsprogs/bin/mkfs.ext4",
    "/opt/homebrew/opt/e2fsprogs/sbin/mkfs.ext4",
    "/usr/local/opt/e2fsprogs/bin/mkfs.ext4",
    "/usr/local/opt/e2fsprogs/sbin/mkfs.ext4",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || commandPath("mkfs.ext4");
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
  compileOpenShell,
  scrubEnv,
};
