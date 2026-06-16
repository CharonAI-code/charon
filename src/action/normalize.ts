import { randomUUID } from "node:crypto";
import type { ActionRequest, ActionResource, RawToolCall } from "./types";
import { canonicalizeResource, type ResourceRole } from "../roles";

const READ_KEYS = new Set(["path", "file", "filepath", "filename", "source", "src"]);
const WRITE_KEYS = new Set(["dest", "destination", "out", "output", "target", "writePath"]);
const DELETE_KEYS = new Set(["delete", "remove", "rm"]);
const URL_KEYS = new Set(["url", "uri", "href", "endpoint"]);

export function createActionRequest(input: RawToolCall): ActionRequest {
  const cwd = input.cwd || process.cwd();
  const resources = input.resources?.length
    ? input.resources.map((resource) => normalizeResource(resource, cwd))
    : inferResources(input, cwd);

  return {
    id: input.id || randomUUID(),
    runtime: input.runtime || "unknown",
    toolName: input.toolName,
    args: input.args,
    cwd,
    actor: input.actor,
    resources,
    context: input.context,
    metadata: input.metadata,
  };
}

export function inferResources(input: RawToolCall, cwd = process.cwd()): ActionResource[] {
  const resources: ActionResource[] = [];
  const toolName = input.toolName.toLowerCase();
  const argsText = stringifyArgs(input.args);

  if (toolName.includes("shell") || toolName.includes("command")) {
    resources.push(resource("shell-command", argsText, "tool.args", cwd));
  }
  for (const value of inferDeletePaths(argsText)) {
    resources.push(resource("delete-path", value, "tool.args", cwd));
  }

  if (toolName.includes("mcp") || toolName.includes(".")) {
    resources.push(resource("mcp-tool", input.toolName, "tool.name", cwd));
  }

  visitArgs(input.args, (key, value) => {
    const lower = key.toLowerCase();
    if (isSecret(value) || lower.includes("secret") || lower.includes("token") || lower.includes("key")) {
      resources.push(resource("secret", value, key, cwd));
      return;
    }
    if (looksUrl(value)) {
      resources.push(resource(roleForUrlKey(lower, value), value, key, cwd));
      return;
    }
    if (looksPath(value)) {
      resources.push(resource(roleForPathKey(lower, toolName), value, key, cwd));
    }
  });

  for (const url of extractUrls(argsText)) {
    resources.push(resource(roleForUrlKey("", url), url, "tool.args", cwd));
  }

  return dedupe(resources.length ? resources : [resource("unknown", argsText || input.toolName, "tool", cwd)]);
}

function normalizeResource(input: ActionResource, cwd: string): ActionResource {
  return {
    ...input,
    canonical: input.canonical || canonicalizeResource(input.role, input.value, { cwd }),
  };
}

function resource(role: ResourceRole, value: string, source: string, cwd: string): ActionResource {
  return {
    role,
    value,
    canonical: canonicalizeResource(role, value, { cwd }),
    source,
  };
}

function roleForPathKey(key: string, toolName: string): ResourceRole {
  if (toolName.includes("write") || toolName.includes("create")) return "write-path";
  if (toolName.includes("delete") || toolName.includes("remove")) return "delete-path";
  if (DELETE_KEYS.has(key) || toolName.includes("delete") || toolName.includes("remove")) return "delete-path";
  if (WRITE_KEYS.has(key) || toolName.includes("write") || toolName.includes("create")) return "write-path";
  if (READ_KEYS.has(key) || toolName.includes("read")) return "read-path";
  return "read-path";
}

function roleForUrlKey(key: string, value: string): ResourceRole {
  if (key.includes("browser")) return "browser-url";
  if (key.includes("git") || value.startsWith("git@") || value.endsWith(".git")) return "git-remote-url";
  if (URL_KEYS.has(key) || looksUrl(value)) return "fetch-url";
  return "fetch-url";
}

function visitArgs(value: unknown, visit: (key: string, value: string) => void, key = "args"): void {
  if (typeof value === "string") {
    visit(key, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitArgs(item, visit, `${key}.${index}`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      visitArgs(childValue, visit, childKey);
    }
  }
}

function stringifyArgs(args: unknown): string {
  if (Array.isArray(args)) return args.map(String).join(" ");
  if (typeof args === "string") return args;
  if (args && typeof args === "object") return JSON.stringify(args);
  return args === undefined || args === null ? "" : String(args);
}

function looksPath(value: string): boolean {
  return value === "." || value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value.startsWith("~") || value.includes("/") || value.includes(".env");
}

function looksUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^git@[^:]+:.+/i.test(value);
}

function isSecret(value: string): boolean {
  return /(^|\/)\.env($|\.)|-----BEGIN [A-Z ]*PRIVATE KEY-----|github_pat_|gh[pousr]_|sk-[A-Za-z0-9_-]{16,}|sk-proj-|sk-ant-/i.test(value);
}

function extractUrls(value: string): string[] {
  const urls = new Set<string>();
  for (const match of value.matchAll(/\bhttps?:\/\/[^\s"']+/g)) urls.add(match[0]);
  for (const match of value.matchAll(/\bgit@[^:\s]+:[^\s"']+/g)) urls.add(match[0]);
  return [...urls];
}

function inferDeletePaths(value: string): string[] {
  const paths = new Set<string>();
  for (const match of value.matchAll(/\b(?:fs\.)?(?:rm|unlink|rmdir)\s*\(\s*["']([^"']+)["']/g)) {
    paths.add(match[1]);
  }
  for (const match of value.matchAll(/\b(?:rmSync|unlinkSync|rmdirSync)\s*\(\s*["']([^"']+)["']/g)) {
    paths.add(match[1]);
  }
  return [...paths];
}

function dedupe(resources: ActionResource[]): ActionResource[] {
  const seen = new Set<string>();
  return resources.filter((item) => {
    const key = `${item.role}\0${item.canonical || item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
