import type { InspectionFinding } from "../types";

const SOCIAL_PATTERNS = [
  { id: "urgency", pattern: /\b(?:urgent(?:ly)?|immediately|right\s+now|asap)\b/i, severity: "medium" as const },
  { id: "bypass", pattern: /\b(?:bypass|skip)\s+(?:the\s+)?(?:check|security|guardrail|policy)\b/i, severity: "high" as const },
  { id: "credential_request", pattern: /\b(?:give me|tell me|show me).*(?:token|secret|password|api key|credential)/i, severity: "high" as const },
];

export function detectSocialThreats(text: string): InspectionFinding[] {
  return SOCIAL_PATTERNS.flatMap(({ id, pattern, severity }) => {
    const match = text.match(pattern);
    return match ? [{
      id: `social.${id}`,
      category: "social",
      severity,
      summary: `manipulative or bypass-oriented instruction detected: ${id}`,
      evidence: match[0],
    }] : [];
  });
}
