// @ts-nocheck
"use strict";

const fs = require("fs");
const path = require("path");
const { installAeonEnforcement, readAeonEnforcementReport } = require("./workflow");
const { runAeonPreflight } = require("./preflight");
const { exportAeonReview } = require("./review");
const { applyTelegramDecision, buildTelegramPayload } = require("./telegram");

function runAeonSmoke(input = {}) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const passSkill = input.passSkill || "digest";
  const pauseSkill = input.pauseSkill || "external-feature";
  const checks = [];

  const install = installAeonEnforcement({ cwd });
  const status = readAeonEnforcementReport({ cwd });
  checks.push(check("enforcement", status.enforced, status));

  const pass = runAeonPreflight({
    cwd,
    skill: passSkill,
    trigger: "charon-smoke",
    repo: input.repo || "owner/aeon-smoke",
    runId: "charon-smoke-pass",
    actor: input.actor || "charon-smoke",
    review: true,
  });
  checks.push(check("pass-preflight", pass.verdict === "PASS" && !pass.review, { verdict: pass.verdict, receiptPath: pass.receiptPath }));

  const pause = runAeonPreflight({
    cwd,
    skill: pauseSkill,
    trigger: "telegram-message",
    repo: input.repo || "owner/aeon-smoke",
    runId: "charon-smoke-pause",
    actor: input.actor || "charon-smoke",
    review: true,
  });
  checks.push(check("pause-preflight", pause.verdict === "PAUSE" && Boolean(pause.review), {
    verdict: pause.verdict,
    reviewId: pause.review && pause.review.id,
    receiptPath: pause.receiptPath,
  }));

  const exported = pause.review ? exportAeonReview({ cwd, id: pause.review.id }) : null;
  checks.push(check("review-export", Boolean(exported && fs.existsSync(exported.jsonPath) && fs.existsSync(exported.summaryPath)), exported ? {
    jsonPath: exported.jsonPath,
    summaryPath: exported.summaryPath,
  } : {}));

  const telegram = pause.review ? buildTelegramPayload({ cwd, id: pause.review.id, chatId: input.chatId || "charon-smoke" }) : null;
  checks.push(check("telegram-payload", Boolean(telegram?.message?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data), telegram ? {
    callback: telegram.message.reply_markup.inline_keyboard[0][0].callback_data,
  } : {}));

  const decision = pause.review ? applyTelegramDecision({
    cwd,
    callback: `charon:reject:${pause.review.id}`,
    actor: input.actor || "charon-smoke",
    reason: "smoke test rejection",
  }) : null;
  checks.push(check("telegram-decision", decision?.applied === true && decision?.item?.status === "rejected", decision ? {
    reviewId: decision.reviewId,
    status: decision.item.status,
    reviewPath: decision.reviewPath,
  } : {}));

  const ok = checks.every((item) => item.ok);
  return {
    schema: "charon.aeonSmoke.v1",
    ok,
    cwd,
    passSkill,
    pauseSkill,
    workflowPath: install.workflowPath,
    policyPath: install.policyPath,
    checks,
  };
}

function check(id, ok, details = {}) {
  return { id, ok: Boolean(ok), details };
}

module.exports = { runAeonSmoke };
