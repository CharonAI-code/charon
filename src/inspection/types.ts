export type FindingSeverity = "low" | "medium" | "high" | "critical";

export type FindingCategory =
  | "command"
  | "file"
  | "network"
  | "secret"
  | "obfuscation"
  | "social";

export interface InspectionFinding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  summary: string;
  evidence?: string;
  resourceRole?: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizationChange {
  kind: "zero-width" | "confusable";
  count: number;
}

export interface InspectionReport {
  passed: boolean;
  findings: InspectionFinding[];
  normalizedText?: string;
  normalization?: NormalizationChange[];
}

export interface InspectionSessionRecord {
  source: string;
  kind: string;
  createdAt: number;
}
