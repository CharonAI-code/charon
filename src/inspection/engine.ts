import type { ActionDecision, ActionRequest, ActionVerdict } from "../action";
import type { RuntimePolicy } from "../core/policy";
import { detectCommandThreats } from "./detectors/commands";
import { detectFileThreats } from "./detectors/files";
import { detectNetworkThreats } from "./detectors/network";
import { detectObfuscationThreats, normalizeInspectionText } from "./detectors/obfuscation";
import { detectSecretThreats } from "./detectors/secrets";
import { detectSocialThreats } from "./detectors/social";
import type { InspectionFinding, InspectionReport } from "./types";
import { InspectionSession } from "./session";

export interface InspectionEngineOptions {
  session?: InspectionSession;
}

export function inspectInput(action: ActionRequest, options: InspectionEngineOptions = {}): InspectionReport {
  const text = [
    action.toolName,
    typeof action.args === "string" ? action.args : safeStringify(action.args),
    action.context || "",
    ...action.resources.map((resource) => `${resource.role}:${resource.canonical || resource.value}`),
  ].join("\n");
  const normalized = normalizeInspectionText(text);
  const findings: InspectionFinding[] = [
    ...detectCommandThreats(normalized.text),
    ...detectFileThreats(action),
    ...detectNetworkThreats(action),
    ...detectObfuscationThreats(normalized.text),
    ...detectSecretThreats(action, options.session),
    ...detectSocialThreats(normalized.text),
  ];
  return {
    passed: !findings.some((finding) => severityRank(finding.severity) >= severityRank("high")),
    findings,
    normalizedText: normalized.text !== text ? normalized.text : undefined,
    normalization: normalized.changes.length ? normalized.changes : undefined,
  };
}

export function applyInspectionToDecision(
  decision: ActionDecision,
  report: InspectionReport,
  policy?: RuntimePolicy,
): ActionDecision {
  const inspectionDecision = inspectionDecisionForReport(report, policy);
  if (!inspectionDecision) return { ...decision, findings: report.findings };
  if (verdictRank(inspectionDecision.verdict) > verdictRank(decision.verdict)) {
    return {
      ...inspectionDecision,
      resources: decision.resources,
      findings: report.findings,
    };
  }
  return { ...decision, findings: report.findings };
}

function inspectionDecisionForReport(report: InspectionReport, policy?: RuntimePolicy): ActionDecision | null {
  const critical = report.findings.find((finding) => severityRank(finding.severity) >= severityRank("high"));
  if (!critical) return null;
  const mode = String(policy?.inspection?.mode || "enforce").toLowerCase();
  const verdict: ActionVerdict = mode === "observe" ? "PASS" : critical.severity === "high" && mode === "review" ? "PAUSE" : critical.severity === "medium" ? "PAUSE" : "DENY";
  const reason = critical.summary;
  return {
    verdict,
    reason,
    ruleId: critical.id,
    resources: [],
    findings: report.findings,
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

function severityRank(severity: string): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[severity] || 0;
}

function verdictRank(verdict: ActionVerdict): number {
  return { PASS: 0, PAUSE: 1, DENY: 2 }[verdict] || 0;
}
