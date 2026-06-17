// @ts-nocheck
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { EXPORTS_DIR, REVIEWS_DIR, TELEGRAM_DIR } = require("./constants");

function createAeonReview(input) {
  if (input.decision.verdict !== "PAUSE") return null;
  const cwd = path.resolve(input.cwd || process.cwd());
  const id = `ar-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const receiptHash = input.receipt.receiptHash || hashObject(input.receipt);
  const item = signReview({
    schema: "charon.aeonReview.v1",
    id,
    status: "paused",
    createdAt: new Date().toISOString(),
    cwd,
    receiptPath: input.receiptPath,
    receiptHash,
    decision: {
      verdict: input.decision.verdict,
      reason: input.decision.reason,
      ruleId: input.decision.ruleId,
    },
    action: redactAction(input.action),
    source: {
      trigger: input.action?.metadata?.trigger || "",
      skill: input.action?.metadata?.skill || "",
      repo: input.action?.metadata?.repo || "",
      runId: input.action?.metadata?.runId || "",
      actor: input.action?.metadata?.actor || "",
    },
    links: aeonLinks(input.action?.metadata || {}),
    telegram: telegramMessage({ id, action: input.action, decision: input.decision, receiptPath: input.receiptPath }),
    history: [],
  });
  const reviewPath = writeReview(cwd, item);
  const telegramPath = writeTelegramMessage(cwd, item);
  return { id, reviewPath, telegramPath, item };
}

function listAeonReviews(input = {}) {
  const cwd = path.resolve(input.cwd || process.cwd());
  return reviewFiles(cwd).map((file) => loadAeonReview({ cwd, id: path.basename(file, ".json") }));
}

function loadAeonReview(input) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const file = path.join(cwd, REVIEWS_DIR, `${input.id}.json`);
  if (!fs.existsSync(file)) throw new Error(`Aeon review not found: ${input.id}`);
  const item = JSON.parse(fs.readFileSync(file, "utf8"));
  verifyReview(item);
  return { item, path: file };
}

function decideAeonReview(input) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const loaded = loadAeonReview({ cwd, id: input.id });
  const item = loaded.item;
  if (item.status !== "paused") throw new Error(`Aeon review is not paused: ${item.id}`);
  const status = input.decision === "approve" ? "approved" : "rejected";
  item.status = status;
  item.decidedAt = new Date().toISOString();
  item.decidedBy = input.actor || process.env.USER || "local";
  item.history = [...(item.history || []), { at: item.decidedAt, by: item.decidedBy, status, reason: input.reason || "" }];
  const signed = signReview(item);
  const reviewPath = writeReview(cwd, signed);
  return { item: signed, reviewPath };
}

function exportAeonReview(input = {}) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const target = input.id || "latest";
  const loaded = target === "latest" ? latestAeonReview({ cwd }) : loadAeonReview({ cwd, id: target });
  const item = loaded.item;
  const payload = {
    schema: "charon.aeonReviewExport.v1",
    exportedAt: new Date().toISOString(),
    reviewId: item.id,
    status: item.status,
    verdict: item.decision.verdict,
    reason: item.decision.reason,
    ruleId: item.decision.ruleId,
    skill: item.source.skill,
    trigger: item.source.trigger,
    repo: item.source.repo,
    runId: item.source.runId,
    actor: item.source.actor,
    receiptPath: item.receiptPath,
    receiptHash: item.receiptHash,
    reviewPath: loaded.path,
    links: item.links || {},
    telegram: item.telegram,
    commands: {
      approve: `charon aeon review approve ${item.id}`,
      reject: `charon aeon review reject ${item.id}`,
      inspect: `charon aeon review inspect ${item.id}`,
    },
  };
  const dir = path.join(cwd, EXPORTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, `${item.id}.json`);
  const summaryPath = path.join(dir, `${item.id}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(summaryPath, `${reviewSummary(payload)}\n`);
  if (input.githubOutput) appendGithubOutput(input.githubOutput, {
    charon_review_id: payload.reviewId,
    charon_review_status: payload.status,
    charon_review_json: jsonPath,
    charon_review_summary: summaryPath,
    charon_telegram_text: item.telegram,
  });
  return { payload, jsonPath, summaryPath };
}

function latestAeonReview(input = {}) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const files = reviewFiles(cwd);
  if (!files.length) throw new Error("no Aeon reviews found");
  return loadAeonReview({ cwd, id: path.basename(files[0], ".json") });
}

function reviewFiles(cwd) {
  const dir = path.join(cwd, REVIEWS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(dir, file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function reviewSummary(payload) {
  const lines = [
    "# Charon Aeon Review",
    "",
    `Review: ${payload.reviewId}`,
    `Status: ${payload.status}`,
    `Skill: ${payload.skill || "unknown"}`,
    `Verdict: ${payload.verdict}`,
    `Reason: ${payload.reason || "policy pause"}`,
  ];
  if (payload.links.githubRun) lines.push(`Run: ${payload.links.githubRun}`);
  lines.push("");
  lines.push("Telegram");
  lines.push("");
  lines.push("```");
  lines.push(payload.telegram || "");
  lines.push("```");
  return lines.join("\n");
}

function appendGithubOutput(file, values) {
  const lines = [];
  for (const [key, value] of Object.entries(values)) {
    const text = String(value || "");
    if (text.includes("\n")) {
      const marker = `CHARON_${crypto.randomBytes(4).toString("hex")}`;
      lines.push(`${key}<<${marker}`);
      lines.push(text);
      lines.push(marker);
    } else {
      lines.push(`${key}=${text}`);
    }
  }
  fs.appendFileSync(file, `${lines.join("\n")}\n`);
}

function writeReview(cwd, item) {
  const dir = path.join(cwd, REVIEWS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${item.id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(item, null, 2)}\n`);
  return file;
}

function writeTelegramMessage(cwd, item) {
  const dir = path.join(cwd, TELEGRAM_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${item.id}.txt`);
  fs.writeFileSync(file, `${item.telegram}\n`);
  return file;
}

function telegramMessage({ id, action, decision, receiptPath }) {
  const meta = action?.metadata || {};
  const lines = [
    `Charon paused Aeon skill: ${meta.skill || "unknown"}`,
    `Review: ${id}`,
    `Reason: ${decision.reason || "policy pause"}`,
  ];
  if (meta.repo) lines.push(`Repo: ${meta.repo}`);
  if (meta.runId) lines.push(`Run: ${meta.runId}`);
  lines.push(`Receipt: ${receiptPath}`);
  lines.push(`Approve/reject with: charon aeon review approve ${id} | charon aeon review reject ${id}`);
  return lines.join("\n");
}

function redactAction(action) {
  const copy = JSON.parse(JSON.stringify(action || {}));
  copy.args = redactValue(copy.args);
  if (Array.isArray(copy.resources)) {
    for (const resource of copy.resources) {
      if (resource.role === "secret" || /secret|token|api[_-]?key|password|credential/i.test(String(resource.source || ""))) {
        resource.value = "[REDACTED:secret]";
        if (resource.canonical) resource.canonical = "[REDACTED:secret]";
      }
    }
  }
  return copy;
}

function redactValue(value) {
  if (typeof value === "string") return isSecretString(value) ? "[REDACTED:secret]" : value;
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = /secret|token|api[_-]?key|password|credential/i.test(key) ? "[REDACTED:secret]" : redactValue(child);
    }
    return out;
  }
  return value;
}

function isSecretString(value) {
  return /(^|\/)\.env($|\.)|-----BEGIN [A-Z ]*PRIVATE KEY-----|github_pat_|gh[pousr]_|sk-[A-Za-z0-9_-]{16,}|sk-proj-|sk-ant-/i.test(value);
}

function aeonLinks(meta) {
  const links = {};
  if (meta.repo && meta.runId) links.githubRun = `https://github.com/${meta.repo}/actions/runs/${meta.runId}`;
  return links;
}

function signReview(item) {
  const body = { ...item };
  delete body.integrityHash;
  return { ...body, integrityHash: hashObject(body) };
}

function verifyReview(item) {
  const expected = signReview(item).integrityHash;
  if (item.integrityHash !== expected) throw new Error(`Aeon review verification failed: ${item.id}`);
}

function hashObject(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

module.exports = {
  createAeonReview,
  listAeonReviews,
  loadAeonReview,
  latestAeonReview,
  exportAeonReview,
  decideAeonReview,
};
