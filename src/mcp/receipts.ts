import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { TrustedReceipt } from "../trusted-process";

export function writeMcpReceipt(receipt: TrustedReceipt, dir = ".charon/receipts"): string {
  mkdirSync(dir, { recursive: true });
  const id = `${receipt.createdAt.replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  const file = resolve(dir, `${id}.json`);
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
  return file;
}
