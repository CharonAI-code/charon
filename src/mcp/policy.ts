import { existsSync, readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { RuntimePolicy } from "../core/policy";

export function loadMcpPolicy(file = "charon.yml"): RuntimePolicy {
  if (!existsSync(file)) {
    return {
      defaultVerdict: "PAUSE",
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
    rules.push({ id: `deny.${rules.length}`, verdict: "DENY", role: "mcp-tool", includes: String(item) });
  }
  for (const item of raw?.bounds?.pause || []) {
    rules.push({ id: `pause.${rules.length}`, verdict: "PAUSE", role: "mcp-tool", includes: String(item) });
  }
  for (const item of raw?.bounds?.pass || []) {
    rules.push({ id: `pass.${rules.length}`, verdict: "PASS", role: "mcp-tool", includes: String(item) });
  }

  return {
    defaultVerdict: "PAUSE",
    rules,
  };
}
