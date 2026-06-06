"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "charon.js");

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

test("denied command is blocked before launch", () => {
  const cwd = tmpdir();
  assert.equal(run(["init"], { cwd }).status, 0);
  const result = run(["run", "--", "sh", "-lc", "git push"], { cwd });
  assert.equal(result.status, 126);
  assert.match(result.stderr, /Blocked by Charon policy/);
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

function hashLine(output) {
  return output.split(/\n/).find((line) => line.startsWith("policy_hash:"));
}
