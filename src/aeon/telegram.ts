// @ts-nocheck
"use strict";

const { decideAeonReview, denyTelegramMessage, exportAeonReview } = require("./review");

function buildTelegramPayload(input = {}) {
  const exported = exportAeonReview({ cwd: input.cwd, id: input.id || "latest" });
  const payload = exported.payload;
  const message = {
    method: "sendMessage",
    chat_id: input.chatId || "${TELEGRAM_CHAT_ID}",
    text: payload.telegram,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Approve", callback_data: `charon:approve:${payload.reviewId}` },
          { text: "Reject", callback_data: `charon:reject:${payload.reviewId}` },
        ],
        [
          { text: "Inspect", callback_data: `charon:inspect:${payload.reviewId}` },
        ],
      ],
    },
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  return { message, review: payload, export: exported };
}

function buildDenyTelegramPayload(input = {}) {
  const preflight = input.preflight || {};
  const payload = {
    schema: "charon.aeonDenyTelegram.v1",
    verdict: "DENY",
    receiptPath: preflight.receiptPath,
    reason: preflight.reason,
    ruleId: preflight.ruleId,
    telegram: denyTelegramMessage({
      action: preflight.action,
      decision: {
        verdict: "DENY",
        reason: preflight.reason,
        ruleId: preflight.ruleId,
      },
      receiptPath: preflight.receiptPath,
    }),
  };
  const message = {
    method: "sendMessage",
    chat_id: input.chatId || "${TELEGRAM_CHAT_ID}",
    text: payload.telegram,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  return { message, payload };
}

async function sendTelegramMessage(input = {}) {
  const token = input.token || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = input.chatId || process.env.TELEGRAM_CHAT_ID;
  const dryRun = Boolean(input.dryRun);
  const message = { ...input.message, chat_id: chatId || input.message?.chat_id };
  if (dryRun || !token || !chatId) {
    return { sent: false, dryRun: true, message };
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(`Telegram send failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return { sent: true, response: body, message };
}

async function applyTelegramDecision(input = {}) {
  const parsed = parseTelegramDecision(input.callback || input.text || "");
  if (!parsed) throw new Error("no Charon Telegram decision found");
  if (parsed.decision === "inspect") {
    return { decision: "inspect", reviewId: parsed.reviewId, applied: false };
  }
  const result = decideAeonReview({
    cwd: input.cwd,
    id: parsed.reviewId,
    decision: parsed.decision,
    actor: input.actor || input.from || "telegram",
    reason: input.reason || "telegram decision",
  });
  let rerun = null;
  if (input.rerun && parsed.decision === "approve") {
    rerun = await dispatchApprovedAeonRun({
      review: result.item,
      token: input.githubToken || process.env.GITHUB_TOKEN,
      repo: input.repo || result.item?.source?.repo || process.env.GITHUB_REPOSITORY,
      ref: input.ref || process.env.GITHUB_REF_NAME || "main",
      workflow: input.workflow || "aeon.yml",
    });
  }
  return {
    decision: parsed.decision,
    reviewId: parsed.reviewId,
    applied: true,
    reviewPath: result.reviewPath,
    item: result.item,
    rerun,
  };
}

async function dispatchApprovedAeonRun(input = {}) {
  const review = input.review || {};
  const repo = input.repo;
  const token = input.token;
  if (!repo) throw new Error("cannot rerun Aeon task: missing GitHub repository");
  if (!token) throw new Error("cannot rerun Aeon task: missing GITHUB_TOKEN");
  const args = review.action?.args || {};
  const inputs = {
    skill: String(args.skill || review.source?.skill || ""),
    var: String(args.var || ""),
  };
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${input.workflow || "aeon.yml"}/dispatches`, {
    method: "POST",
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ ref: input.ref || "main", inputs }),
  });
  if (response.status !== 204) {
    const text = await response.text().catch(() => "");
    throw new Error(`GitHub workflow dispatch failed: ${response.status} ${text}`);
  }
  return {
    repo,
    workflow: input.workflow || "aeon.yml",
    ref: input.ref || "main",
    inputs,
    dispatched: true,
  };
}

function parseTelegramDecision(raw) {
  const text = String(raw || "").trim();
  const callback = text.match(/^charon:(approve|reject|inspect):(ar-[A-Za-z0-9_-]+)$/i);
  if (callback) return { decision: normalizeDecision(callback[1]), reviewId: callback[2] };
  const command = text.match(/(?:^|\s)\/?charon\s+(approve|reject|inspect)\s+(ar-[A-Za-z0-9_-]+)/i) ||
    text.match(/(?:^|\s)(approve|reject|inspect)\s+(ar-[A-Za-z0-9_-]+)/i);
  if (command) return { decision: normalizeDecision(command[1]), reviewId: command[2] };
  return null;
}

function normalizeDecision(value) {
  const decision = String(value).toLowerCase();
  if (decision === "approve") return "approve";
  if (decision === "reject") return "reject";
  return "inspect";
}

module.exports = {
  buildTelegramPayload,
  buildDenyTelegramPayload,
  sendTelegramMessage,
  applyTelegramDecision,
  parseTelegramDecision,
};
