"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "charon.js");
const { createCharon } = require("..");
const { createAeonAdapter } = require("charon/adapters/aeon");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "charon-test-"));
}

function run(args, opts = {}) {
  return childProcess.spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
  });
}

test("init creates default policy", () => {
  const cwd = tmpdir();
  const result = run(["init"], { cwd });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(path.join(cwd, "charon.yml"), "utf8"), /backend: openshell/);
});

test("compile emits deterministic OpenShell policy", () => {
  const cwd = tmpdir();
  assert.equal(run(["init"], { cwd }).status, 0);
  const first = run(["compile"], { cwd });
  const second = run(["compile"], { cwd });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.match(first.stdout, /filesystem_policy:/);
  assert.match(first.stdout, /network_policies:/);
  assert.match(first.stdout, /policy_hash:/);
  assert.equal(hashLine(first.stdout), hashLine(second.stdout));
});

test("run uses mocked OpenShell and writes verifiable receipt", () => {
  const cwd = tmpdir();
  const mock = path.join(cwd, "openshell-mock.sh");
  fs.writeFileSync(mock, "#!/bin/sh\nshift\nexec \"$@\"\n");
  fs.chmodSync(mock, 0o755);
  assert.equal(run(["init"], { cwd }).status, 0);

  const result = run(["run", "--", "node", "-e", "console.log('inside')"], {
    cwd,
    env: { CHARON_OPEN_SHELL_MOCK: mock },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /inside/);
  assert.match(result.stdout, /Charon receipt:/);

  const verify = run(["verify", "latest"], { cwd });
  assert.equal(verify.status, 0, verify.stderr);
});

test("keygen signs receipts and verify checks identity proof", () => {
  const cwd = tmpdir();
  const mock = path.join(cwd, "openshell-mock.sh");
  fs.writeFileSync(mock, "#!/bin/sh\nshift\nexec \"$@\"\n");
  fs.chmodSync(mock, 0o755);
  assert.equal(run(["init"], { cwd }).status, 0);
  assert.equal(run(["keygen"], { cwd }).status, 0);

  const result = run(["gate", "--", "node", "-e", "console.log('signed')"], {
    cwd,
    env: { CHARON_OPEN_SHELL_MOCK: mock },
  });
  assert.equal(result.status, 0, result.stderr);
  const receipt = run(["receipts", "inspect", "latest"], { cwd });
  assert.match(receipt.stdout, /"identity"/);
  const verify = run(["verify", "latest"], { cwd });
  assert.equal(verify.status, 0, verify.stderr);
});

test("output boundary denies and redacts secret output", () => {
  const cwd = tmpdir();
  const mock = path.join(cwd, "openshell-mock.sh");
  fs.writeFileSync(mock, "#!/bin/sh\nshift\nexec \"$@\"\n");
  fs.chmodSync(mock, 0o755);
  assert.equal(run(["init"], { cwd }).status, 0);
  const token = "github_pat_123456789012345678901234567890abcdef";
  const suffix = token.slice("github_pat_".length);
  const result = run(["gate", "--", "node", "-e", `console.log('github_pat_' + '${suffix}')`], {
    cwd,
    env: { CHARON_OPEN_SHELL_MOCK: mock },
  });
  assert.equal(result.status, 126);
  const receipt = run(["receipts", "inspect", "latest"], { cwd });
  assert.doesNotMatch(receipt.stdout, new RegExp(token));
  assert.match(receipt.stdout, /REDACTED:github/);
  assert.match(receipt.stdout, /"output"/);
});

test("denied command is blocked before launch", () => {
  const cwd = tmpdir();
  assert.equal(run(["init"], { cwd }).status, 0);
  const result = run(["gate", "--", "sh", "-lc", "npm publish"], { cwd });
  assert.equal(result.status, 126);
  assert.match(result.stderr, /DENY/);
});

test("structured policy rules can deny commands", () => {
  const cwd = tmpdir();
  assert.equal(run(["init"], { cwd }).status, 0);
  const policy = yaml.load(fs.readFileSync(path.join(cwd, "charon.yml"), "utf8"));
  policy.bounds.rules = [
    { id: "custom.node_eval", verdict: "DENY", command: "node", argsIncludes: ["-e"] },
  ];
  fs.writeFileSync(path.join(cwd, "charon.yml"), yaml.dump(policy));
  const result = run(["gate", "--", "node", "-e", "console.log(1)"], { cwd });
  assert.equal(result.status, 126);
  const trace = run(["trace", "latest"], { cwd });
  assert.match(trace.stdout, /custom\.node_eval/);
});

test("secret-like action is denied and receipt is redacted", () => {
  const cwd = tmpdir();
  assert.equal(run(["init"], { cwd }).status, 0);
  const token = "github_pat_123456789012345678901234567890abcdef";
  const result = run(["gate", "--", "curl", "-H", `Authorization: Bearer ${token}`, "https://example.com"], { cwd });
  assert.equal(result.status, 126);
  assert.match(result.stderr, /secret-like value/);

  const receiptDir = path.join(cwd, ".charon", "receipts");
  const receiptFile = fs.readdirSync(receiptDir).find((file) => file.endsWith(".json"));
  const receipt = fs.readFileSync(path.join(receiptDir, receiptFile), "utf8");
  assert.doesNotMatch(receipt, new RegExp(token));
  assert.match(receipt, /REDACTED:github/);
});

test("boundary trace records denied network host", () => {
  const cwd = tmpdir();
  assert.equal(run(["init"], { cwd }).status, 0);
  const result = run(["gate", "--", "curl", "https://webhook.site/demo"], { cwd });
  assert.equal(result.status, 126);
  assert.match(result.stderr, /network host outside bounds/);

  const trace = run(["trace", "latest"], { cwd });
  assert.equal(trace.status, 0, trace.stderr);
  assert.match(trace.stdout, /Network: denied - webhook\.site/);
  assert.match(trace.stdout, /Sandbox: not_launched/);
});

test("boundary trace records denied file path", () => {
  const cwd = tmpdir();
  assert.equal(run(["init"], { cwd }).status, 0);
  const result = run(["gate", "--", "cat", ".env"], { cwd });
  assert.equal(result.status, 126);
  assert.match(result.stderr, /denied file path/);

  const latest = run(["receipts", "inspect", "latest"], { cwd });
  assert.equal(latest.status, 0, latest.stderr);
  assert.match(latest.stdout, /"trace"/);
  assert.match(latest.stdout, /"files"/);
  assert.match(latest.stdout, /"status": "denied"/);
});

test("policy synth proposes changes from package scripts", () => {
  const cwd = tmpdir();
  assert.equal(run(["init"], { cwd }).status, 0);
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    scripts: {
      lint: "eslint .",
      release: "npm publish",
    },
  }));

  const synth = run(["policy", "synth"], { cwd });
  assert.equal(synth.status, 0, synth.stderr);
  assert.match(synth.stdout, /Proposal: cp-/);
  assert.match(synth.stdout, /LOOSEN bounds.rules \+= package.lint/);
  assert.match(synth.stdout, /TIGHTEN bounds.rules \+= package.release/);

  const apply = run(["policy", "apply", "latest"], { cwd });
  assert.notEqual(apply.status, 0);
  assert.match(apply.stderr, /loosening changes/);

  const applyYes = run(["policy", "apply", "latest", "--yes"], { cwd });
  assert.equal(applyYes.status, 0, applyYes.stderr);
  const policy = fs.readFileSync(path.join(cwd, "charon.yml"), "utf8");
  assert.match(policy, /package.lint/);
});

test("policy synth proposes Aeon skill write profile", () => {
  const cwd = tmpdir();
  fs.mkdirSync(path.join(cwd, "skills", "audit"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "aeon.yml"), "audit: { enabled: true }\n");
  fs.writeFileSync(path.join(cwd, "skills", "audit", "SKILL.md"), "Write an audit report using https://api.github.com/repos/demo/demo\n");
  assert.equal(run(["aeon", "init"], { cwd }).status, 0);

  const synth = run(["policy", "synth"], { cwd });
  assert.equal(synth.status, 0, synth.stderr);
  assert.match(synth.stdout, /reports\/audit\/\*\*/);
});

test("SDK gates structured shell tool calls", () => {
  const cwd = tmpdir();
  assert.equal(run(["init"], { cwd }).status, 0);
  const charon = createCharon({ cwd });
  const decision = charon.gateToolCall({
    runtime: "test",
    toolName: "shell",
    args: ["sh", "-lc", "npm publish"],
    context: "release attempt",
  });

  assert.equal(decision.verdict, "DENY");
  assert.equal(decision.pass, false);
  assert.match(decision.reason, /outside bounds/);
  assert.ok(fs.existsSync(decision.receipt));
});

test("SDK queues paused structured tool calls", () => {
  const cwd = tmpdir();
  assert.equal(run(["init"], { cwd }).status, 0);
  const charon = createCharon({ cwd });
  const decision = charon.gateToolCall({
    runtime: "aeon",
    skill: "ship",
    toolName: "shell",
    args: ["sh", "-lc", "git push"],
  });

  assert.equal(decision.verdict, "PAUSE");
  assert.equal(decision.pause, true);
  assert.match(decision.queueId, /^cq-/);
  assert.ok(fs.existsSync(path.join(cwd, ".charon", "queue", `${decision.queueId}.json`)));
});

test("SDK redacts secret-bearing tool calls", () => {
  const cwd = tmpdir();
  assert.equal(run(["init"], { cwd }).status, 0);
  const token = "github_pat_123456789012345678901234567890abcdef";
  const charon = createCharon({ cwd });
  const decision = charon.gateToolCall({
    runtime: "custom",
    toolName: "http.request",
    toolArgs: { url: "https://api.github.com", token },
  });

  assert.equal(decision.verdict, "DENY");
  const receipt = fs.readFileSync(decision.receipt, "utf8");
  assert.doesNotMatch(receipt, new RegExp(token));
  assert.match(receipt, /REDACTED:github/);
});

test("runtime adapter gates Aeon tool calls", () => {
  const cwd = tmpdir();
  assert.equal(run(["init"], { cwd }).status, 0);
  const adapter = createAeonAdapter({ cwd });
  const decision = adapter.beforeToolCall({
    skill: "demo",
    toolName: "shell",
    args: ["sh", "-lc", "npm publish"],
  });
  assert.equal(decision.verdict, "DENY");
});

test("paused command enters local queue and can be rejected", () => {
  const cwd = tmpdir();
  assert.equal(run(["init"], { cwd }).status, 0);
  const result = run(["gate", "--", "sh", "-lc", "git push"], { cwd });
  assert.equal(result.status, 125);
  assert.match(result.stderr, /PAUSE/);

  const queue = run(["queue"], { cwd });
  assert.equal(queue.status, 0, queue.stderr);
  assert.match(queue.stdout, /requires release review/);
  const id = queue.stdout.trim().split(/\s+/)[0];

  const queuedPath = path.join(cwd, ".charon", "queue", `${id}.json`);
  const queued = JSON.parse(fs.readFileSync(queuedPath, "utf8"));
  queued.reason = "tampered";
  fs.writeFileSync(queuedPath, JSON.stringify(queued, null, 2));
  const tampered = run(["approve", id], { cwd, env: { CHARON_OPEN_SHELL_MOCK: "/bin/echo" } });
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /verification failed/);

  assert.equal(run(["gate", "--", "sh", "-lc", "git push"], { cwd }).status, 125);
  const id2 = run(["queue"], { cwd }).stdout.trim().split(/\s+/)[0];

  const reject = run(["reject", id2], { cwd });
  assert.equal(reject.status, 0, reject.stderr);
  assert.match(reject.stdout, /Rejected/);
});

test("history aliases receipts", () => {
  const cwd = tmpdir();
  const mock = path.join(cwd, "openshell-mock.sh");
  fs.writeFileSync(mock, "#!/bin/sh\nshift\nexec \"$@\"\n");
  fs.chmodSync(mock, 0o755);
  assert.equal(run(["init"], { cwd }).status, 0);
  assert.equal(run(["gate", "--", "node", "-e", "console.log('history')"], {
    cwd,
    env: { CHARON_OPEN_SHELL_MOCK: mock },
  }).status, 0);

  const history = run(["history", "latest"], { cwd });
  assert.equal(history.status, 0, history.stderr);
  assert.match(history.stdout, /Verdict: PASS/);
});

test("aeon init and run tag receipts with skill name", () => {
  const cwd = tmpdir();
  fs.mkdirSync(path.join(cwd, "skills", "demo"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "aeon.yml"), "demo: { enabled: true }\n");
  fs.writeFileSync(path.join(cwd, "skills", "demo", "SKILL.md"), "# Demo\n");
  const mock = path.join(cwd, "openshell-mock.sh");
  fs.writeFileSync(mock, "#!/bin/sh\nshift\nexec \"$@\"\n");
  fs.chmodSync(mock, 0o755);

  assert.equal(run(["aeon", "init"], { cwd }).status, 0);
  const result = run(["aeon", "run", "demo", "--", "node", "-e", "console.log('aeon')"], {
    cwd,
    env: { CHARON_OPEN_SHELL_MOCK: mock },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /aeon/);

  const latest = run(["receipts", "latest"], { cwd });
  assert.match(latest.stdout, /Runtime: aeon/);
  assert.match(latest.stdout, /Skill: demo/);
});

test("aeon enable writes local gate hook", () => {
  const cwd = tmpdir();
  fs.mkdirSync(path.join(cwd, "skills", "demo"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "aeon.yml"), "demo: { enabled: true }\n");
  fs.writeFileSync(path.join(cwd, "skills", "demo", "SKILL.md"), "# Demo\n");
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: {} }));

  const result = run(["aeon", "enable"], { cwd });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(cwd, ".charon", "aeon", "run-skill.js")));
  assert.ok(fs.existsSync(path.join(cwd, "scripts", "charon-aeon-runner.js")));
  assert.ok(fs.existsSync(path.join(cwd, ".charon", "aeon", "manifest.json")));
  assert.match(fs.readFileSync(path.join(cwd, "package.json"), "utf8"), /charon:aeon/);

  const status = run(["aeon", "status"], { cwd });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /OK  hook/);

  const disable = run(["aeon", "disable"], { cwd });
  assert.equal(disable.status, 0, disable.stderr);
  assert.equal(fs.existsSync(path.join(cwd, ".charon", "aeon", "run-skill.js")), false);
  assert.equal(fs.existsSync(path.join(cwd, "scripts", "charon-aeon-runner.js")), false);
});

function hashLine(output) {
  return output.split(/\n/).find((line) => line.startsWith("policy_hash:"));
}
