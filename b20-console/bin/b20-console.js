#!/usr/bin/env node
import { inspectB20 } from "../src/inspect.js";

async function main(argv) {
  const [command, ...args] = argv;
  if (command !== "inspect") return help();
  const address = args.find((arg) => !arg.startsWith("--"));
  if (!address) return help(1);
  const chain = readFlag(args, "--chain") || "base-sepolia";
  const rpcUrl = readFlag(args, "--rpc");
  const includeSource = args.includes("--source");
  const asJson = args.includes("--json");
  const report = await inspectB20({ address, chain, rpcUrl, includeSource });
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printReport(report);
}

function help(exitCode = 0) {
  console.log(`B20 Console

Usage:
  b20-console inspect <address> [--chain base-sepolia|vibenet|base] [--rpc <url>] [--source] [--json]

Example:
  npm run inspect -- 0xb200000000000000000000c7d17966dc5e587ba0 --chain base-sepolia
`);
  process.exitCode = exitCode;
}

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function printReport(report) {
  console.log("B20 Console");
  console.log("");
  console.log("chain");
  console.log(`  ${report.chain.name} (${report.chain.id})`);
  console.log(`  b20 features  ${report.chain.b20FeaturesActive ? "active" : "not active"}`);
  console.log(`  inspection    ${report.timing.mode} (${report.timing.durationMs}ms)`);
  console.log(`  risk          ${report.risk.level} (${report.risk.score})`);
  console.log("");
  console.log("token");
  console.log(`  address       ${report.token.address}`);
  console.log(`  is b20        ${report.token.isB20 ? "yes" : "no"}`);
  console.log(`  initialized   ${report.token.initialized ? "yes" : "no"}`);
  console.log(`  variant       ${report.token.variant}`);
  console.log(`  name          ${report.token.name ?? "-"}`);
  console.log(`  symbol        ${report.token.symbol ?? "-"}`);
  console.log(`  decimals      ${report.token.decimals ?? "-"}`);
  console.log(`  total supply  ${report.token.totalSupply ?? "-"}`);
  console.log(`  supply cap    ${report.token.supplyCap ?? "-"}`);
  console.log("");
  console.log("policies");
  for (const policy of report.policies) {
    console.log(`  ${policy.scope.padEnd(26)} ${policy.label ?? "-"} (${policy.id ?? "-"})`);
  }
  console.log("");
  console.log("pause");
  for (const item of report.pause) {
    console.log(`  ${item.feature.padEnd(8)} ${item.paused === null ? "-" : item.paused ? "paused" : "active"}`);
  }
  console.log("");
  console.log("permit");
  console.log(`  eip712 domain ${report.permit.eip712Domain ? "yes" : "no"}`);
  console.log(`  separator     ${report.permit.domainSeparator ?? "-"}`);
  console.log("");
  console.log("risk");
  if (report.risk.reasons.length === 0) {
    console.log("  no risk flags from deterministic_rules_v1");
  } else {
    for (const reason of report.risk.reasons) {
      console.log(`  ${reason.severity.padEnd(6)} ${reason.id} - ${reason.detail}`);
    }
  }
  console.log("");
  console.log("source");
  console.log(`  factory       ${report.source.factory}`);
  console.log(`  lookup        ${sourceLookupLabel(report.timing.sourceLookup)}`);
  console.log(`  created block ${report.source.creationBlock ?? "not loaded"}`);
  console.log(`  tx            ${report.source.creationTx ?? "not loaded"}`);
  if (report.errors.length > 0) {
    console.log("");
    console.log("warnings");
    for (const error of report.errors) console.log(`  ${error.code} ${error.step}: ${error.message}`);
  }
}

function sourceLookupLabel(status) {
  if (status === "included") return "loaded";
  if (status === "not_found") return "not found";
  if (status === "lookup_failed") return "lookup failed";
  return "not requested";
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
