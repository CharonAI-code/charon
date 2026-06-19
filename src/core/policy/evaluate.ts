import { createActionRequest } from "../../action";
import type { ActionRequest, ActionResource } from "../../action";
import type { ResourceRole } from "../../roles";
import type { CharonResourceRole, PolicyDecision, PolicyRule, RuntimePolicy, ToolCallRequest, ToolResource } from "./types";

const ROLE_ALIASES: Record<string, ResourceRole> = {
  "shell.command": "shell-command",
  "file.read": "read-path",
  "file.write": "write-path",
  "network.domain": "fetch-url",
  "git.remote": "git-remote-url",
};

export function evaluateToolCall(request: ToolCallRequest, policy: RuntimePolicy = {}): PolicyDecision {
  const action = createActionRequest({
    id: request.id,
    runtime: request.runtime,
    toolName: request.toolName,
    args: request.args,
    cwd: request.cwd,
    resources: normalizeInputResources(request.resources),
    context: request.context,
  });
  return evaluateAction(action, policy);
}

export function evaluateAction(action: ActionRequest, policy: RuntimePolicy = {}): PolicyDecision {
  const resources = action.resources;
  const rules = policy.rules || [];

  for (const rule of rules) {
    for (const resource of resources) {
      if (matchesRule(resource, rule)) {
        return {
          verdict: rule.verdict,
          reason: `${resource.role} matched ${rule.id}`,
          ruleId: rule.id,
          resources,
        };
      }
    }
  }

  const verdict = policy.defaultVerdict || "PAUSE";
  return {
    verdict,
    reason: verdict === "PASS" ? "inside default policy" : "no explicit policy match",
    ruleId: "default",
    resources,
  };
}

export function normalizeResources(request: ToolCallRequest): ActionResource[] {
  return createActionRequest({
    id: request.id,
    runtime: request.runtime,
    toolName: request.toolName,
    args: request.args,
    cwd: request.cwd,
    resources: normalizeInputResources(request.resources),
    context: request.context,
  }).resources;
}

function normalizeInputResources(resources?: readonly ToolResource[]): ActionResource[] | undefined {
  return resources?.map((resource) => ({
    ...resource,
    role: normalizeRole(resource.role),
  }));
}

function matchesRule(resource: ActionResource, rule: PolicyRule): boolean {
  const ruleRole = rule.role ? normalizeRole(rule.role) : undefined;
  if (ruleRole && ruleRole !== resource.role) return false;
  const values = resourceComparableValues(resource);
  if (rule.equals !== undefined) return values.includes(rule.equals);
  if (rule.includes !== undefined) return values.some((value) => value.includes(rule.includes || ""));
  if (rule.prefix !== undefined) return values.some((value) => value.startsWith(rule.prefix || ""));
  return true;
}

function resourceComparableValues(resource: ActionResource): string[] {
  const values = [resource.value, resource.canonical].filter((value): value is string => Boolean(value));
  if (resource.role === "fetch-url" || resource.role === "browser-url" || resource.role === "git-remote-url") {
    for (const value of [...values]) {
      try {
        values.push(new URL(value).hostname.toLowerCase());
      } catch {
        continue;
      }
    }
  }
  return [...new Set(values)];
}

function normalizeRole(role: CharonResourceRole): ResourceRole {
  return ROLE_ALIASES[role] || (role as ResourceRole);
}
