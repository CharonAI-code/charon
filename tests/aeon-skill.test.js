"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SETUP_SKILL_ROOT = path.join(ROOT, "skills", "aeon", "charon-setup");
const POLICY_SKILL_ROOT = path.join(ROOT, "skills", "aeon", "charon-policy");
const SETUP_SCRIPT = path.join(SETUP_SKILL_ROOT, "scripts", "setup_charon_aeon.sh");
const POLICY_SCRIPT = path.join(POLICY_SKILL_ROOT, "scripts", "verify_policy.js");
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

function writeSkill(cwd, name, body = "Read only skill.") {
  fs.mkdirSync(path.join(cwd, "skills", name), { recursive: true });
  fs.writeFileSync(path.join(cwd, "skills", name, "SKILL.md"), [
    "---",
    `name: ${name}`,
    "---",
    body,
    "",
  ].join("\n"));
}

function aeonRepo() {
  const cwd = tmpdir();
  fs.mkdirSync(path.join(cwd, ".github", "workflows"), { recursive: true });
  for (const skill of ["digest", "repo-actions", "pr-review", "issue-triage", "workflow-audit"]) {
    writeSkill(cwd, skill, `${skill} skill.`);
  }
  fs.writeFileSync(path.join(cwd, "aeon.yml"), [
    "skills:",
    '  digest: { enabled: true, schedule: "0 7 * * *" }',
    '  repo-actions: { enabled: true, schedule: "workflow_dispatch", var: "" }',
    '  pr-review: { enabled: true, schedule: "workflow_dispatch", var: "" }',
    '  issue-triage: { enabled: true, schedule: "workflow_dispatch", var: "" }',
    '  workflow-audit: { enabled: true, schedule: "workflow_dispatch", var: "" }',
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
    "        run: echo name=repo-actions >> $GITHUB_OUTPUT",
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

test("Aeon Charon skills are agent-readable", () => {
  assert.ok(fs.existsSync(path.join(SETUP_SKILL_ROOT, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(POLICY_SKILL_ROOT, "SKILL.md")));
  assert.ok(fs.existsSync(SETUP_SCRIPT));
  assert.ok(fs.existsSync(POLICY_SCRIPT));

  const setup = fs.readFileSync(path.join(SETUP_SKILL_ROOT, "SKILL.md"), "utf8");
  const policy = fs.readFileSync(path.join(POLICY_SKILL_ROOT, "SKILL.md"), "utf8");

  assert.match(setup, /^---\nname: charon-setup/m);
  assert.match(setup, /category: security/);
  assert.match(setup, /var: ""/);
  assert.match(setup, /commits: true/);
  assert.match(setup, /workflows:write/);
  assert.match(setup, /Never ask the operator to run a command/);
  assert.match(setup, /setup_charon_aeon\.sh/);

  assert.match(policy, /^---\nname: charon-policy/m);
  assert.match(policy, /category: security/);
  assert.match(policy, /charon\.aeon\.yml/);
  assert.match(policy, /verify_policy\.js/);
  assert.match(policy, /Weakening changes require/);
});

test("Aeon setup skill installs Charon and commits setup files", () => {
  const cwd = aeonRepo();
  const result = run("bash", [SETUP_SCRIPT], {
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

  const policy = fs.readFileSync(path.join(cwd, "charon.aeon.yml"), "utf8");
  assert.match(policy, /aeon\.repo_wipe\.deny/);
  assert.match(policy, /aeon\.repo_actions\.pause/);

  const log = run("git", ["log", "--oneline", "-1"], { cwd });
  assert.match(log.stdout, /Enable Charon for AEON/);
});

test("Aeon policy skill verifies Charon policy probes", () => {
  const cwd = aeonRepo();
  const setup = run("bash", [SETUP_SCRIPT], {
    cwd,
    env: {
      CHARON_BIN: CHARON,
      CHARON_SETUP_NO_PUSH: "1",
    },
  });
  assert.equal(setup.status, 0, setup.stderr);

  const result = run("node", [POLICY_SCRIPT], {
    cwd,
    env: {
      CHARON_BIN: CHARON,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.schema, "charon.aeonPolicyVerify.v1");
  assert.equal(out.status, "ok");
  assert.ok(out.checks.find((check) => check.id === "pass-readonly" && check.ok));
  assert.ok(out.checks.find((check) => check.id === "pause-write-skill" && check.ok));
  assert.ok(out.checks.find((check) => check.id === "deny-repo-wipe" && check.ok));
  assert.ok(out.checks.find((check) => check.id === "deny-secret-exfil" && check.ok));
});

test("Aeon setup skill fails clearly outside Aeon repos", () => {
  const cwd = tmpdir();
  const result = run("bash", [SETUP_SCRIPT], {
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

test("Aeon policy skill fails clearly without Charon policy", () => {
  const cwd = aeonRepo();
  const result = run("node", [POLICY_SCRIPT], {
    cwd,
    env: {
      CHARON_BIN: CHARON,
    },
  });
  assert.equal(result.status, 2);
  const out = JSON.parse(result.stdout);
  assert.equal(out.status, "blocked");
  assert.match(out.message, /charon\.aeon\.yml not found/);
});
