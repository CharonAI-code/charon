// @ts-nocheck
"use strict";

const { decideAeonReview, exportAeonReview } = require("./review");

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

function applyTelegramDecision(input = {}) {
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
  return {
    decision: parsed.decision,
    reviewId: parsed.reviewId,
    applied: true,
    reviewPath: result.reviewPath,
    item: result.item,
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
  applyTelegramDecision,
  parseTelegramDecision,
};
