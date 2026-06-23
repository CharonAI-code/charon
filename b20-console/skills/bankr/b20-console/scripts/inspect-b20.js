#!/usr/bin/env node
"use strict";

const DEFAULT_API = "https://b20.charon.codes/api/inspect";
const MAX_UINT128 = "340282366920938463463374607431768211455";

function usage() {
  console.error("usage: node scripts/inspect-b20.js <address> [--chain base-sepolia|base] [--source] [--json]");
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    address: null,
    chain: "base-sepolia",
    source: false,
    json: false,
    api: process.env.B20_CONSOLE_API || DEFAULT_API,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--chain") {
      args.chain = argv[++i];
    } else if (arg === "--source") {
      args.source = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--api") {
      args.api = argv[++i];
    } else if (!args.address) {
      args.address = arg;
    } else {
      usage();
    }
  }

  if (!args.address || !args.chain || !args.api) usage();
  return args;
}

function asText(value, fallback = "-") {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function featuresState(activation) {
  if (!activation) return "unknown";
  return activation.asset || activation.stablecoin ? "active" : "inactive";
}

function formatSupplyCap(token) {
  const value = token.supplyCapFormatted || token.supplyCap;
  if (String(value) === MAX_UINT128) return "unbounded";
  return asText(value);
}

function policySummary(report) {
  const entries = Array.isArray(report.policies) ? report.policies : Object.values(report.policies || {});
  if (entries.length === 0) return ["policies: not loaded"];
  return entries.map((value) => {
    const scope = value?.scope || "policy";
    const label = value?.label || value?.policyId || value?.id || "unknown";
    return `${scope}: ${label}`;
  });
}

function pauseSummary(report) {
  const entries = Array.isArray(report.pause) ? report.pause : Object.values(report.pause || {});
  if (entries.length === 0) return ["pause: not loaded"];
  return entries.map((value) => `${value?.feature || "feature"}: ${value?.paused ? "paused" : "active"}`);
}

function format(report) {
  const risk = report.risk || {};
  const token = report.token || {};
  const source = report.source || {};
  const reasons = Array.isArray(risk.reasons) ? risk.reasons : [];

  const lines = [];
  lines.push(`B20 Console result: ${asText(risk.level, "unknown")} risk (${asText(risk.score, "unknown")})`);
  lines.push("");
  lines.push("State:");
  lines.push(`- B20: ${token.isB20 ? "yes" : "no"}`);
  lines.push(`- initialized: ${token.initialized ? "yes" : "no"}`);
  lines.push(`- features: ${featuresState(report.activation)}`);
  lines.push(`- token: ${asText(token.name)} (${asText(token.symbol)})`);
  lines.push(`- supply cap: ${formatSupplyCap(token)}`);

  lines.push("");
  lines.push("Risk flags:");
  if (reasons.length === 0) {
    lines.push("- none");
  } else {
    for (const reason of reasons) {
      lines.push(`- ${asText(reason.id || reason.code)}: ${asText(reason.detail || reason.message || reason.summary || reason.description)}`);
    }
  }

  lines.push("");
  lines.push("Policies:");
  for (const line of policySummary(report)) lines.push(`- ${line}`);

  lines.push("");
  lines.push("Pause:");
  for (const line of pauseSummary(report)) lines.push(`- ${line}`);

  if (source.transactionHash || source.createdBlock) {
    lines.push("");
    lines.push("Source:");
    lines.push(`- block: ${asText(source.createdBlock)}`);
    lines.push(`- tx: ${asText(source.transactionHash)}`);
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = new URL(args.api);
  url.searchParams.set("chain", args.chain);
  url.searchParams.set("address", args.address);
  if (args.source) url.searchParams.set("source", "1");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload?.error?.code || payload?.code || `HTTP_${response.status}`;
    const message = payload?.error?.message || payload?.message || response.statusText;
    if (args.json) {
      process.stdout.write(`${JSON.stringify(payload || { code, message }, null, 2)}\n`);
    } else {
      process.stdout.write(`B20 Console result: ${code}\n${message}\n`);
    }
    process.exit(1);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(format(payload));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
