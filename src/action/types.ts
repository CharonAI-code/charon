import type { ResourceRole } from "../roles";

export type ActionVerdict = "PASS" | "PAUSE" | "DENY";

export interface ActionActor {
  id?: string;
  runtime?: string;
  keyId?: string;
}

export interface ActionResource {
  role: ResourceRole;
  value: string;
  canonical?: string;
  source?: string;
}

export interface ActionRequest {
  id: string;
  runtime: string;
  toolName: string;
  args?: unknown;
  cwd: string;
  actor?: ActionActor;
  resources: ActionResource[];
  context?: string;
  metadata?: Record<string, unknown>;
}

export interface ActionDecision {
  verdict: ActionVerdict;
  reason: string;
  ruleId: string;
  resources: ActionResource[];
}

export interface RawToolCall {
  id?: string;
  runtime?: string;
  toolName: string;
  args?: unknown;
  cwd?: string;
  actor?: ActionActor;
  resources?: ActionResource[];
  context?: string;
  metadata?: Record<string, unknown>;
}

