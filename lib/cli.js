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
const GENERATED_DIR = path.join(STATE_DIR, "generated");
const KEY_FILE = path.join(STATE_DIR, "receipt.key");

async function main(argv) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "init":
      return init(args);
    case "doctor":
      return doctor(args);
    case "compile":
      return compileCommand(args);
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
  charon run -- <command>
  charon aeon init
  charon aeon run <skill> [-- <command>]
  charon receipts [list|latest|inspect <id|latest>]
  charon verify <receipt|latest>

macOS-only. OpenShell-backed sandboxing for autonomous agents.
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
  assertMac();
  const sep = args.indexOf("--");
  const command = sep >= 0 ? args.slice(sep + 1) : args;
  if (!command.length) throw new Error("usage: charon run -- <command>");

  const policy = loadPolicy();
  const denied = deniedCommand(command, policy);
  if (denied) {
    const receipt = writeReceipt({
      verdict: "blocked",
      reason: `denied command: ${denied}`,
      command,
      policy,
      meta,
      exitCode: 126,
    });
    console.error(`Blocked by Charon policy: ${denied}`);
    console.error(`Receipt: ${receipt.path}`);
    const err = new Error("command blocked");
    err.exitCode = 126;
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
    verdict: exitCode === 0 ? "allowed" : "error",
    reason: result.error ? result.error.message : "",
    command,
    policy,
    meta,
    exitCode,
    startedAt,
    backend: "openshell",
    generatedPolicy: policyPath,
  });
  console.log(`Charon receipt: ${receipt.path}`);
  process.exitCode = exitCode;
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
  if (sub === "run") return aeonRun(rest);
  throw new Error("usage: charon aeon init | run <skill> [-- <command>]");
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
        deny: ["git push", "npm publish", "rm -rf"],
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

function deniedCommand(command, policy) {
  const rendered = command.join(" ");
  return policy.sandbox.commands.deny.find((item) => rendered.includes(item));
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
  const body = {
    schema: "charon.receipt.v1",
    createdAt: new Date().toISOString(),
    startedAt: input.startedAt || new Date().toISOString(),
    endedAt: new Date().toISOString(),
    verdict: input.verdict,
    reason: input.reason || "",
    backend: input.backend || "openshell",
    command: input.command,
    cwd: process.cwd(),
    policyHash,
    generatedPolicy: input.generatedPolicy ? path.resolve(input.generatedPolicy) : "",
    exposedEnv: input.policy.sandbox.env.expose,
    deniedEnv: input.policy.sandbox.env.deny,
    exitCode: input.exitCode,
    meta: input.meta || {},
  };
  body.signature = signObject(body);
  const id = `${body.createdAt.replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
  const file = path.join(RECEIPTS_DIR, `${id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return { id, path: path.resolve(file), receipt: body };
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
