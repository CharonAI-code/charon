import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface AuditEntry {
  id: string;
  time: string;
  phase?: string;
  request?: unknown;
  action?: unknown;
  decision: unknown;
  receipt?: unknown;
}

export class AuditLog {
  private failed: Error | null = null;

  constructor(private readonly file: string) {
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch (error) {
      this.failed = error instanceof Error ? error : new Error(String(error));
    }
  }

  append(entry: AuditEntry): void {
    if (this.failed) throw new Error(`audit unavailable: ${this.failed.message}`);
    try {
      appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
    } catch (error) {
      this.failed = error instanceof Error ? error : new Error(String(error));
      throw new Error(`audit unavailable: ${this.failed.message}`);
    }
  }
}
