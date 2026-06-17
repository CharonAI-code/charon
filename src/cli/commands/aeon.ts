// @ts-nocheck
"use strict";

const fs = require("fs");
const path = require("path");
const {
  applyTelegramDecision,
  buildTelegramPayload,
  decideAeonReview,
  exportAeonReview,
  installAeonEnforcement,
  listAeonReviews,
  loadAeonReview,
  readAeonEnforcementReport,
  runAeonSmoke,
  runAeonPreflight,
} = require("../../aeon");

function aeonCommand(args) {
  const [sub = "map", ...rest] = args;
  if (sub === "map" || sub === "status") return aeonMapCommand(rest);
  if (sub === "preflight") return aeonPreflightCommand(rest);
  if (sub === "review" || sub === "reviews") return aeonReviewCommand(rest);
  if (sub === "telegram") return aeonTelegramCommand(rest);
  if (sub === "smoke") return aeonSmokeCommand(rest);
  throw new Error("usage: charon aeon map [--json] [--cwd <path>] | charon aeon smoke [--json] | charon aeon preflight --skill <name> | charon aeon review list|inspect|export|approve|reject | charon aeon telegram payload|decide");
}

function aeonEnforceCommand(args = [], opts = {}) {
  const [sub = "install", ...rest] = args;
  if (sub && sub.startsWith("-")) return aeonEnforceCommand(["install", ...args], opts);
  if (sub === "status") return aeonEnforceStatusCommand(rest, opts);
  if (sub === "restore") throw new Error("charon enforce aeon restore is not implemented yet");
  if (sub !== "install" && sub !== "aeon") throw new Error("usage: charon enforce aeon | charon enforce aeon status");
  const cwd = flagValue(rest, "--cwd") || process.cwd();
  const result = installAeonEnforcement({ cwd });
  if (opts.quiet) return result;
  console.log("Charon preflight enabled for Aeon.");
  console.log(`Workflow: ${result.workflowPath}`);
  console.log(`Policy: ${result.policyPath}`);
  console.log(result.changed ? "Patched Aeon workflow." : "Aeon workflow already patched.");
  aeonEnforceStatusCommand(["--cwd", cwd], opts);
  return result;
}

function aeonEnforceStatusCommand(args = [], opts = {}) {
  const cwd = flagValue(args, "--cwd") || process.cwd();
  const report = readAeonEnforcementReport({ cwd });
  if (opts.quiet) return report;
  console.log("Charon Aeon enforcement");
  console.log(`${report.workflowExists ? "OK " : "NO "} Aeon workflow exists`);
  console.log(`${report.policyExists ? "OK " : "NO "} Aeon policy exists`);
  console.log(`${report.policyValid ? "OK " : "NO "} Aeon policy valid${report.policyError ? ` - ${report.policyError}` : ""}`);
  console.log(`${report.preflightInstalled ? "OK " : "NO "} Charon preflight installed`);
  console.log(`${report.preflightCommandValid ? "OK " : "NO "} Charon preflight command valid`);
  console.log(`${report.pauseReviewEnabled ? "OK " : "NO "} pause review queue enabled`);
  console.log(`${report.reviewExportEnabled ? "OK " : "NO "} review export enabled`);
  console.log(`${report.preflightBeforeClaude ? "OK " : "NO "} preflight runs before Claude`);
  console.log(report.enforced ? "AEON ENFORCED" : "AEON NOT ENFORCED");
  return report;
}

function aeonPreflightCommand(args) {
  const input = {
    cwd: flagValue(args, "--cwd") || process.cwd(),
    skill: flagValue(args, "--skill") || process.env.SKILL || process.env.SKILL_NAME || "",
    var: flagValue(args, "--var") || process.env.SKILL_VAR || "",
    trigger: flagValue(args, "--trigger") || process.env.AEON_TRIGGER || process.env.GITHUB_EVENT_NAME || "unknown",
    repo: flagValue(args, "--repo") || process.env.GITHUB_REPOSITORY || "",
    runId: flagValue(args, "--run-id") || process.env.GITHUB_RUN_ID || "",
    actor: flagValue(args, "--actor") || process.env.GITHUB_ACTOR || "",
    policy: flagValue(args, "--policy"),
    review: !args.includes("--no-review"),
  };
  if (!input.skill) throw new Error("usage: charon aeon preflight --skill <name> [--var <value>] [--trigger <source>]");
  const result = runAeonPreflight(input);
  console.log(JSON.stringify({
    verdict: result.verdict,
    reason: result.reason,
    ruleId: result.ruleId,
    launched: false,
    receiptPath: result.receiptPath,
    reviewId: result.review ? result.review.id : undefined,
    reviewPath: result.review ? result.review.reviewPath : undefined,
    telegramPath: result.review ? result.review.telegramPath : undefined,
  }, null, 2));
  if (result.verdict === "DENY") process.exitCode = 126;
  if (result.verdict === "PAUSE") process.exitCode = 125;
  return result;
}

function aeonReviewCommand(args) {
  const [sub = "list", ...rest] = args;
  const cwd = flagValue(rest, "--cwd") || process.cwd();
  if (sub === "list") {
    const reviews = listAeonReviews({ cwd });
    if (!reviews.length) {
      console.log("No Aeon reviews.");
      return reviews;
    }
    for (const review of reviews) {
      const item = review.item;
      console.log(`${item.id}  ${item.status}  ${item.source.skill || "unknown"}  ${item.decision.reason || ""}`);
    }
    return reviews;
  }
  if (sub === "inspect") {
    const id = rest.find((arg) => !arg.startsWith("--"));
    if (!id) throw new Error("usage: charon aeon review inspect <id>");
    const review = loadAeonReview({ cwd, id });
    console.log(JSON.stringify(review.item, null, 2));
    return review;
  }
  if (sub === "export") {
    const id = rest.find((arg) => !arg.startsWith("--")) || "latest";
    const result = exportAeonReview({
      cwd,
      id,
      githubOutput: flagValue(rest, "--github-output"),
    });
    if (args.includes("--json")) {
      console.log(JSON.stringify(result.payload, null, 2));
    } else {
      console.log(`Review JSON: ${result.jsonPath}`);
      console.log(`Review summary: ${result.summaryPath}`);
    }
    return result;
  }
  if (sub === "approve" || sub === "reject") {
    const id = rest.find((arg) => !arg.startsWith("--"));
    if (!id) throw new Error(`usage: charon aeon review ${sub} <id>`);
    const result = decideAeonReview({
      cwd,
      id,
      decision: sub === "approve" ? "approve" : "reject",
      actor: flagValue(rest, "--actor"),
      reason: flagValue(rest, "--reason"),
    });
    console.log(`${sub === "approve" ? "Approved" : "Rejected"} Aeon review ${id}`);
    console.log(`Review: ${result.reviewPath}`);
    return result;
  }
  throw new Error("usage: charon aeon review list|inspect <id>|export <id|latest>|approve <id>|reject <id>");
}

function aeonTelegramCommand(args) {
  const [sub = "payload", ...rest] = args;
  const cwd = flagValue(rest, "--cwd") || process.cwd();
  if (sub === "payload") {
    const id = rest.find((arg) => !arg.startsWith("--")) || "latest";
    const result = buildTelegramPayload({
      cwd,
      id,
      chatId: flagValue(rest, "--chat-id"),
    });
    console.log(JSON.stringify(result.message, null, 2));
    return result;
  }
  if (sub === "decide") {
    const result = applyTelegramDecision({
      cwd,
      text: flagValue(rest, "--text"),
      callback: flagValue(rest, "--callback"),
      actor: flagValue(rest, "--actor"),
      reason: flagValue(rest, "--reason"),
    });
    console.log(JSON.stringify({
      decision: result.decision,
      reviewId: result.reviewId,
      applied: result.applied,
      status: result.item ? result.item.status : undefined,
      reviewPath: result.reviewPath,
    }, null, 2));
    return result;
  }
  throw new Error("usage: charon aeon telegram payload <id|latest> [--chat-id <id>] | charon aeon telegram decide --text <text>|--callback <data>");
}

function aeonSmokeCommand(args) {
  const result = runAeonSmoke({
    cwd: flagValue(args, "--cwd") || process.cwd(),
    passSkill: flagValue(args, "--pass-skill"),
    pauseSkill: flagValue(args, "--pause-skill"),
    repo: flagValue(args, "--repo"),
    actor: flagValue(args, "--actor"),
    chatId: flagValue(args, "--chat-id"),
  });
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("Charon Aeon smoke");
    for (const item of result.checks) {
      console.log(`${item.ok ? "OK " : "NO "} ${item.id}`);
    }
    console.log(result.ok ? "AEON MVP SMOKE PASS" : "AEON MVP SMOKE FAIL");
  }
  if (!result.ok) process.exitCode = 1;
  return result;
}

function aeonMapCommand(args) {
  const json = args.includes("--json");
  const cwd = flagValue(args, "--cwd") || process.cwd();
  const map = inspectAeonRuntime(path.resolve(cwd));
  if (json) {
    console.log(JSON.stringify(map, null, 2));
    return map;
  }
  printAeonMap(map);
  return map;
}

function inspectAeonRuntime(root) {
  const files = {
    config: path.join(root, "aeon.yml"),
    aeonWorkflow: path.join(root, ".github", "workflows", "aeon.yml"),
    messagesWorkflow: path.join(root, ".github", "workflows", "messages.yml"),
    chainWorkflow: path.join(root, ".github", "workflows", "chain-runner.yml"),
  };

  const aeonWorkflow = read(files.aeonWorkflow);
  const messagesWorkflow = read(files.messagesWorkflow);
  const chainWorkflow = read(files.chainWorkflow);
  const config = read(files.config);

  const allowedTools = extractAllowedTools(aeonWorkflow);
  const claudeLaunches = linesMatching(aeonWorkflow, /\bclaude\s+-p\b|--allowedTools\b/);
  const preflight = linesMatching(aeonWorkflow, /preflight|FLEET_ENDPOINT|api\/aeon\/preflight/i);
  const postflight = linesMatching(aeonWorkflow, /postflight|api\/aeon\/postflight/i);
  const mcp = linesMatching(aeonWorkflow, /\.mcp\.json|MCP_FLAGS|--mcp-config/i);
  const artifacts = linesMatching(aeonWorkflow, /upload-artifact|GITHUB_STEP_SUMMARY|\.outputs|artifact/i);
  const telegram = linesMatching(messagesWorkflow, /telegram|TELEGRAM_BOT_TOKEN|repository_dispatch/i);
  const schedulers = linesMatching(messagesWorkflow, /schedule:|cron|gh workflow run aeon\.yml|repository_dispatch/i);
  const chains = linesMatching(chainWorkflow, /gh workflow run aeon\.yml|workflow_call|chain/i);
  const skills = extractSkillNames(config);

  const nativeTools = allowedTools.filter((tool) => !tool.startsWith("mcp__charon__"));
  const hasNativeSideEffects = nativeTools.some((tool) => {
    return tool === "Write" ||
      tool === "Edit" ||
      tool === "WebFetch" ||
      tool === "WebSearch" ||
      tool.startsWith("Bash(") ||
      tool === "Bash";
  });

  return {
    schema: "charon.aeonRuntimeMap.v1",
    root,
    detected: {
      aeonConfig: fs.existsSync(files.config),
      aeonWorkflow: fs.existsSync(files.aeonWorkflow),
      messagesWorkflow: fs.existsSync(files.messagesWorkflow),
      chainWorkflow: fs.existsSync(files.chainWorkflow),
      telegram: telegram.length > 0,
      scheduler: schedulers.length > 0,
      chainRunner: chains.length > 0,
      claudeCode: claudeLaunches.length > 0,
      mcpSupport: mcp.length > 0,
      fleetWatcherShape: preflight.length > 0 || postflight.length > 0,
    },
    launch: {
      workflow: rel(root, files.aeonWorkflow),
      claudeLines: claudeLaunches,
      allowedTools,
      nativeTools,
      charonTools: allowedTools.filter((tool) => tool.startsWith("mcp__charon__")),
    },
    triggers: {
      telegramLines: telegram,
      schedulerLines: schedulers,
      chainLines: chains,
      skills: skills.slice(0, 20),
      skillCount: skills.length,
    },
    existingHookShape: {
      preflightLines: preflight,
      postflightLines: postflight,
      mcpLines: mcp,
      artifactLines: artifacts,
    },
    requiredHookPoints: [
      {
        id: "workflow.install",
        file: rel(root, files.aeonWorkflow),
        placement: "after Node setup, before Claude launch",
        purpose: "install Charon and create charon.yml in the Actions runner",
      },
      {
        id: "claude.tools",
        file: rel(root, files.aeonWorkflow),
        placement: "the --allowedTools value used by claude -p",
        purpose: "replace native shell/file/network tools with Charon MCP tools",
      },
      {
        id: "receipt.export",
        file: rel(root, files.aeonWorkflow),
        placement: "always-run step after Claude/postprocess",
        purpose: "upload .charon/receipts and write GitHub step summary",
      },
      {
        id: "telegram.verdict",
        file: rel(root, files.messagesWorkflow),
        placement: "AEON notification path",
        purpose: "send short PASS/PAUSE/DENY summaries back to Telegram",
      },
    ],
    verdict: {
      readyForCharonPatch: fs.existsSync(files.aeonWorkflow) && claudeLaunches.length > 0,
      nativeToolsBypassCharon: hasNativeSideEffects,
      summary: hasNativeSideEffects
        ? "AEON currently grants Claude native side-effect tools. Charon must replace those with Charon MCP tools."
        : "AEON Claude tool path is already compatible with Charon-style MCP enforcement.",
    },
  };
}

function printAeonMap(map) {
  console.log("Charon AEON runtime map");
  console.log("");
  console.log(`${map.detected.aeonWorkflow ? "OK " : "NO "} AEON skill workflow`);
  console.log(`${map.detected.messagesWorkflow ? "OK " : "NO "} Telegram/scheduler workflow`);
  console.log(`${map.detected.claudeCode ? "OK " : "NO "} Claude Code launch`);
  console.log(`${map.detected.mcpSupport ? "OK " : "WARN"} MCP support path`);
  console.log(`${map.detected.fleetWatcherShape ? "OK " : "WARN"} preflight/postflight hook shape`);
  console.log("");
  console.log(`Skills detected: ${map.triggers.skillCount}`);
  console.log(`Allowed tools: ${map.launch.allowedTools.length ? map.launch.allowedTools.join(", ") : "not found"}`);
  console.log("");
  console.log(map.verdict.nativeToolsBypassCharon ? "WARN native tools bypass Charon" : "OK tool path can be Charon-controlled");
  console.log(map.verdict.summary);
  console.log("");
  console.log("Hook points:");
  for (const hook of map.requiredHookPoints) {
    console.log(`- ${hook.id}: ${hook.file} (${hook.placement})`);
  }
}

function extractAllowedTools(text) {
  const tools = new Set();
  for (const line of text.split(/\n/)) {
    const allowedMatch = line.match(/ALLOWED(?:=|\+?=)"([^"]*)"/);
    if (allowedMatch) {
      for (const tool of allowedMatch[1].split(",").map((item) => item.trim()).filter(Boolean)) {
        tools.add(tool);
      }
    }
    const cliMatch = line.match(/--allowedTools\s+"?\$?([A-Z_]+)?/);
    if (cliMatch && cliMatch[1] === "ALLOWED") continue;
  }
  return [...tools];
}

function extractSkillNames(config) {
  const names = [];
  let inSkills = false;
  for (const line of config.split(/\n/)) {
    if (/^skills:\s*$/.test(line)) {
      inSkills = true;
      continue;
    }
    if (inSkills && /^[a-zA-Z_][\w-]*:\s*$/.test(line)) break;
    const match = inSkills && line.match(/^  ([a-zA-Z0-9_-]+):/);
    if (match) names.push(match[1]);
  }
  return names;
}

function linesMatching(text, pattern) {
  return text
    .split(/\n/)
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((entry) => pattern.test(entry.text))
    .map((entry) => `${entry.line}: ${entry.text}`);
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function rel(root, file) {
  return path.relative(root, file) || ".";
}

module.exports = { aeonCommand, aeonEnforceCommand, inspectAeonRuntime };
