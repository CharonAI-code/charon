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
const GENERATED_DIR = path.join(STATE_DIR, "generated");
const KEY_FILE = path.join(STATE_DIR, "receipt.key");
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
  charon run -- <command>
  charon aeon init
  charon aeon enable
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
    stdio: "inherit",
  });
  const exitCode = typeof result.status === "number" ? result.status : result.error ? 127 : 0;
  const receipt = writeReceipt({
    verdict: exitCode === 0 ? "PASS" : "ERROR",
    reason: result.error ? result.error.message : "",
    command,
    policy,
    meta,
    exitCode,
    startedAt,
    backend: "openshell",
    generatedPolicy: policyPath,
    trace: completeTrace(decision.trace, exitCode === 0 ? "launched" : "error", {
      backend: "openshell",
      exitCode,
    }),
  });
  console.log(`Charon receipt: ${receipt.path}`);
  process.exitCode = exitCode;
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
  console.log(`OK ${path.resolve(file)}`);
}

function aeonCommand(args) {
  const [sub, ...rest] = args;
  if (sub === "init") return aeonInit(rest);
  if (sub === "enable") return aeonEnable(rest);
  if (sub === "run") return aeonRun(rest);
  throw new Error("usage: charon aeon init | enable | run <skill> [-- <command>]");
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
  const sandbox = policy.sandbox;
  if (!sandbox || typeof sandbox !== "object") throw new Error(`${CONFIG} missing sandbox`);
  for (const key of ["files", "network", "commands", "env"]) {
    if (!sandbox[key] || typeof sandbox[key] !== "object") throw new Error(`${CONFIG} missing sandbox.${key}`);
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
    action: deniedAction
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
    meta: input.meta || {},
  };
  body.signature = signObject(body);
  const id = `${body.createdAt.replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
  const file = path.join(RECEIPTS_DIR, `${id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return { id, path: path.resolve(file), receipt: body };
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
  console.log(`Identity: ${trace.identity ? trace.identity.status : "unknown"}`);
  console.log(`Secrets: ${trace.secrets ? formatTracePart(trace.secrets) : "unknown"}`);
  console.log(`Files: ${trace.files ? formatTracePart(trace.files) : "unknown"}`);
  console.log(`Network: ${trace.network ? formatTracePart(trace.network) : "unknown"}`);
  console.log(`Action: ${trace.action ? formatTracePart(trace.action) : "unknown"}`);
  console.log(`Sandbox: ${trace.sandbox ? formatTracePart(trace.sandbox) : "unknown"}`);
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
  defaultPolicy,
  validatePolicy,
  compileOpenShell,
  scrubEnv,
};
