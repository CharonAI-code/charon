import type { InspectionSessionRecord } from "./types";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 512;

export interface InspectionSessionOptions {
  ttlMs?: number;
  maxEntries?: number;
}

export interface SensitiveMatch {
  value: string;
  source: string;
  kind: string;
}

export class InspectionSession {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly values = new Map<string, InspectionSessionRecord>();

  constructor(options: InspectionSessionOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  rememberSensitiveValue(value: string, meta: { source: string; kind: string }): void {
    const normalized = normalizeSessionValue(value);
    if (!normalized || normalized.length < 6) return;
    this.prune();
    if (!this.values.has(normalized) && this.values.size >= this.maxEntries) this.evictOldest();
    this.values.set(normalized, {
      source: meta.source,
      kind: meta.kind,
      createdAt: Date.now(),
    });
  }

  matchSensitiveValue(text: string): SensitiveMatch[] {
    this.prune();
    const haystack = normalizeSessionValue(text);
    if (!haystack) return [];
    const matches: SensitiveMatch[] = [];
    for (const [value, meta] of this.values) {
      if (haystack.includes(value)) matches.push({ value, source: meta.source, kind: meta.kind });
    }
    return matches;
  }

  prune(): void {
    const now = Date.now();
    for (const [value, meta] of this.values) {
      if (now - meta.createdAt > this.ttlMs) this.values.delete(value);
    }
  }

  clear(): void {
    this.values.clear();
  }

  size(): number {
    this.prune();
    return this.values.size;
  }

  private evictOldest(): void {
    let oldestKey = "";
    let oldestTs = Infinity;
    for (const [value, meta] of this.values) {
      if (meta.createdAt < oldestTs) {
        oldestKey = value;
        oldestTs = meta.createdAt;
      }
    }
    if (oldestKey) this.values.delete(oldestKey);
  }
}

function normalizeSessionValue(value: string): string {
  return String(value || "").trim().toLowerCase();
}
