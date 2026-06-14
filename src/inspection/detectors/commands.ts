import type { InspectionFinding } from "../types";

const COMMAND_PATTERNS = [
  { id: "shell_chain", pattern: /(?:;|\||&&|\|\|)\s*(?:curl|wget|bash|sh|nc|python|perl|ruby|node)\b/i, severity: "critical" as const },
  { id: "command_substitution", pattern: /\$\([^)]+\)|`[^`]+`/, severity: "high" as const },
  { id: "destructive_rm", pattern: /\brm\s+-rf\b/i, severity: "critical" as const },
];

export function detectCommandThreats(text: string): InspectionFinding[] {
  return COMMAND_PATTERNS.flatMap(({ id, pattern, severity }) => {
    const match = text.match(pattern);
    return match ? [{
      id: `command.${id}`,
      category: "command",
      severity,
      summary: `suspicious command pattern: ${id}`,
      evidence: match[0],
      resourceRole: "shell-command",
    }] : [];
  });
}
