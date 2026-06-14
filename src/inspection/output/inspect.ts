import type { InspectionSession } from "../session";
import type { InspectionFinding } from "../types";

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["anthropic", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ["openai_project", /\bsk-proj-[A-Za-z0-9_-]{20,}/g],
  ["openai", /\bsk-[A-Za-z0-9_-]{20,}/g],
  ["github", /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}/g],
  ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
];

export interface OutputInspectionOptions {
  session?: InspectionSession;
  mode?: "deny" | "pause" | "pass";
  store?: "none" | "redacted";
  maxBytes?: number;
}

export interface OutputInspectionResult {
  status: "clean" | "passed" | "paused" | "denied";
  verdict: "PASS" | "PAUSE" | "DENY";
  reason: string;
  findings: InspectionFinding[];
  redactions: Array<{ kind: string; length: number }>;
  stdout: string;
  stderr: string;
  combined: string;
}

export function inspectOutput(stdout: string, stderr: string, options: OutputInspectionOptions = {}): OutputInspectionResult {
  const combined = `${stdout || ""}${stderr || ""}`;
  const findings: InspectionFinding[] = [];
  const redactedCombined = redactText(combined);
  const sessionMatches = options.session?.matchSensitiveValue(combined) || [];
  for (const match of sessionMatches) {
    findings.push({
      id: "output.session_secret",
      category: "secret",
      severity: "critical",
      summary: "previously observed sensitive value appeared in output",
      evidence: match.source,
      metadata: { kind: match.kind },
    });
  }
  if (redactedCombined.redactions.length) {
    findings.push({
      id: "output.secret_pattern",
      category: "secret",
      severity: "critical",
      summary: "secret-like value detected in output",
      evidence: [...new Set(redactedCombined.redactions.map((item) => item.kind))].join(","),
    });
  }
  const action = options.mode || "deny";
  const verdict = findings.length
    ? action === "pass" ? "PASS" : action === "pause" ? "PAUSE" : "DENY"
    : "PASS";
  const status = findings.length
    ? action === "pass" ? "passed" : action === "pause" ? "paused" : "denied"
    : "clean";
  const store = options.store || "redacted";
  const maxBytes = options.maxBytes || 4000;
  return {
    status,
    verdict,
    reason: findings.length ? findings[0].summary : "",
    findings,
    redactions: redactedCombined.redactions,
    stdout: store === "redacted" ? truncateOutput(redactText(stdout || "").value, maxBytes) : "",
    stderr: store === "redacted" ? truncateOutput(redactText(stderr || "").value, maxBytes) : "",
    combined: store === "redacted" ? truncateOutput(redactedCombined.value, maxBytes) : "",
  };
}

function redactText(value: string): { value: string; redactions: Array<{ kind: string; length: number }> } {
  let text = String(value || "");
  const redactions: Array<{ kind: string; length: number }> = [];
  for (const [kind, pattern] of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, (match) => {
      redactions.push({ kind, length: match.length });
      return `[REDACTED:${kind}]`;
    });
  }
  return { value: text, redactions };
}

function truncateOutput(value: string, maxBytes: number): string {
  const text = String(value || "");
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  return `${text.slice(0, maxBytes)}\n[truncated]`;
}
