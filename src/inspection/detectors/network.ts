import type { ActionRequest } from "../../action";
import type { InspectionFinding } from "../types";

const SUSPICIOUS_HOSTS = [/webhook\.site/i, /ngrok\.(?:io|app)/i, /pastebin\.com/i];

export function detectNetworkThreats(action: ActionRequest): InspectionFinding[] {
  const findings: InspectionFinding[] = [];
  for (const resource of action.resources) {
    if (!["fetch-url", "browser-url", "git-remote-url"].includes(resource.role)) continue;
    const value = resource.canonical || resource.value;
    for (const pattern of SUSPICIOUS_HOSTS) {
      const match = value.match(pattern);
      if (!match) continue;
      findings.push({
        id: "network.suspicious_host",
        category: "network",
        severity: "high",
        summary: "suspicious network destination detected",
        evidence: match[0],
        resourceRole: resource.role,
        metadata: { url: value },
      });
      break;
    }
  }
  return findings;
}
