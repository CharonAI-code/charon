// -nocheck
// @ts-nocheck
"use strict";

const fs = require("fs");
const path = require("path");
const normalizationCore = require("./command-normalization");

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

function defaultPolicy() {
  return {
    version: 1,
    mode: "balanced",
    default: "pass",
    protect: {
      secrets: true,
      destructiveCommands: true,
      remoteWrites: "review",
      packagePublish: "deny",
      unknownNetwork: "review",
    },
    bounds: {
      pass: [],
      pause: ["git push", "gh release create", "deploy production", "terraform apply", "kubectl apply"],
      deny: ["git push --force", "npm publish", "rm -rf", "read:.env", "read:~/.ssh/**"],
      secretAction: "deny",
      rules: [
        { id: "release.npm_publish", verdict: "DENY", command: "npm", argsIncludes: ["publish"] },
        { id: "release.git_push", verdict: "PAUSE", command: "git", argsIncludes: ["push"] },
      ],
    },
    controls: {
      files: {
        read: ["."],
        write: [".charon/**"],
        deny: [".env", ".env.*", "~/.ssh/**", "~/.aws/**", "~/.config/gh/**"],
        delete_deny: [],
      },
      network: {
        allow: ["github.com", "api.github.com"],
        deny: ["webhook.site", "requestbin.com", "requestcatcher.com", "interact.sh"],
      },
      commands: {
        deny: ["git push --force", "npm publish", "rm -rf"],
      },
      env: {
        expose: [],
        deny: ["GITHUB_TOKEN", "GH_TOKEN", "OPENAI_API_KEY", "AWS_SECRET_ACCESS_KEY"],
      },
      output: {
        secretAction: "deny",
        store: "redacted",
        maxBytes: 4000,
      },
    },
    inspection: {
      mode: "enforce",
    },
  };
}

function validatePolicy(policy, config = "charon.yml") {
  if (!policy || typeof policy !== "object") throw new Error(`${config} must be a YAML object`);
  if (policy.version !== 1) throw new Error(`${config} version must be 1`);
  if (!policy.bounds || typeof policy.bounds !== "object") {
    policy.bounds = {
      pass: [],
      pause: [],
      deny: policy.controls && policy.controls.commands ? policy.controls.commands.deny || [] : [],
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
  const controls = policy.controls;
  if (!controls || typeof controls !== "object") throw new Error(`${config} missing controls`);
  for (const key of ["files", "network", "commands", "env"]) {
    if (!controls[key] || typeof controls[key] !== "object") throw new Error(`${config} missing controls.${key}`);
  }
  if (!controls.output || typeof controls.output !== "object") {
    controls.output = { secretAction: "deny", store: "redacted", maxBytes: 4000 };
  }
  if (!["deny", "pause", "pass"].includes(controls.output.secretAction || "deny")) {
    throw new Error("controls.output.secretAction must be deny, pause, or pass");
  }
  if (!["none", "redacted"].includes(controls.output.store || "redacted")) {
    throw new Error("controls.output.store must be none or redacted");
  }
  for (const [section, keys] of Object.entries({
    files: ["read", "write", "deny", "delete_deny"],
    network: ["allow", "deny"],
    commands: ["deny"],
    env: ["expose", "deny"],
  })) {
    for (const key of keys) {
      if (section === "files" && key === "delete_deny" && controls[section][key] === undefined) {
        controls[section][key] = [];
      }
      const value = controls[section][key];
      if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) {
        throw new Error(`controls.${section}.${key} must be a string array`);
      }
    }
  }
  if (!policy.inspection || typeof policy.inspection !== "object") {
    policy.inspection = { mode: "enforce" };
  }
  if (!["enforce", "review", "observe"].includes(String(policy.inspection.mode || "enforce"))) {
    throw new Error("inspection.mode must be enforce, review, or observe");
  }
}

function normalizePolicyForHash(policy, config = "charon.yml") {
  validatePolicy(policy, config);
  return {
    version: 1,
    mode: policy.mode || "balanced",
    protect: policy.protect || {},
    bounds: policy.bounds,
    controls: policy.controls,
    inspection: policy.inspection,
  };
}

function decideAction(command, policy) {
  const action = normalizeAction(command);
  const trace = buildBoundaryTrace(command, policy, action);
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
  if (trace.network.status === "paused") {
    return { verdict: "PAUSE", reason: `network host needs review: ${trace.network.paused.join(", ")}`, trace };
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

function buildBoundaryTrace(command, policy, action = normalizeAction(command)) {
  const secrets = scanSecrets(action.searchText);
  const secretKinds = [...new Set(secrets.map((item) => item.kind))];
  const deniedFiles = detectDeniedFiles(action, policy);
  const network = detectNetworkHosts(action, policy);
  const ruleMatch = matchStructuredRule(command, policy, action);
  const deniedAction = [...policy.bounds.deny, ...policy.controls.commands.deny].find((item) => actionMatches(action, item));
  const pausedAction = policy.bounds.pause.find((item) => actionMatches(action, item));
  const secretAction = policy.bounds.secretAction || "deny";
  const trace = {
    schema: "charon.trace.v1",
    identity: {
      status: "unsigned",
      runtime: "local",
    },
    secrets: secrets.length
      ? { status: secretAction === "pause" ? "paused" : secretAction === "pass" ? "passed" : "denied", kinds: secretKinds, count: secrets.length }
      : { status: "clean", kinds: [], count: 0 },
    files: deniedFiles.length ? { status: "denied", matches: deniedFiles } : { status: "clean", matches: [] },
    network,
    action: ruleMatch
      ? { status: normalizeVerdictStatus(ruleMatch.verdict), match: ruleMatch.id, rule: ruleMatch, normalized: action.summary }
      : deniedAction
        ? { status: "denied", match: deniedAction, normalized: action.summary }
        : pausedAction
          ? { status: "paused", match: pausedAction, normalized: action.summary }
          : { status: "passed", match: "", normalized: action.summary },
    execution: {
      status: "pending",
    },
  };
  trace.explain = explainBoundaryTrace(trace, action);
  return trace;
}

function explainBoundaryTrace(trace, action) {
  const lines = [];
  const normalized = (action.commandStrings || []).filter(Boolean).map((text) => redactText(text).value);
  if (normalized.length) lines.push(`normalized commands: ${normalized.join(" | ")}`);
  if (action.shell && action.shell.segments && action.shell.segments.length > 1) {
    lines.push(`shell chain: ${action.shell.segments.map((segment) => redactText(segment.rendered).value).join(" -> ")}`);
  }
  if (action.script) {
    lines.push(`package script ${action.script.name}: ${redactText(action.script.rendered).value}`);
  }
  if (action.pathHints && action.pathHints.length) {
    lines.push(`path hints: ${action.pathHints.join(", ")}`);
  }
  if (action.networkHosts && action.networkHosts.length) {
    lines.push(`network hints: ${action.networkHosts.join(", ")}`);
  }
  if (trace.secrets.status !== "clean") {
    lines.push(`secret detector: ${trace.secrets.status} (${trace.secrets.kinds.join(", ")})`);
  }
  if (trace.files.status !== "clean") {
    lines.push(`file boundary: ${trace.files.matches.join(", ")}`);
  }
  if (trace.network.status === "denied") {
    lines.push(`network boundary: denied ${trace.network.denied.join(", ")}`);
  } else if (trace.network.status === "paused") {
    lines.push(`network boundary: review ${trace.network.paused.join(", ")}`);
  } else if (trace.network.status === "allowed") {
    lines.push(`network boundary: allowed ${trace.network.allowed.join(", ")}`);
  }
  if (trace.action.rule) {
    lines.push(`structured rule: ${trace.action.rule.id} -> ${trace.action.rule.verdict}`);
  } else if (trace.action.match) {
    lines.push(`command rule: ${trace.action.status} ${trace.action.match}`);
  }
  return lines;
}

function matchStructuredRule(command, policy, action = normalizeAction(command)) {
  const rules = Array.isArray(policy.bounds.rules) ? policy.bounds.rules : [];
  return rules.find((rule) => structuredRuleMatches(action, rule));
}

function structuredRuleMatches(action, rule) {
  if (!rule || typeof rule !== "object") return false;
  const commandCandidates = action.commandCandidates;
  if (rule.command) {
    const commands = Array.isArray(rule.command) ? rule.command : [rule.command];
    if (!commands.some((cmd) => commandCandidates.includes(String(cmd)))) return false;
  }
  if (rule.includes && !action.searchText.includes(rule.includes)) return false;
  if (Array.isArray(rule.argsIncludes) && !argsIncludeAll(action.argCandidates, rule.argsIncludes)) return false;
  if (rule.args && typeof rule.args === "object") {
    if (Array.isArray(rule.args.includes) && !argsIncludeAll(action.argCandidates, rule.args.includes)) return false;
    if (Array.isArray(rule.args.excludes) && argsIncludeAny(action.argCandidates, rule.args.excludes)) return false;
    if (Array.isArray(rule.args.exact) && !argsEqualAny(action.argCandidates, rule.args.exact)) return false;
    if (Array.isArray(rule.args.startsWith) && !argsStartWithAny(action.argCandidates, rule.args.startsWith)) return false;
  }
  if (rule.toolName && !action.searchText.includes(rule.toolName)) return false;
  return true;
}

function argsIncludeAll(argSets, parts) {
  return parts.every((part) => argSets.some((args) => args.some((arg) => String(arg).includes(String(part)))));
}

function argsIncludeAny(argSets, parts) {
  return parts.some((part) => argSets.some((args) => args.some((arg) => String(arg).includes(String(part)))));
}

function argsEqualAny(argSets, expected) {
  return argSets.some((args) => stableJson(args.map(String)) === stableJson(expected.map(String)));
}

function argsStartWithAny(argSets, expected) {
  return argSets.some((args) => expected.every((part, index) => String(args[index] || "") === String(part)));
}

function normalizeVerdictStatus(verdict) {
  const value = String(verdict || "").toUpperCase();
  if (value === "DENY") return "denied";
  if (value === "PAUSE") return "paused";
  return "passed";
}

function completeTrace(trace, executionStatus, extra = {}) {
  return {
    ...trace,
    execution: {
      ...(trace && trace.execution ? trace.execution : {}),
      status: executionStatus,
      ...extra,
    },
  };
}

function detectDeniedFiles(action, policy) {
  const reads = policy.controls.files.deny.filter((item) => actionReferencesPath(action, item));
  const deletes = detectDeniedDeletes(action, policy).map((item) => `delete:${item}`);
  return [...new Set([...reads, ...deletes])];
}

function detectDeniedDeletes(action, policy) {
  const protectedPaths = policy.controls.files.delete_deny || [];
  if (!protectedPaths.length) return [];
  const targets = inferDeleteTargets(action);
  if (!targets.length) return [];
  return protectedPaths.filter((item) => {
    return targets.some((target) => {
      if (target === "." || target === "./" || target === process.cwd()) return true;
      return actionReferencesPath({ ...action, commandStrings: [target], argCandidates: [[target]], pathHints: [target], searchText: target }, item);
    });
  });
}

function inferDeleteTargets(action) {
  const targets = [];
  for (const segment of action.segments || []) {
    const exe = path.basename(String(segment.executable || ""));
    const args = (segment.args || []).map(String);
    if (exe === "rm" || exe === "unlink" || exe === "rmdir" || exe === "trash") {
      for (const arg of args) {
        if (!arg || arg.startsWith("-")) continue;
        targets.push(arg);
      }
      continue;
    }
    if (exe === "find" && args.includes("-delete")) {
      const roots = [];
      for (const arg of args) {
        if (!arg || arg.startsWith("-")) break;
        roots.push(arg);
      }
      targets.push(...(roots.length ? roots : ["."]));
    }
    if (["node", "python", "python3"].includes(exe)) {
      const text = [segment.rendered, ...args].join(" ");
      if (/\b(?:fs\.)?(?:rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\s*\(/.test(text) || /\b(?:os\.remove|shutil\.rmtree)\s*\(/.test(text)) {
        for (const match of text.matchAll(/["']([^"']+)["']/g)) targets.push(match[1]);
      }
    }
  }
  return [...new Set(targets)];
}

function detectNetworkHosts(action, policy) {
  const hosts = [...new Set([...(normalizationCore.extractHosts(action.searchText) || []), ...(action.networkHosts || [])])].sort();
  if (!hosts.length) return { status: "not_requested", hosts: [], denied: [], allowed: [] };
  const denylist = policy.controls.network.deny || [];
  const allowed = hosts.filter((host) => hostAllowed(host, policy.controls.network.allow));
  const denied = hosts.filter((host) => hostAllowed(host, denylist));
  const unknown = hosts.filter((host) => !allowed.includes(host) && !denied.includes(host));
  if (denied.length) return { status: "denied", hosts, denied, paused: unknown, allowed };
  if (unknown.length) {
    const unknownNetwork = String((policy.protect && policy.protect.unknownNetwork) || "review").toLowerCase();
    if (unknownNetwork === "deny") return { status: "denied", hosts, denied: unknown, paused: [], allowed };
    if (unknownNetwork === "pass" || unknownNetwork === "allow") return { status: "allowed", hosts, denied: [], paused: [], allowed: hosts };
    return { status: "paused", hosts, denied: [], paused: unknown, allowed };
  }
  return { status: "allowed", hosts, denied: [], paused: [], allowed };
}

function hostAllowed(host, allowlist) {
  return (allowlist || []).some((allowed) => {
    const value = String(allowed || "");
    if (value.startsWith("*.")) return host.endsWith(value.slice(1));
    return host === value || host.endsWith(`.${value}`);
  });
}

function actionMatches(action, pattern) {
  const value = String(pattern || "");
  if (value.startsWith("read:")) return actionReferencesPath(action, value.slice("read:".length));
  return action.searchText.includes(value) || action.commandStrings.some((text) => text.includes(value));
}

function normalizeAction(command) {
  return createNormalizer().normalizeAction(command);
}

function actionReferencesPath(action, pattern) {
  return createNormalizer().actionReferencesPath(action, pattern);
}

function createNormalizer() {
  return normalizationCore.createActionNormalizer({
    cwd: process.cwd(),
    readJson,
    redactText,
    expandPath,
  });
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function stableJson(value) {
  return JSON.stringify(value, (_, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.keys(item).sort().reduce((acc, key) => ((acc[key] = item[key]), acc), {});
    }
    return item;
  });
}

function expandPath(value) {
  const text = String(value || "");
  if (text === "~") return require("os").homedir();
  if (text.startsWith("~/")) return path.join(require("os").homedir(), text.slice(2));
  return text;
}

module.exports = {
  SECRET_PATTERNS,
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
  scanSecrets,
};
