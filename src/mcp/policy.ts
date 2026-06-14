import { existsSync, readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { RuntimePolicy } from "../core/policy";

export function loadMcpPolicy(file = "charon.yml"): RuntimePolicy {
  if (!existsSync(file)) {
    return {
      defaultVerdict: "PASS",
      inspection: { mode: "enforce" },
      rules: [{ id: "secret.default", verdict: "DENY", role: "secret" }],
    };
  }
  const raw = yaml.load(readFileSync(file, "utf8")) as any;
  const rules: NonNullable<RuntimePolicy["rules"]> = [{ id: "secret.default", verdict: "DENY", role: "secret" }];

  for (const rule of raw?.bounds?.rules || []) {
    if (!rule || typeof rule !== "object") continue;
    if (rule.role) {
      rules.push({
        id: String(rule.id || `rule.${rules.length}`),
        verdict: String(rule.verdict || "PAUSE").toUpperCase() as any,
        role: rule.role,
        equals: rule.equals,
        includes: rule.includes,
        prefix: rule.prefix,
      });
      continue;
    }
    if (rule.toolName) {
      rules.push({
        id: String(rule.id || `tool.${rules.length}`),
        verdict: String(rule.verdict || "PAUSE").toUpperCase() as any,
        role: "mcp-tool",
        includes: String(rule.toolName),
      });
    }
  }

  for (const item of raw?.bounds?.deny || []) {
    pushLegacyBoundRules(rules, "DENY", String(item), `deny.${rules.length}`);
  }
  for (const item of raw?.bounds?.pause || []) {
    pushLegacyBoundRules(rules, "PAUSE", String(item), `pause.${rules.length}`);
  }
  for (const item of raw?.bounds?.pass || []) {
    pushLegacyBoundRules(rules, "PASS", String(item), `pass.${rules.length}`);
  }

  for (const item of raw?.controls?.files?.deny || []) {
    rules.push({ id: `controls.files.deny.${rules.length}`, verdict: "DENY", role: "read-path", includes: String(item).replace(/\/\*\*$/g, "") });
    rules.push({ id: `controls.files.write_deny.${rules.length}`, verdict: "DENY", role: "write-path", includes: String(item).replace(/\/\*\*$/g, "") });
  }
  for (const item of raw?.controls?.files?.read || []) {
    rules.push({ id: `controls.files.read.${rules.length}`, verdict: "PASS", role: "read-path", includes: String(item).replace(/\/\*\*$/g, "") });
  }
  for (const item of raw?.controls?.files?.write || []) {
    rules.push({ id: `controls.files.write.${rules.length}`, verdict: "PASS", role: "write-path", includes: String(item).replace(/\/\*\*$/g, "") });
  }
  for (const item of raw?.controls?.network?.allow || []) {
    rules.push({ id: `controls.network.allow.${rules.length}`, verdict: "PASS", role: "fetch-url", includes: String(item) });
  }
  for (const item of raw?.controls?.commands?.deny || []) {
    rules.push({ id: `controls.commands.deny.${rules.length}`, verdict: "DENY", role: "shell-command", includes: String(item) });
  }

  return {
    defaultVerdict: policyDefaultVerdict(raw),
    inspection: {
      mode: policyInspectionMode(raw),
    },
    rules,
  };
}

function policyDefaultVerdict(policy: any): "PASS" | "PAUSE" | "DENY" {
  const value = String(policy?.default || policy?.defaultVerdict || policy?.bounds?.default || "PASS").toUpperCase();
  return value === "PAUSE" || value === "DENY" ? value : "PASS";
}

function policyInspectionMode(policy: any): "enforce" | "review" | "observe" {
  const value = String(policy?.inspection?.mode || "enforce").toLowerCase();
  return value === "review" || value === "observe" ? value : "enforce";
}

function pushLegacyBoundRules(
  rules: NonNullable<RuntimePolicy["rules"]>,
  verdict: "PASS" | "PAUSE" | "DENY",
  value: string,
  id: string,
): void {
  if (value.startsWith("read:")) {
    rules.push({ id, verdict, role: "read-path", includes: value.slice("read:".length).replace(/\/\*\*$/g, "") });
    return;
  }
  if (/^https?:\/\//i.test(value)) {
    rules.push({ id, verdict, role: "fetch-url", includes: value });
    return;
  }
  rules.push({ id: `${id}.tool`, verdict, role: "mcp-tool", includes: value });
  rules.push({ id: `${id}.shell`, verdict, role: "shell-command", includes: value });
}
