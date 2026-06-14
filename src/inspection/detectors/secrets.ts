import type { ActionRequest } from "../../action";
import type { InspectionSession, SensitiveMatch } from "../session";
import type { InspectionFinding } from "../types";

export function detectSecretThreats(action: ActionRequest, session?: InspectionSession): InspectionFinding[] {
  const findings: InspectionFinding[] = [];
  for (const resource of action.resources) {
    if (resource.role !== "secret") continue;
    findings.push({
      id: "secret.inline_value",
      category: "secret",
      severity: "critical",
      summary: "secret-like value detected in action input",
      evidence: resource.source || resource.role,
      resourceRole: resource.role,
    });
    if (session) {
      session.rememberSensitiveValue(resource.value, {
        source: resource.source || resource.role,
        kind: "inline-secret",
      });
    }
  }

  if (session) {
    const text = [
      action.toolName,
      typeof action.args === "string" ? action.args : safeStringify(action.args),
      action.context || "",
    ].join("\n");
    const matches = session.matchSensitiveValue(text);
    for (const match of matches) findings.push(secretReuseFinding(match));
  }

  return dedupeFindings(findings);
}

function secretReuseFinding(match: SensitiveMatch): InspectionFinding {
  return {
    id: "secret.session_match",
    category: "secret",
    severity: "critical",
    summary: "previously observed sensitive value reused in action",
    evidence: match.source,
    metadata: { kind: match.kind },
  };
}

function dedupeFindings(findings: InspectionFinding[]): InspectionFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.id}\0${finding.evidence || ""}\0${finding.resourceRole || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}
