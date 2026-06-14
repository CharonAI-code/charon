import type { ActionRequest } from "../../action";
import type { InspectionFinding } from "../types";

const SENSITIVE_PATHS = [/\.env(\.|$)/i, /\/\.ssh\//i, /\/\.aws\//i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

export function detectFileThreats(action: ActionRequest): InspectionFinding[] {
  const findings: InspectionFinding[] = [];
  for (const resource of action.resources) {
    if (!["read-path", "write-path", "delete-path"].includes(resource.role)) continue;
    const value = resource.canonical || resource.value;
    for (const pattern of SENSITIVE_PATHS) {
      const match = value.match(pattern);
      if (!match) continue;
      findings.push({
        id: "file.sensitive_path",
        category: "file",
        severity: "high",
        summary: "sensitive file path access detected",
        evidence: match[0],
        resourceRole: resource.role,
        metadata: { path: value },
      });
      break;
    }
  }
  return findings;
}
