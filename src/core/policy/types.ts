import type { ActionDecision, ActionRequest, ActionResource, ActionVerdict } from "../../action";
import type { ResourceRole } from "../../roles";

export type CharonVerdict = ActionVerdict;

export type CharonResourceRole = ResourceRole | "shell.command" | "file.read" | "file.write" | "network.domain" | "git.remote";

export interface ToolResource {
  role: CharonResourceRole;
  value: string;
  canonical?: string;
  source?: string;
}

export interface ToolCallRequest {
  id?: string;
  runtime: string;
  toolName: string;
  args?: unknown;
  cwd?: string;
  resources?: ToolResource[];
  context?: string;
}

export interface PolicyRule {
  id: string;
  verdict: CharonVerdict;
  role?: CharonResourceRole;
  equals?: string;
  includes?: string;
  prefix?: string;
}

export interface RuntimePolicy {
  defaultVerdict?: CharonVerdict;
  rules?: PolicyRule[];
  inspection?: {
    mode?: "enforce" | "review" | "observe";
  };
}

export type PolicyDecision = ActionDecision;

export type { ActionRequest, ActionResource, ResourceRole };
