import { createHash, sign as signBytes, verify as verifyBytes } from "node:crypto";
import type { ActionDecision, ActionRequest } from "../action";
import type { RuntimePolicy } from "../core/policy";

export interface TrustedReceipt {
  schema: "charon.trustedReceipt.v2";
  id: string;
  createdAt: string;
  action: ActionRequest;
  decision: ActionDecision;
  policyHash: string;
  actionHash: string;
  decisionHash: string;
  execution: {
    launched: boolean;
    status: "not_launched" | "completed" | "failed";
    exitCode?: number;
    error?: string;
  };
  trace?: unknown;
  receiptHash: string;
  signature?: TrustedReceiptSignature;
  identity?: unknown;
}

export interface TrustedReceiptSigner {
  keyId: string;
  publicKey?: string;
  privateKey: string;
}

export interface TrustedReceiptSignature {
  schema: "charon.receiptSignature.v1";
  type: "ed25519";
  keyId: string;
  publicKey?: string;
  signature: string;
}

export function createTrustedReceipt(input: {
  id: string;
  createdAt: string;
  action: ActionRequest;
  decision: ActionDecision;
  policy?: RuntimePolicy;
  execution?: TrustedReceipt["execution"];
  trace?: unknown;
  signer?: TrustedReceiptSigner;
}): TrustedReceipt {
  const action = redactAction(input.action);
  const decision = redactDecision(input.decision);
  const unsigned = {
    schema: "charon.trustedReceipt.v2" as const,
    id: input.id,
    createdAt: input.createdAt,
    action,
    decision,
    policyHash: hashObject(input.policy || {}),
    actionHash: hashObject(input.action),
    decisionHash: hashObject(input.decision),
    execution: input.execution || {
      launched: false,
      status: "not_launched",
    },
    trace: input.trace,
  };
  const receiptHash = hashObject(unsigned);
  const receipt: TrustedReceipt = { ...unsigned, receiptHash };
  if (input.signer) {
    receipt.signature = signReceipt(receipt, input.signer);
    receipt.identity = {
      schema: "charon.identityProof.v2",
      type: "ed25519",
      keyId: input.signer.keyId,
      publicKey: input.signer.publicKey,
      receiptHash,
    };
  }
  return receipt;
}

export function verifyTrustedReceipt(receipt: TrustedReceipt): boolean {
  const { signature, identity, receiptHash, ...unsignedWithHash } = receipt;
  const { receiptHash: _ignored, ...unsigned } = unsignedWithHash as TrustedReceipt;
  if (hashObject(unsigned) !== receiptHash) return false;
  if (!signature) return true;
  return verifyBytes(
    null,
    Buffer.from(receiptHash),
    signature.publicKey || "",
    Buffer.from(signature.signature, "base64"),
  );
}

function signReceipt(receipt: TrustedReceipt, signer: TrustedReceiptSigner): TrustedReceiptSignature {
  return {
    schema: "charon.receiptSignature.v1",
    type: "ed25519",
    keyId: signer.keyId,
    publicKey: signer.publicKey,
    signature: signBytes(null, Buffer.from(receipt.receiptHash), signer.privateKey).toString("base64"),
  };
}

function redactAction(action: ActionRequest): ActionRequest {
  return {
    ...action,
    args: redactValue(action.args),
    resources: action.resources.map((resource) => {
      return {
        ...resource,
        value: resource.role === "secret" ? "[REDACTED:secret]" : redactString(resource.value),
        canonical: resource.role === "secret" ? resource.canonical ? "[REDACTED:secret]" : undefined : resource.canonical ? redactString(resource.canonical) : undefined,
      };
    }),
    metadata: redactValue(action.metadata) as Record<string, unknown> | undefined,
  };
}

function redactDecision(decision: ActionDecision): ActionDecision {
  return {
    ...decision,
    reason: redactString(decision.reason),
    resources: decision.resources.map((resource) => {
      return {
        ...resource,
        value: resource.role === "secret" ? "[REDACTED:secret]" : redactString(resource.value),
        canonical: resource.role === "secret" ? resource.canonical ? "[REDACTED:secret]" : undefined : resource.canonical ? redactString(resource.canonical) : undefined,
      };
    }),
  };
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSecretKey(key) ? "[REDACTED:secret]" : redactValue(child);
    }
    return out;
  }
  return value;
}

function isSecretKey(key: string): boolean {
  return /secret|token|api[_-]?key|password|credential/i.test(key);
}

function redactString(value: string): string {
  return value
    .replace(/\bsk-ant-[A-Za-z0-9_-]{16,}/g, "[REDACTED:anthropic]")
    .replace(/\bsk-proj-[A-Za-z0-9_-]{16,}/g, "[REDACTED:openai]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "[REDACTED:api-key]")
    .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}/g, "[REDACTED:github]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED:private-key]");
}

export function hashObject(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
