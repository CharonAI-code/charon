"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SKILL_ROOT = path.join(ROOT, "skills", "aeon", "charon-setup");
const SCRIPT = path.join(SKILL_ROOT, "scripts", "setup_charon_aeon.sh");
const CHARON = path.join(ROOT, "bin", "charon.js");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "charon-aeon-skill-test-"));
}

function run(command, args, opts = {}) {
  return childProcess.spawnSync(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
    encoding: "utf8",
  });
}

function aeonRepo() {
  const cwd = tmpdir();
  fs.mkdirSync(path.join(cwd, ".github", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "skills", "external-feature"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "skills", "digest"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "aeon.yml"), [
    "skills:",
    '  external-feature: { enabled: true, schedule: "workflow_dispatch", var: "" }',
    '  digest: { enabled: true, schedule: "0 7 * * *" }',
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(cwd, "skills", "external-feature", "SKILL.md"), [
    "---",
    "name: external-feature",
    "commits: true",
    "permissions:",
    "  - contents:write",
    "---",
    "Ship code.",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(cwd, "skills", "digest", "SKILL.md"), [
    "---",
    "name: digest",
    "---",
    "Read only digest.",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(cwd, ".github", "workflows", "aeon.yml"), [
    "name: Aeon",
    "on: workflow_dispatch",
    "jobs:",
    "  run:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - id: work",
    "        run: echo mode=skill >> $GITHUB_OUTPUT",
    "      - id: skill",
    "        run: echo name=external-feature >> $GITHUB_OUTPUT",
    "      - name: Run pre-fetch scripts",
    "        run: echo prefetch",
    "      - name: Run",
    "        run: |",
    "          ALLOWED=\"Bash(git:*),Write,Edit\"",
    "          claude -p \"run skill\" --allowedTools \"$ALLOWED\"",
    "",
  ].join("\n"));
  run("git", ["init"], { cwd });
  run("git", ["config", "user.name", "Test"], { cwd });
  run("git", ["config", "user.email", "test@example.com"], { cwd });
  run("git", ["add", "."], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  return cwd;
}

test("Aeon setup skill package is agent-readable", () => {
  assert.ok(fs.existsSync(path.join(SKILL_ROOT, "SKILL.md")));
  assert.ok(fs.existsSync(SCRIPT));
  const skill = fs.readFileSync(path.join(SKILL_ROOT, "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: charon-setup/m);
  assert.match(skill, /commits: true/);
  assert.match(skill, /workflows:write/);
  assert.match(skill, /Do not ask the user to run terminal commands/);
  assert.match(skill, /setup_charon_aeon\.sh/);
});

test("Aeon setup skill installs Charon and commits setup files", () => {
  const cwd = aeonRepo();
  const result = run("bash", [SCRIPT], {
    cwd,
    env: {
      CHARON_BIN: CHARON,
      CHARON_SETUP_NO_PUSH: "1",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.schema, "charon.aeonSetup.v1");
  assert.equal(out.status, "ok");
  assert.equal(out.committed, true);
  assert.equal(out.pushed, false);
  assert.equal(fs.existsSync(path.join(cwd, "charon.aeon.yml")), true);
  const workflow = fs.readFileSync(path.join(cwd, ".github", "workflows", "aeon.yml"), "utf8");
  assert.match(workflow, /Charon preflight/);
  assert.match(workflow, /charon aeon review export latest/);
  const log = run("git", ["log", "--oneline", "-1"], { cwd });
  assert.match(log.stdout, /Enable Charon for Aeon/);
});

test("Aeon setup skill fails clearly outside Aeon repos", () => {
  const cwd = tmpdir();
  const result = run("bash", [SCRIPT], {
    cwd,
    env: {
      CHARON_BIN: CHARON,
      CHARON_SETUP_NO_PUSH: "1",
    },
  });
  assert.equal(result.status, 2);
  const out = JSON.parse(result.stdout);
  assert.equal(out.status, "blocked");
  assert.match(out.message, /Aeon workflow not found/);
});
