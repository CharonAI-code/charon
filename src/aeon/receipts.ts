// @ts-nocheck
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { RECEIPTS_DIR } = require("./constants");

function writeAeonReceipt(cwd, receipt) {
  const dir = path.join(cwd, RECEIPTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${receipt.createdAt.replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}.json`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
  return { path: file };
}

module.exports = { writeAeonReceipt };
