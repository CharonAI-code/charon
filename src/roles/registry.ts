import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export type RoleCategory = "path" | "url" | "secret" | "command" | "tool" | "opaque";

export type ResourceRole =
  | "read-path"
  | "write-path"
  | "delete-path"
  | "fetch-url"
  | "browser-url"
  | "git-remote-url"
  | "secret"
  | "shell-command"
  | "mcp-tool"
  | "unknown";

export interface RoleDefinition {
  role: ResourceRole;
  category: RoleCategory;
  description: string;
  risk: "low" | "medium" | "high" | "critical";
  sandboxSafe: boolean;
  canonicalize(value: string, context?: CanonicalizeContext): string;
}

export interface CanonicalizeContext {
  cwd?: string;
}

const identity = (value: string) => value;

function expandTilde(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return `${homedir()}${value.slice(1)}`;
  return value;
}

export function canonicalPath(value: string, context: CanonicalizeContext = {}): string {
  const cwd = context.cwd || process.cwd();
  const absolute = resolve(cwd, expandTilde(value));

  try {
    return realpathSync(absolute);
  } catch {
    let current = absolute;
    const tail: string[] = [];
    for (let depth = 0; depth < 64; depth += 1) {
      const parent = dirname(current);
      tail.unshift(basename(current));
      if (parent === current) return absolute;
      current = parent;
      try {
        return join(realpathSync(current), ...tail);
      } catch {
        continue;
      }
    }
    return absolute;
  }
}

export function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }
    return url.toString();
  } catch {
    return value.toLowerCase();
  }
}

export function canonicalDomain(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

export function canonicalGitRemote(value: string): string {
  const text = value.trim();
  const scpLike = text.match(/^git@([^:]+):(.+)$/);
  if (scpLike) return `ssh://git@${scpLike[1].toLowerCase()}/${scpLike[2].replace(/\.git$/i, "")}`;
  return canonicalUrl(text).replace(/\.git$/i, "");
}

export const ROLE_REGISTRY: Record<ResourceRole, RoleDefinition> = {
  "read-path": {
    role: "read-path",
    category: "path",
    description: "Filesystem path read by a tool",
    risk: "medium",
    sandboxSafe: true,
    canonicalize: canonicalPath,
  },
  "write-path": {
    role: "write-path",
    category: "path",
    description: "Filesystem path written by a tool",
    risk: "high",
    sandboxSafe: true,
    canonicalize: canonicalPath,
  },
  "delete-path": {
    role: "delete-path",
    category: "path",
    description: "Filesystem path deleted by a tool",
    risk: "critical",
    sandboxSafe: false,
    canonicalize: canonicalPath,
  },
  "fetch-url": {
    role: "fetch-url",
    category: "url",
    description: "Network URL fetched by a tool",
    risk: "medium",
    sandboxSafe: false,
    canonicalize: canonicalUrl,
  },
  "browser-url": {
    role: "browser-url",
    category: "url",
    description: "Browser navigation target",
    risk: "medium",
    sandboxSafe: false,
    canonicalize: canonicalUrl,
  },
  "git-remote-url": {
    role: "git-remote-url",
    category: "url",
    description: "Git remote endpoint",
    risk: "high",
    sandboxSafe: false,
    canonicalize: canonicalGitRemote,
  },
  secret: {
    role: "secret",
    category: "secret",
    description: "Secret-bearing value or path",
    risk: "critical",
    sandboxSafe: false,
    canonicalize: identity,
  },
  "shell-command": {
    role: "shell-command",
    category: "command",
    description: "Shell command to execute",
    risk: "high",
    sandboxSafe: false,
    canonicalize: identity,
  },
  "mcp-tool": {
    role: "mcp-tool",
    category: "tool",
    description: "MCP tool invocation",
    risk: "medium",
    sandboxSafe: false,
    canonicalize: identity,
  },
  unknown: {
    role: "unknown",
    category: "opaque",
    description: "Unclassified action resource",
    risk: "medium",
    sandboxSafe: false,
    canonicalize: identity,
  },
};

export function getRoleDefinition(role: ResourceRole): RoleDefinition {
  return ROLE_REGISTRY[role];
}

export function canonicalizeResource(role: ResourceRole, value: string, context?: CanonicalizeContext): string {
  return getRoleDefinition(role).canonicalize(value, context);
}
