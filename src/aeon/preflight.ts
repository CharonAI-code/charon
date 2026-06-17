// @ts-nocheck
"use strict";

const crypto = require("crypto");
const path = require("path");
const { evaluateAction } = require("../core/policy");
const { loadMcpPolicy } = require("../mcp/policy");
const { createTrustedReceipt } = require("../trusted-process/receipt");
const { CONFIG } = require("./constants");
const { createAeonAction } = require("./action");
const { writeAeonReceipt } = require("./receipts");
const { createAeonReview } = require("./review");

function runAeonPreflight(input = {}) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const policyPath = path.resolve(cwd, input.policy || CONFIG);
  const policy = loadMcpPolicy(policyPath);
  const action = createAeonAction({ ...input, cwd });
  const decision = evaluateAction(action, policy);
  const receipt = createTrustedReceipt({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    action,
    decision,
    policy,
    execution: { launched: false, status: "not_launched" },
  });
  const written = writeAeonReceipt(cwd, receipt);
  const review = input.review === false ? null : createAeonReview({
    cwd,
    action,
    decision,
    receipt,
    receiptPath: written.path,
  });
  return {
    schema: "charon.aeonPreflight.v1",
    verdict: decision.verdict,
    reason: decision.reason,
    ruleId: decision.ruleId,
    launched: false,
    action,
    receiptPath: written.path,
    receipt,
    review,
  };
}

module.exports = { runAeonPreflight };
