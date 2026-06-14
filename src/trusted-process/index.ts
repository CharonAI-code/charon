import { randomUUID } from "node:crypto";
import type { ActionRequest, RawToolCall } from "../action";
import type { PolicyDecision, RuntimePolicy, ToolCallRequest } from "../core/policy";
import { normalizeResources } from "../core/policy";
import { createActionRequest } from "../action";
import { InspectionSession } from "../inspection";
import { AuditLog } from "./audit-log";
import { ActionCoordinator, type CoordinatorExecutor } from "./coordinator";
import type { TrustedReceipt, TrustedReceiptSigner } from "./receipt";

export interface TrustedProcessOptions {
  policy?: RuntimePolicy;
  auditPath?: string;
  signer?: TrustedReceiptSigner;
  session?: InspectionSession;
}

export interface TrustedExecutionResult<T = unknown> {
  decision: PolicyDecision;
  receipt: TrustedReceipt;
  launched: boolean;
  result?: T;
  error?: Error;
}

export type TrustedExecutor<T = unknown> = CoordinatorExecutor<T>;

export class TrustedProcess {
  private readonly audit?: AuditLog;
  private readonly coordinator: ActionCoordinator;

  constructor(private readonly options: TrustedProcessOptions = {}) {
    this.audit = options.auditPath ? new AuditLog(options.auditPath) : undefined;
    this.coordinator = new ActionCoordinator({
      policy: options.policy,
      audit: this.audit,
      signer: options.signer,
      session: options.session,
    });
  }

  evaluate(request: ToolCallRequest): PolicyDecision {
    const decision = this.coordinator.evaluate(createActionRequest({
      id: request.id,
      runtime: request.runtime,
      toolName: request.toolName,
      args: request.args,
      cwd: request.cwd,
      resources: normalizeResources(request),
      context: request.context,
    })).decision;
    this.audit?.append({
      id: request.id || cryptoRandomId(),
      time: new Date().toISOString(),
      phase: "evaluate",
      request,
      decision,
    });
    return decision;
  }

  evaluateAction(action: ActionRequest): PolicyDecision {
    return this.coordinator.evaluate(action).decision;
  }

  async enforce<T = unknown>(input: RawToolCall | ActionRequest, executor?: TrustedExecutor<T>): Promise<TrustedExecutionResult<T>> {
    const result = await this.coordinator.enforce(input, executor);
    return {
      decision: result.decision,
      receipt: result.receipt,
      launched: result.launched,
      result: result.result,
      error: result.error,
    };
  }
}

function cryptoRandomId(): string {
  return randomUUID();
}

export type { TrustedReceipt };
export { ActionCoordinator } from "./coordinator";
export { verifyTrustedReceipt } from "./receipt";
export type { TrustedReceiptSigner };
