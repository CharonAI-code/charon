import type { InspectionFinding } from "../types";

const ZERO_WIDTH = /[\u200B\u200C\u200D\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const CONFUSABLES: Record<string, string> = {
  "\u0430": "a",
  "\u0435": "e",
  "\u043e": "o",
  "\u0440": "p",
  "\u0441": "c",
  "\u0445": "x",
  "\u0456": "i",
};
const CONFUSABLE_REGEX = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");
const ENCODED_PATTERNS = [
  { id: "base64_long", pattern: /(?:[A-Za-z0-9+/]{4}){8,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/, severity: "medium" as const },
  { id: "hex_escape", pattern: /(?:\\x[0-9a-fA-F]{2}){3,}/, severity: "medium" as const },
  { id: "unicode_escape", pattern: /(?:\\u[0-9a-fA-F]{4}){2,}/, severity: "medium" as const },
];

export function normalizeInspectionText(text: string): { text: string; changes: Array<{ kind: "zero-width" | "confusable"; count: number }> } {
  const changes: Array<{ kind: "zero-width" | "confusable"; count: number }> = [];
  let next = text;
  const zeroMatches = next.match(ZERO_WIDTH);
  if (zeroMatches?.length) {
    next = next.replace(ZERO_WIDTH, "");
    changes.push({ kind: "zero-width", count: zeroMatches.length });
  }
  const confusableMatches = next.match(CONFUSABLE_REGEX);
  if (confusableMatches?.length) {
    next = next.replace(CONFUSABLE_REGEX, (char) => CONFUSABLES[char] || char);
    changes.push({ kind: "confusable", count: confusableMatches.length });
  }
  return { text: next, changes };
}

export function detectObfuscationThreats(text: string): InspectionFinding[] {
  const findings: InspectionFinding[] = [];
  for (const { id, pattern, severity } of ENCODED_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    findings.push({
      id: `obfuscation.${id}`,
      category: "obfuscation",
      severity,
      summary: `encoded or obfuscated payload detected: ${id}`,
      evidence: match[0].slice(0, 80),
    });
  }
  return findings;
}
