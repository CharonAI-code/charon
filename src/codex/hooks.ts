import { resolve } from "node:path";
import { ActionCoordinator } from "../trusted-process";
import type { ActionResource } from "../action";
import { InspectionSession } from "../inspection";
import { loadMcpPolicy } from "../mcp/policy";
import { writeMcpReceipt } from "../mcp/receipts";

type CodexHookEvent = "PreToolUse" | "PermissionRequest" | "PostToolUse";

interface CodexHookPayload {
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: any;
  tool_response?: any;
  permission_mode?: string;
}

export async function runCodexHook(kind: string, input = process.stdin, output = process.stdout, error = process.stderr): Promise<number> {
  const payload = parsePayload(await readAll(input));
  const event = eventName(kind, payload);
  const cwd = payload.cwd || process.cwd();
  const toolName = String(payload.tool_name || "unknown");
  const coordinator = new ActionCoordinator({
    policy: loadMcpPolicy(resolve(cwd, "charon.yml")),
    session: new InspectionSession(),
  });
  const result = coordinator.evaluate({
    runtime: "codex-hook",
    toolName,
    cwd,
    args: payload.tool_input,
    resources: resourcesForHook(toolName, payload),
    context: `Codex ${event}`,
    metadata: {
      hookEventName: event,
      permissionMode: payload.permission_mode,
    },
  });

  if (result.decision.verdict !== "PASS") {
    try {
      writeMcpReceipt(result.receipt, resolve(cwd, ".charon", "receipts"));
    } catch {
      // Hook output must stay policy-shaped even if receipt persistence fails.
    }
  }

  if (result.decision.verdict === "PASS") {
    return 0;
  }

  const reason = `Charon ${result.decision.verdict}: ${result.decision.reason}`;
  output.write(`${JSON.stringify(blockOutput(event, reason))}\n`);
  if (event === "PreToolUse") error.write(`${reason}\n`);
  return 0;
}

function eventName(kind: string, payload: CodexHookPayload): CodexHookEvent {
  const raw = String(payload.hook_event_name || kind || "");
  if (/permission/i.test(raw)) return "PermissionRequest";
  if (/post/i.test(raw)) return "PostToolUse";
  return "PreToolUse";
}

function blockOutput(event: CodexHookEvent, reason: string): Record<string, unknown> {
  if (event === "PermissionRequest") {
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: reason,
        },
      },
    };
  }
  if (event === "PostToolUse") {
    return {
      decision: "block",
      reason,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: reason,
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

function resourcesForHook(toolName: string, payload: CodexHookPayload): ActionResource[] {
  const input = payload.tool_input;
  const resources: ActionResource[] = [];
  const command = commandFromInput(input);
  const lower = toolName.toLowerCase();

  if (toolName === "Bash" || lower.includes("shell") || lower.includes("command")) {
    if (command) resources.push({ role: "shell-command", value: command });
    resources.push(...inferDeleteResourcesFromText(command));
    resources.push(...inferGitDeleteResourcesFromText(command));
  } else if (toolName === "apply_patch" || lower === "edit" || lower === "write") {
    if (command) resources.push({ role: "shell-command", value: command });
    resources.push(...resourcesFromPatch(command));
  } else if (toolName.startsWith("mcp__")) {
    resources.push({ role: "mcp-tool", value: toolName });
    if (command) resources.push({ role: "mcp-tool", value: command });
    resources.push(...resourcesFromObject(input));
  } else {
    resources.push({ role: "mcp-tool", value: toolName });
    if (command) resources.push({ role: "mcp-tool", value: command });
    resources.push(...resourcesFromObject(input));
  }

  return dedupe(resources.length ? resources : [{ role: "unknown", value: JSON.stringify(input ?? {}) }]);
}

function commandFromInput(input: any): string {
  if (typeof input === "string") return input;
  if (input && typeof input.command === "string") return input.command;
  if (input && typeof input.patch === "string") return input.patch;
  return input ? JSON.stringify(input) : "";
}

function resourcesFromPatch(patch: string): ActionResource[] {
  const resources: ActionResource[] = [];
  for (const match of patch.matchAll(/^\*\*\* Delete File: (.+)$/gm)) {
    resources.push({ role: "delete-path", value: match[1].trim() });
  }
  for (const match of patch.matchAll(/^\*\*\* Update File: (.+)$/gm)) {
    resources.push({ role: "write-path", value: match[1].trim() });
  }
  for (const match of patch.matchAll(/^\*\*\* Add File: (.+)$/gm)) {
    resources.push({ role: "write-path", value: match[1].trim() });
  }
  return resources;
}

function resourcesFromObject(value: unknown): ActionResource[] {
  const resources: ActionResource[] = [];
  visit(value, (key, child) => {
    const lower = key.toLowerCase();
    if (lower.includes("delete") || lower.includes("remove") || lower === "rm") {
      resources.push({ role: "delete-path", value: child });
      return;
    }
    if (lower.includes("write") || lower.includes("target") || lower.includes("path") || lower.includes("file")) {
      resources.push({ role: "write-path", value: child });
      return;
    }
    if (/^https?:\/\//i.test(child)) resources.push({ role: "fetch-url", value: child });
  });
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  resources.push(...inferDeleteResourcesFromText(text));
  resources.push(...inferGitDeleteResourcesFromText(text));
  return resources;
}

function visit(value: unknown, fn: (key: string, value: string) => void, key = "args"): void {
  if (typeof value === "string") {
    fn(key, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, fn, `${key}.${index}`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      visit(childValue, fn, childKey);
    }
  }
}

function inferDeleteResourcesFromText(text: string): ActionResource[] {
  const resources: ActionResource[] = [];
  for (const match of text.matchAll(/\b(?:rm|unlink|rmdir|trash)\b\s+([^;&|]+)/g)) {
    for (const token of splitShellLike(match[1] || "")) {
      if (token && !token.startsWith("-")) resources.push({ role: "delete-path", value: stripQuotes(token) });
    }
  }
  for (const match of text.matchAll(/\bfind\b\s+([^;&|]*?)\s+-delete\b/g)) {
    const roots: string[] = [];
    for (const token of splitShellLike(match[1] || "")) {
      if (!token || token.startsWith("-")) break;
      roots.push(stripQuotes(token));
    }
    for (const root of roots.length ? roots : ["."]) resources.push({ role: "delete-path", value: root });
  }
  for (const match of text.matchAll(/\b(?:fs\.)?(?:rm|unlink|rmdir)\s*\(\s*["']([^"']+)["']/g)) {
    resources.push({ role: "delete-path", value: match[1] });
  }
  for (const match of text.matchAll(/\b(?:rmSync|unlinkSync|rmdirSync)\s*\(\s*["']([^"']+)["']/g)) {
    resources.push({ role: "delete-path", value: match[1] });
  }
  return resources;
}

function inferGitDeleteResourcesFromText(text: string): ActionResource[] {
  const resources: ActionResource[] = [];
  for (const match of text.matchAll(/\bgit\s+rm\b\s+([^;&|]+)/g)) {
    for (const token of splitShellLike(match[1] || "")) {
      if (token && !token.startsWith("-")) resources.push({ role: "delete-path", value: stripQuotes(token) });
    }
  }
  if (/\bgit\s+clean\b/.test(text)) resources.push({ role: "delete-path", value: "." });
  return resources;
}

function splitShellLike(text: string): string[] {
  return text.match(/"[^"]*"|'[^']*'|\S+/g) || [];
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function dedupe(resources: ActionResource[]): ActionResource[] {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = `${resource.role}\0${resource.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parsePayload(raw: string): CodexHookPayload {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readAll(input: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolveRead, reject) => {
    let raw = "";
    input.setEncoding("utf8");
    input.on("data", (chunk) => { raw += chunk; });
    input.on("error", reject);
    input.on("end", () => resolveRead(raw));
  });
}
