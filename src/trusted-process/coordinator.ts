import { randomUUID } from "node:crypto";
import { createActionRequest, type ActionRequest, type RawToolCall } from "../action";
import type { PolicyDecision, RuntimePolicy } from "../core/policy";
import { evaluateAction } from "../core/policy";
import { AuditLog } from "./audit-log";
import { createTrustedReceipt, type TrustedReceipt, type TrustedReceiptSigner } from "./receipt";

export type CoordinatorExecutor<T = unknown> = (action: ActionRequest, decision: PolicyDecision) => T | Promise<T>;

export interface ActionCoordinatorOptions {
  policy?: RuntimePolicy;
  audit?: AuditLog;
  signer?: TrustedReceiptSigner;
}

export interface CoordinatedAction<T = unknown> {
  action: ActionRequest;
  decision: PolicyDecision;
  receipt: TrustedReceipt;
  launched: boolean;
  result?: T;
  error?: Error;
}

export class ActionCoordinator {
  constructor(private readonly options: ActionCoordinatorOptions = {}) {}

  evaluate(input: RawToolCall | ActionRequest): CoordinatedAction {
    const action = normalizeCoordinatorInput(input);
    const decision = evaluateAction(action, this.options.policy);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const receipt = createTrustedReceipt({
      id,
      createdAt,
      action,
      decision,
      policy: this.options.policy,
      signer: this.options.signer,
    });
    this.writeAudit({ id, createdAt, phase: "evaluate", action, decision, receipt });
    return { action, decision, receipt, launched: false };
  }

  async enforce<T = unknown>(input: RawToolCall | ActionRequest, executor?: CoordinatorExecutor<T>): Promise<CoordinatedAction<T>> {
    const action = normalizeCoordinatorInput(input);
    const decision = evaluateAction(action, this.options.policy);
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    if (decision.verdict !== "PASS") {
      const receipt = createTrustedReceipt({
        id,
        createdAt,
        action,
        decision,
        policy: this.options.policy,
        signer: this.options.signer,
      });
      this.writeAudit({ id, createdAt, phase: "enforce", action, decision, receipt });
      return { action, decision, receipt, launched: false };
    }

    let result: T | undefined;
    let error: Error | undefined;
    if (executor) {
      try {
        result = await executor(action, decision);
      } catch (caught) {
        error = caught instanceof Error ? caught : new Error(String(caught));
      }
    }

    const receipt = createTrustedReceipt({
      id,
      createdAt,
      action,
      decision,
      policy: this.options.policy,
      signer: this.options.signer,
      execution: {
        launched: Boolean(executor),
        status: !executor ? "not_launched" : error ? "failed" : "completed",
        error: error?.message,
      },
    });
    this.writeAudit({ id, createdAt, phase: "enforce", action, decision, receipt });
    return { action, decision, receipt, launched: Boolean(executor), result, error };
  }

  private writeAudit(input: {
    id: string;
    createdAt: string;
    phase: "evaluate" | "enforce";
    action: ActionRequest;
    decision: PolicyDecision;
    receipt: TrustedReceipt;
  }): void {
    this.options.audit?.append({
      id: input.id,
      time: input.createdAt,
      phase: input.phase,
      action: input.receipt.action,
      decision: input.receipt.decision,
      receipt: input.receipt,
    });
  }
}

export function normalizeCoordinatorInput(input: RawToolCall | ActionRequest): ActionRequest {
  return isActionRequest(input) ? input : createActionRequest(input);
}

function isActionRequest(input: RawToolCall | ActionRequest): input is ActionRequest {
  return Boolean((input as ActionRequest).id && (input as ActionRequest).resources && (input as ActionRequest).cwd);
}
