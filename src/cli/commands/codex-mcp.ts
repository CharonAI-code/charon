// -nocheck
// @ts-nocheck
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { runCodexHook } = require("../../codex/hooks");
const { startMcpProxy, startMcpServer } = require("../../mcp");
const {
  guardCodexMcp,
  installCharonMcp,
  installCodexEnforcement,
  mcpServerStatus,
  readEnforcementReport,
  restoreCodexEnforcement,
  unguardCodexMcp,
} = require("../../codex/enforcement");

function enforceCommand(args) {
  const quiet = args.includes("--quiet");
  const filtered = args.filter((arg) => arg !== "--quiet");
  const [sub] = filtered;
  if (sub === "codex") return enforceCodexCommand({ quiet });
  if (sub === "restore") return enforceRestoreCommand({ quiet });
  if (sub === "status" || !sub) return enforceStatusCommand({ quiet });
  throw new Error("usage: charon enforce codex | status | restore");
}

function enforceCodexCommand(opts = {}) {
  const result = installCodexEnforcement(codexTargetInput());
  if (opts.quiet) return;
  console.log("Charon exclusive enforcement enabled for Codex.");
  console.log(`Guarded MCP servers: ${result.guarded}`);
  console.log(`Already guarded: ${result.already}`);
  console.log(`Skipped MCP servers: ${result.skipped}`);
  console.log(`Removed native bypasses: ${result.removedNativeBypasses}`);
  console.log(`Config: ${result.configPath}`);
  console.log("Restart Codex so native shell/runtime changes take effect.");
  enforceStatusCommand();
}

function enforceRestoreCommand(opts = {}) {
  const result = restoreCodexEnforcement(codexTargetInput());
  if (!result) {
    console.log("No Codex config found.");
    return;
  }
  if (result.restoredFromBackup) {
    if (opts.quiet) return;
    console.log("Charon enforce mode removed from Codex.");
    console.log(`Restored config from backup: ${result.backupPath}`);
    console.log("Restart Codex to restore native behavior.");
    return;
  }
  if (opts.quiet) return;
  console.log("Charon enforce mode removed from Codex.");
  console.log(`Restored MCP servers: ${result.restoredMcp}`);
  console.log(`Skipped MCP servers: ${result.skippedMcp}`);
  console.log("Restart Codex to restore native shell behavior.");
}

function enforceStatusCommand(opts = {}) {
  const report = readEnforcementReport(codexTargetInput());
  if (opts.quiet) return report;
  console.log("Charon Codex enforcement");
  console.log((report.hooksEnabled ? "OK " : "NO ") + " hooks feature enabled");
  console.log((report.hooksInstalled ? "OK " : "NO ") + " Charon hooks installed");
  console.log((report.hooksTargetValid ? "OK " : "WARN") + " Charon hooks target valid");
  console.log((report.bundledBypassPlugins === 0 ? "OK " : "NO ") + " bundled bypass plugins enabled=" + report.bundledBypassPlugins);
  console.log(`${report.configValid ? "OK " : "NO "} Codex config valid${report.configError ? ` - ${report.configError}` : ""}`);
  console.log(`${report.shellDisabled ? "OK " : "NO "} native shell disabled`);
  console.log(`${report.jsReplDisabled ? "OK " : "NO "} local JS runtime disabled`);
  console.log(`${report.nativeBypassMcp === 0 ? "OK " : "NO "} native bypass MCP open=${report.nativeBypassMcp}`);
  console.log(`${report.charonInstalled ? "OK " : "NO "} Charon MCP installed`);
  console.log(`${report.charonRequired ? "OK " : "WARN"} Charon MCP required`);
  console.log(`${report.charonCommandValid ? "OK " : "WARN"} Charon MCP command valid`);
  console.log(`${report.charonServerValid ? "OK " : "WARN"} Charon MCP server target valid`);
  console.log(`${report.charonCwdValid ? "OK " : "WARN"} Charon MCP cwd points here`);
  console.log(`${report.openMcp === 0 ? "OK " : "WARN"} external MCP open=${report.openMcp} guarded=${report.guardedMcp}`);
  console.log(`${report.enforced ? "ENFORCED" : "NOT ENFORCED"}`);
}

function mcpCommand(args) {
  const [sub, ...rest] = args;
  if (sub === "server") return mcpServerCommand(rest);
  if (sub === "install") return mcpInstallCommand(rest);
  if (sub === "guard") return mcpGuardCommand(rest);
  if (sub === "status") return mcpStatusCommand(rest);
  if (sub === "unguard") return mcpUnguardCommand(rest);
  if (sub === "wrap") return mcpWrapCommand(rest);
  if (sub === "config") return mcpConfigCommand(rest);
  if (sub !== "proxy") throw new Error("usage: charon mcp server | charon mcp install codex | charon mcp guard codex | charon mcp status codex | charon mcp unguard codex | charon mcp wrap <name> -- <mcp-server-command> | charon mcp config <name> -- <mcp-server-command> | charon mcp proxy -- <mcp-server-command>");
  const sep = rest.indexOf("--");
  const command = sep >= 0 ? rest.slice(sep + 1) : rest;
  if (!command.length) throw new Error("usage: charon mcp proxy -- <mcp-server-command>");
  startMcpProxy({
    command: command[0],
    args: command.slice(1),
    cwd: process.cwd(),
  });
}

async function codexCommand(args) {
  const [sub, event] = args;
  if (sub !== "hook") throw new Error("usage: charon codex hook pre-tool-use|permission-request|post-tool-use");
  if (!["pre-tool-use", "permission-request", "post-tool-use"].includes(event)) {
    throw new Error("usage: charon codex hook pre-tool-use|permission-request|post-tool-use");
  }
  const code = await runCodexHook(event);
  process.exitCode = code;
}

function mcpServerCommand(args) {
  const cwdFlag = args.indexOf("--cwd");
  const policyFlag = args.indexOf("--policy");
  const receiptsFlag = args.indexOf("--receipts-dir");
  const cwd = cwdFlag >= 0 ? args[cwdFlag + 1] : process.cwd();
  const policyPath = policyFlag >= 0 ? args[policyFlag + 1] : undefined;
  const receiptsDir = receiptsFlag >= 0 ? args[receiptsFlag + 1] : undefined;
  const consumed = new Set();
  for (const flag of [cwdFlag, policyFlag, receiptsFlag]) {
    if (flag >= 0) {
      consumed.add(flag);
      consumed.add(flag + 1);
    }
  }
  const allowed = args.filter((_, index) => !consumed.has(index));
  if (allowed.length || (cwdFlag >= 0 && !cwd) || (policyFlag >= 0 && !policyPath) || (receiptsFlag >= 0 && !receiptsDir)) {
    throw new Error("usage: charon mcp server [--cwd <path>] [--policy <path>] [--receipts-dir <path>]");
  }
  startMcpServer({
    cwd: path.resolve(cwd),
    policyPath: policyPath ? path.resolve(policyPath) : undefined,
    receiptsDir: receiptsDir ? path.resolve(receiptsDir) : undefined,
  });
}

function mcpInstallCommand(args) {
  const host = args[0];
  if (host !== "codex") throw new Error("usage: charon mcp install codex");
  const configPath = installCharonMcp(codexTargetInput());
  console.log(`Installed Charon MCP server in ${configPath}`);
  console.log("Restart Codex so it can load the new MCP server.");
}

function mcpGuardCommand(args) {
  if (args[0] !== "codex") throw new Error("usage: charon mcp guard codex");
  const result = guardCodexMcp(codexTargetInput());
  console.log(`Guarded MCP servers: ${result.guarded}`);
  console.log(`Already guarded: ${result.already}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Config: ${result.configPath}`);
  console.log("Restart Codex so MCP changes take effect.");
}

function mcpStatusCommand(args) {
  if (args[0] !== "codex") throw new Error("usage: charon mcp status codex");
  let guarded = 0;
  let unguarded = 0;
  let skipped = 0;
  for (const server of mcpServerStatus(codexTargetInput())) {
    if (server.skipped) {
      skipped++;
      continue;
    }
    if (server.guarded) {
      guarded++;
      console.log(`GUARDED ${server.name}`);
    } else {
      unguarded++;
      console.log(`OPEN    ${server.name}`);
    }
  }
  console.log(`Summary: guarded=${guarded} open=${unguarded} skipped=${skipped}`);
}

function mcpUnguardCommand(args) {
  if (args[0] !== "codex") throw new Error("usage: charon mcp unguard codex");
  const result = unguardCodexMcp(codexTargetInput());
  if (!fs.existsSync(result.configPath)) {
    console.log("No Codex config found.");
    return;
  }
  console.log(`Restored MCP servers: ${result.restored}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Config: ${result.configPath}`);
  console.log("Restart Codex so MCP changes take effect.");
}

function mcpWrapCommand(args) {
  const config = wrappedMcpConfig(args);
  console.log(JSON.stringify(config, null, 2));
}

function codexTargetInput() {
  return {
    codexHome: process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    cwd: process.cwd(),
    nodePath: process.execPath,
    cliPath: cliPath(),
  };
}

function mcpConfigCommand(args) {
  const name = args[0];
  if (name === "charon") {
    const config = {
      mcpServers: {
        charon: {
          command: process.execPath,
          args: [cliPath(), "mcp", "server", "--cwd", process.cwd()],
        },
      },
    };
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  if (!name || name.startsWith("-")) {
    throw new Error("usage: charon mcp config charon | charon mcp config <name> -- <mcp-server-command>");
  }
  console.log(JSON.stringify(wrappedMcpConfig(args), null, 2));
}

function wrappedMcpConfig(args) {
  const sep = args.indexOf("--");
  const name = args[0];
  const command = sep >= 0 ? args.slice(sep + 1) : [];
  if (!name || name.startsWith("-") || !command.length) {
    throw new Error("usage: charon mcp wrap <name> -- <mcp-server-command>");
  }
  const config = {
    mcpServers: {
      [name]: {
        command: process.execPath,
        args: [cliPath(), "mcp", "proxy", "--", ...command],
      },
    },
  };
  return config;
}


function cliPath() {
  return path.resolve(__dirname, "..", "..", "..", "..", "bin", "charon.js");
}

module.exports = { codexCommand, enforceCommand, mcpCommand };
