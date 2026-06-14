// -nocheck
// @ts-nocheck
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { startMcpProxy, startMcpServer } = require("../../mcp");

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
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const configPath = path.join(codexHome, "config.toml");
  ensureDir(codexHome);
  let config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const guarded = guardCodexMcpConfig(config);
  config = guarded.config;
  config = upsertFeature(config, "shell_tool", false);
  config = upsertCharonMcpBlock(config, process.cwd());
  backupCodexConfig(configPath);
  fs.writeFileSync(configPath, config);
  if (opts.quiet) return;
  console.log("Charon enforce mode enabled for Codex.");
  console.log(`Guarded MCP servers: ${guarded.guarded}`);
  console.log(`Already guarded: ${guarded.already}`);
  console.log(`Skipped MCP servers: ${guarded.skipped}`);
  console.log(`Config: ${configPath}`);
  console.log("Restart Codex so native shell is disabled and Charon MCP is loaded.");
  enforceStatusCommand();
}

function enforceRestoreCommand(opts = {}) {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const configPath = path.join(codexHome, "config.toml");
  if (!fs.existsSync(configPath)) {
    console.log("No Codex config found.");
    return;
  }
  let config = fs.readFileSync(configPath, "utf8");
  const restored = unguardCodexMcpConfig(config);
  config = removeCharonMcpBlock(restored.config);
  config = removeFeature(config, "shell_tool");
  fs.writeFileSync(configPath, config);
  if (opts.quiet) return;
  console.log("Charon enforce mode removed from Codex.");
  console.log(`Restored MCP servers: ${restored.restored}`);
  console.log(`Skipped MCP servers: ${restored.skipped}`);
  console.log("Restart Codex to restore native shell behavior.");
}

function enforceStatusCommand(opts = {}) {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const configPath = path.join(codexHome, "config.toml");
  const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const shellDisabled = /^\s*shell_tool\s*=\s*false\s*$/m.test(config);
  const report = codexEnforcementReport(config, process.cwd());
  if (opts.quiet) return { shellDisabled, ...report };
  console.log("Charon Codex enforcement");
  console.log(`${shellDisabled ? "OK " : "NO "} native shell disabled`);
  console.log(`${report.charonInstalled ? "OK " : "NO "} Charon MCP installed`);
  console.log(`${report.charonRequired ? "OK " : "WARN"} Charon MCP required`);
  console.log(`${report.charonCommandValid ? "OK " : "WARN"} Charon MCP command valid`);
  console.log(`${report.charonServerValid ? "OK " : "WARN"} Charon MCP server target valid`);
  console.log(`${report.charonCwdValid ? "OK " : "WARN"} Charon MCP cwd points here`);
  console.log(`${report.openMcp === 0 ? "OK " : "WARN"} external MCP open=${report.openMcp} guarded=${report.guardedMcp}`);
  console.log(`${shellDisabled && report.enforced ? "ENFORCED" : "NOT ENFORCED"}`);
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

function mcpServerCommand(args) {
  const cwdFlag = args.indexOf("--cwd");
  const cwd = cwdFlag >= 0 ? args[cwdFlag + 1] : process.cwd();
  const allowed = cwdFlag >= 0 ? args.filter((_, index) => index !== cwdFlag && index !== cwdFlag + 1) : args;
  if (allowed.length || (cwdFlag >= 0 && !cwd)) throw new Error("usage: charon mcp server [--cwd <path>]");
  startMcpServer({ cwd: path.resolve(cwd) });
}

function mcpInstallCommand(args) {
  const host = args[0];
  if (host !== "codex") throw new Error("usage: charon mcp install codex");
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const configPath = path.join(codexHome, "config.toml");
  ensureDir(codexHome);
  let config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  config = upsertCharonMcpBlock(config, process.cwd());
  backupCodexConfig(configPath);
  fs.writeFileSync(configPath, config);
  console.log(`Installed Charon MCP server in ${configPath}`);
  console.log("Restart Codex so it can load the new MCP server.");
}

function mcpGuardCommand(args) {
  if (args[0] !== "codex") throw new Error("usage: charon mcp guard codex");
  const configPath = codexConfigPath();
  ensureDir(path.dirname(configPath));
  let config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const result = guardCodexMcpConfig(config);
  config = upsertCharonMcpBlock(result.config, process.cwd());
  backupCodexConfig(configPath);
  fs.writeFileSync(configPath, config);
  console.log(`Guarded MCP servers: ${result.guarded}`);
  console.log(`Already guarded: ${result.already}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Config: ${configPath}`);
  console.log("Restart Codex so MCP changes take effect.");
}

function mcpStatusCommand(args) {
  if (args[0] !== "codex") throw new Error("usage: charon mcp status codex");
  const configPath = codexConfigPath();
  const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const sections = parseMcpSections(config);
  let guarded = 0;
  let unguarded = 0;
  let skipped = 0;
  for (const section of sections) {
    if (section.name === "charon") {
      skipped++;
      continue;
    }
    if (isGuardedMcpSection(section.body)) {
      guarded++;
      console.log(`GUARDED ${section.name}`);
    } else {
      unguarded++;
      console.log(`OPEN    ${section.name}`);
    }
  }
  console.log(`Summary: guarded=${guarded} open=${unguarded} skipped=${skipped}`);
}

function mcpUnguardCommand(args) {
  if (args[0] !== "codex") throw new Error("usage: charon mcp unguard codex");
  const configPath = codexConfigPath();
  if (!fs.existsSync(configPath)) {
    console.log("No Codex config found.");
    return;
  }
  const config = fs.readFileSync(configPath, "utf8");
  const result = unguardCodexMcpConfig(config);
  fs.writeFileSync(configPath, removeCharonMcpBlock(result.config));
  console.log(`Restored MCP servers: ${result.restored}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Config: ${configPath}`);
  console.log("Restart Codex so MCP changes take effect.");
}

function mcpWrapCommand(args) {
  const config = wrappedMcpConfig(args);
  console.log(JSON.stringify(config, null, 2));
}

function codexConfigPath() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "config.toml");
}

function backupCodexConfig(configPath) {
  if (!fs.existsSync(configPath)) return;
  const backupPath = `${configPath}.charon.bak`;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(configPath, backupPath);
}

function upsertCharonMcpBlock(config, cwd) {
  const block = [
    "",
    "# >>> charon",
    "[mcp_servers.charon]",
    `command = ${JSON.stringify(process.execPath)}`,
    `args = [${[cliPath(), "mcp", "server", "--cwd", cwd].map((item) => JSON.stringify(item)).join(", ")}]`,
    "required = true",
    "# <<< charon",
    "",
  ].join("\n");
  const pattern = /(?:\n)?# >>> charon[\s\S]*?# <<< charon(?:\n)?/m;
  return pattern.test(config) ? config.replace(pattern, block) : `${config.replace(/\s*$/g, "")}${block}`;
}

function removeCharonMcpBlock(config) {
  return config.replace(/(?:\n)?# >>> charon[\s\S]*?# <<< charon(?:\n)?/m, "\n").replace(/\n{3,}/g, "\n\n");
}

function upsertFeature(config, key, value) {
  const rendered = `${key} = ${value ? "true" : "false"}`;
  const featureRe = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(?:true|false)\\s*$`, "m");
  if (featureRe.test(config)) return config.replace(featureRe, rendered);
  const header = /^\[features\]\s*$/m;
  if (header.test(config)) return config.replace(header, `[features]\n${rendered}`);
  return `${config.replace(/\s*$/g, "")}\n\n[features]\n${rendered}\n`;
}

function codexEnforcementReport(config, cwd) {
  const sections = parseMcpSections(config);
  const charon = sections.find((section) => section.name === "charon");
  const command = charon ? readTomlString(charon.body, "command") : "";
  const args = charon ? readTomlArray(charon.body, "args") : [];
  let guardedMcp = 0;
  let openMcp = 0;
  for (const section of sections) {
    if (section.name === "charon") continue;
    if (isGuardedMcpSection(section.body)) guardedMcp++;
    else openMcp++;
  }
  const cwdIndex = args.indexOf("--cwd");
  const charonInstalled = Boolean(charon);
  const charonRequired = Boolean(charon && /^\s*required\s*=\s*true\s*$/m.test(charon.body));
  const charonCommandValid = command === process.execPath;
  const charonCwdValid = cwdIndex >= 0 && args[cwdIndex + 1] === cwd;
  const charonServerValid = args.includes(cliPath()) && args.includes("mcp") && args.includes("server");
  const enforced = charonInstalled && charonRequired && charonCommandValid && charonCwdValid && charonServerValid && openMcp === 0;
  return { charonInstalled, charonRequired, charonCommandValid, charonCwdValid, charonServerValid, guardedMcp, openMcp, enforced };
}

function removeFeature(config, key) {
  const featureRe = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(?:true|false)\\s*\\n?`, "m");
  return config.replace(featureRe, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function guardCodexMcpConfig(config) {
  let guarded = 0;
  let already = 0;
  let skipped = 0;
  const sections = parseMcpSections(config);
  let output = "";
  let cursor = 0;
  for (const section of sections) {
    output += config.slice(cursor, section.start);
    if (section.name === "charon") {
      skipped++;
      output += section.text;
    } else if (isGuardedMcpSection(section.body)) {
      already++;
      output += section.text;
    } else {
      const command = readTomlString(section.body, "command");
      const args = readTomlArray(section.body, "args");
      if (!command) {
        skipped++;
        output += section.text;
      } else {
        guarded++;
        output += rewriteMcpSectionAsGuarded(section, command, args);
      }
    }
    cursor = section.end;
  }
  output += config.slice(cursor);
  return { config: output, guarded, already, skipped };
}

function unguardCodexMcpConfig(config) {
  let restored = 0;
  let skipped = 0;
  const sections = parseMcpSections(config);
  let output = "";
  let cursor = 0;
  for (const section of sections) {
    output += config.slice(cursor, section.start);
    if (section.name === "charon" || !isGuardedMcpSection(section.body)) {
      skipped++;
      output += section.text;
    } else {
      const command = readMarkerJson(section.body, "charon.original_command");
      const args = readMarkerJson(section.body, "charon.original_args") || [];
      if (!command || !Array.isArray(args)) {
        skipped++;
        output += section.text;
      } else {
        restored++;
        output += rewriteMcpSectionAsOriginal(section, command, args);
      }
    }
    cursor = section.end;
  }
  output += config.slice(cursor);
  return { config: output, restored, skipped };
}

function parseMcpSections(config) {
  const matches = [...config.matchAll(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*$/gm)];
  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = index + 1 < matches.length ? matches[index + 1].index || config.length : config.length;
    const text = config.slice(start, end);
    const headerEnd = text.indexOf("\n");
    const body = headerEnd >= 0 ? text.slice(headerEnd + 1) : "";
    return { name: match[1], start, end, text, body };
  });
}

function isGuardedMcpSection(body) {
  return /#\s*charon\.guarded\s*=\s*true/.test(body) || /"mcp",\s*"proxy"/.test(body);
}

function rewriteMcpSectionAsGuarded(section, command, args) {
  const lines = section.text.split("\n");
  const out = [];
  let inRootSection = true;
  const originalLines = rootCommandLines(section);
  for (const line of lines) {
    if (line.trim().startsWith("[") && line.trim() !== `[mcp_servers.${section.name}]`) inRootSection = false;
    if (inRootSection && (/^\s*command\s*=/.test(line) || /^\s*args\s*=/.test(line))) {
      originalLines.push(line);
      continue;
    }
    if (inRootSection && /^\s*#\s*charon\./.test(line)) continue;
    out.push(line);
    if (line.trim() === `[mcp_servers.${section.name}]`) {
      out.push("# charon.guarded = true");
      out.push(`# charon.original_command = ${JSON.stringify(command)}`);
      out.push(`# charon.original_args = ${JSON.stringify(args)}`);
      out.push(`# charon.original_lines = ${JSON.stringify(originalLines)}`);
      out.push(`command = ${JSON.stringify(process.execPath)}`);
      out.push(`args = [${[cliPath(), "mcp", "proxy", "--", command, ...args].map((item) => JSON.stringify(item)).join(", ")}]`);
    }
  }
  return out.join("\n");
}

function rootCommandLines(section) {
  const out = [];
  for (const line of section.text.split("\n")) {
    if (line.trim().startsWith("[") && line.trim() !== `[mcp_servers.${section.name}]`) break;
    if (/^\s*(?:command|args)\s*=/.test(line)) out.push(line);
  }
  return out;
}

function rewriteMcpSectionAsOriginal(section, command, args) {
  const lines = section.text.split("\n");
  const out = [];
  let inRootSection = true;
  const originalLines = readMarkerJson(section.body, "charon.original_lines");
  for (const line of lines) {
    if (line.trim().startsWith("[") && line.trim() !== `[mcp_servers.${section.name}]`) inRootSection = false;
    if (inRootSection && (/^\s*command\s*=/.test(line) || /^\s*args\s*=/.test(line) || /^\s*#\s*charon\./.test(line))) continue;
    out.push(line);
    if (line.trim() === `[mcp_servers.${section.name}]`) {
      if (Array.isArray(originalLines) && originalLines.every((item) => typeof item === "string")) {
        out.push(...originalLines);
      } else {
        out.push(`command = ${JSON.stringify(command)}`);
        out.push(`args = [${args.map((item) => JSON.stringify(item)).join(", ")}]`);
      }
    }
  }
  return out.join("\n");
}

function readTomlString(body, key) {
  const match = body.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*$`, "m"));
  if (!match) return "";
  try {
    return JSON.parse(match[1]);
  } catch {
    return "";
  }
}

function readTomlArray(body, key) {
  const match = body.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(\\[[^\\n]*\\])\\s*$`, "m"));
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function readMarkerJson(body, key) {
  const match = body.match(new RegExp(`^\\s*#\\s*${escapeRegExp(key)}\\s*=\\s*(.+?)\\s*$`, "m"));
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}


function cliPath() {
  return path.resolve(__dirname, "..", "..", "..", "..", "bin", "charon.js");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = { enforceCommand, mcpCommand };
