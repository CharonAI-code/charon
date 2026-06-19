// @ts-nocheck
"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { CONFIG, PREFLIGHT_START, PREFLIGHT_END } = require("./constants");
const { defaultAeonPolicy } = require("./policy");

function installAeonEnforcement(input = {}) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const workflowPath = path.join(cwd, ".github", "workflows", "aeon.yml");
  if (!fs.existsSync(workflowPath)) throw new Error("Aeon workflow not found: .github/workflows/aeon.yml");
  const before = fs.readFileSync(workflowPath, "utf8");
  const after = insertPreflightBlock(before);
  if (after !== before) fs.writeFileSync(workflowPath, after);
  const policyPath = path.join(cwd, CONFIG);
  if (!fs.existsSync(policyPath)) fs.writeFileSync(policyPath, `${yaml.dump(defaultAeonPolicy(), { lineWidth: 100 })}`);
  return {
    workflowPath,
    policyPath,
    changed: after !== before,
  };
}

function readAeonEnforcementReport(input = {}) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const workflowPath = path.join(cwd, ".github", "workflows", "aeon.yml");
  const policyPath = path.join(cwd, CONFIG);
  const workflow = fs.existsSync(workflowPath) ? fs.readFileSync(workflowPath, "utf8") : "";
  const preflightInstalled = workflow.includes(PREFLIGHT_START) && workflow.includes(PREFLIGHT_END);
  const preflightCommandValid = /charon\s+aeon\s+preflight/.test(workflow) && /--policy\s+charon\.aeon\.yml/.test(workflow);
  const pauseReviewEnabled = /--review/.test(workflow);
  const reviewExportEnabled = /charon\s+aeon\s+review\s+export\s+latest/.test(workflow) && /GITHUB_STEP_SUMMARY/.test(workflow);
  const beforeClaude = workflow.indexOf(PREFLIGHT_START) >= 0 && workflow.indexOf("claude -p") >= 0
    ? workflow.indexOf(PREFLIGHT_START) < workflow.indexOf("claude -p")
    : false;
  const policyExists = fs.existsSync(policyPath);
  let policyValid = false;
  let policyError = "";
  if (policyExists) {
    try {
      const loaded = yaml.load(fs.readFileSync(policyPath, "utf8"));
      policyValid = Boolean(loaded && typeof loaded === "object" && loaded.version === 1);
    } catch (error) {
      policyError = error.message;
    }
  }
  return {
    workflowExists: fs.existsSync(workflowPath),
    policyExists,
    policyValid,
    policyError,
    preflightInstalled,
    preflightCommandValid,
    pauseReviewEnabled,
    reviewExportEnabled,
    preflightBeforeClaude: beforeClaude,
    enforced: fs.existsSync(workflowPath) && policyExists && policyValid && preflightInstalled && preflightCommandValid && pauseReviewEnabled && reviewExportEnabled && beforeClaude,
    workflowPath,
    policyPath,
  };
}

function insertPreflightBlock(workflow) {
  const cleaned = removeBlock(workflow, PREFLIGHT_START, PREFLIGHT_END);
  const target = "\n      - name: Run pre-fetch scripts\n";
  const index = cleaned.indexOf(target);
  if (index < 0) throw new Error("Could not find Aeon pre-fetch step insertion point");
  return `${cleaned.slice(0, index)}\n${preflightBlock()}${cleaned.slice(index)}`;
}

function removeBlock(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) return text;
  const end = text.indexOf(endMarker, start);
  if (end < 0) return text;
  const after = text.indexOf("\n", end);
  return `${text.slice(0, start).replace(/\n+$/, "\n")}${text.slice(after >= 0 ? after + 1 : text.length)}`;
}

function preflightBlock() {
  return [
    `      ${PREFLIGHT_START}`,
    "      - name: Charon preflight",
    "        id: charon_preflight",
    "        if: steps.work.outputs.mode != ''",
    "        env:",
    "          SKILL: ${{ steps.skill.outputs.name }}",
    "          SKILL_VAR: ${{ inputs.var }}",
    "          AEON_ACTOR: ${{ github.actor }}",
    "          AEON_TRIGGER: ${{ github.event_name == 'repository_dispatch' && github.event.action || github.event_name }}",
    "        run: |",
    "          set +e",
    "          mkdir -p .charon/aeon",
    "          npx -y github:CharonAI-code/charon aeon preflight \\",
    "            --skill \"$SKILL\" \\",
    "            --var \"$SKILL_VAR\" \\",
    "            --trigger \"$AEON_TRIGGER\" \\",
    "            --repo \"$GITHUB_REPOSITORY\" \\",
    "            --run-id \"$GITHUB_RUN_ID\" \\",
    "            --actor \"$AEON_ACTOR\" \\",
    "            --policy charon.aeon.yml \\",
    "            --review > .charon/aeon/preflight.json",
    "          code=$?",
    "          cat .charon/aeon/preflight.json",
    "          if [ \"$code\" = \"125\" ]; then",
    "            npx -y github:CharonAI-code/charon aeon telegram send latest || true",
    "          elif [ \"$code\" = \"126\" ]; then",
    "            npx -y github:CharonAI-code/charon aeon telegram send --preflight .charon/aeon/preflight.json || true",
    "          fi",
    "          exit \"$code\"",
    "      - name: Charon review export",
    "        if: always()",
    "        id: charon_review",
    "        run: |",
    "          npx -y github:CharonAI-code/charon aeon review export latest --github-output \"$GITHUB_OUTPUT\" || true",
    "          for file in .charon/aeon/exports/*.md; do",
    "            if [ -f \"$file\" ]; then cat \"$file\" >> \"$GITHUB_STEP_SUMMARY\"; fi",
    "          done",
    `      ${PREFLIGHT_END}`,
    "",
  ].join("\n");
}

module.exports = {
  installAeonEnforcement,
  readAeonEnforcementReport,
};
