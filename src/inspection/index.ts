export { inspectInput, applyInspectionToDecision, type InspectionEngineOptions } from "./engine";
export { InspectionSession, type InspectionSessionOptions, type SensitiveMatch } from "./session";
export { inspectOutput, type OutputInspectionOptions, type OutputInspectionResult } from "./output/inspect";
export type {
  FindingCategory,
  FindingSeverity,
  InspectionFinding,
  InspectionReport,
  InspectionSessionRecord,
  NormalizationChange,
} from "./types";
