import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  atomicWriteConfig,
  guardCodexMcpServers,
  listMcpServers,
  parseCodexConfig,
  readConfigFile,
  removeCharonMcpServer,
  removeFeature,
  removeNativeBypassServers,
  setCharonHooks,
  setCharonMcpServer,
  setCodexHardening,
  setFeature,
  targetFromValues,
  unguardCodexMcpServers,
  validateCodexConfig,
  writeBackups,
  type CharonMcpTarget,
} from "./config";

export interface CodexPaths {
  codexHome: string;
  configPath: string;
}

export interface EnforcementInstallResult {
  configPath: string;
  guarded: number;
  already: number;
  skipped: number;
  removedNativeBypasses: number;
  report: EnforcementReport;
}

export interface RestoreResult {
  restoredFromBackup: boolean;
  backupPath?: string;
  restoredMcp: number;
  skippedMcp: number;
}

export interface EnforcementReport {
  configValid: boolean;
  configError?: string;
  shellDisabled: boolean;
  jsReplDisabled: boolean;
  hooksEnabled: boolean;
  hooksInstalled: boolean;
  hooksTargetValid: boolean;
  bundledBypassPlugins: number;
  nativeBypassMcp: number;
  charonInstalled: boolean;
  charonRequired: boolean;
  charonCommandValid: boolean;
  charonServerValid: boolean;
  charonCwdValid: boolean;
  guardedMcp: number;
  openMcp: number;
  enforced: boolean;
}

export function codexPaths(codexHome: string): CodexPaths {
  return {
    codexHome,
    configPath: join(codexHome, "config.toml"),
  };
}

export function installCodexEnforcement(input: {
  codexHome: string;
  cwd: string;
  nodePath: string;
  cliPath: string;
}): EnforcementInstallResult {
  const paths = codexPaths(input.codexHome);
  mkdirSync(paths.codexHome, { recursive: true });
  const target = targetFromValues(input.nodePath, input.cliPath, input.cwd);
  const original = readConfigFile(paths.configPath);
  validateCodexConfig(original);

  let config = original;
  const removed = removeNativeBypassServers(config);
  config = removed.config;
  const guarded = guardCodexMcpServers(config, target);
  config = guarded.config;
  config = setFeature(config, "shell_tool", false);
  config = setFeature(config, "js_repl", false);
  config = setCodexHardening(config);
  config = setCharonHooks(config, target);
  config = setCharonMcpServer(config, target);
  validateCodexConfig(config);

  writeBackups(paths.configPath, original);
  atomicWriteConfig(paths.configPath, config);

  const written = readConfigFile(paths.configPath);
  validateCodexConfig(written);
  const report = enforcementReport(written, target);
  if (!report.enforced) {
    throw new Error(`generated Codex config is not enforced: ${failedReportReasons(report).join(", ")}`);
  }

  return {
    configPath: paths.configPath,
    guarded: guarded.guarded,
    already: guarded.already,
    skipped: guarded.skipped,
    removedNativeBypasses: removed.removed,
    report,
  };
}

export function installCharonMcp(input: {
  codexHome: string;
  cwd: string;
  nodePath: string;
  cliPath: string;
}): string {
  const paths = codexPaths(input.codexHome);
  mkdirSync(paths.codexHome, { recursive: true });
  const target = targetFromValues(input.nodePath, input.cliPath, input.cwd);
  const original = readConfigFile(paths.configPath);
  validateCodexConfig(original);
  const config = setCharonMcpServer(original, target);
  validateCodexConfig(config);
  writeBackups(paths.configPath, original);
  atomicWriteConfig(paths.configPath, config);
  validateCodexConfig(readConfigFile(paths.configPath));
  return paths.configPath;
}

export function guardCodexMcp(input: {
  codexHome: string;
  cwd: string;
  nodePath: string;
  cliPath: string;
}): EnforcementInstallResult {
  const paths = codexPaths(input.codexHome);
  mkdirSync(dirname(paths.configPath), { recursive: true });
  const target = targetFromValues(input.nodePath, input.cliPath, input.cwd);
  const original = readConfigFile(paths.configPath);
  validateCodexConfig(original);
  const guarded = guardCodexMcpServers(original, target);
  const config = setCharonMcpServer(guarded.config, target);
  validateCodexConfig(config);
  writeBackups(paths.configPath, original);
  atomicWriteConfig(paths.configPath, config);
  const written = readConfigFile(paths.configPath);
  validateCodexConfig(written);
  return {
    configPath: paths.configPath,
    guarded: guarded.guarded,
    already: guarded.already,
    skipped: guarded.skipped,
    removedNativeBypasses: 0,
    report: enforcementReport(written, target),
  };
}

export function unguardCodexMcp(input: {
  codexHome: string;
  cwd: string;
  nodePath: string;
  cliPath: string;
}): { configPath: string; restored: number; skipped: number } {
  const paths = codexPaths(input.codexHome);
  if (!existsSync(paths.configPath)) return { configPath: paths.configPath, restored: 0, skipped: 0 };
  const original = readConfigFile(paths.configPath);
  validateCodexConfig(original);
  const restored = unguardCodexMcpServers(original);
  const config = removeCharonMcpServer(restored.config);
  validateCodexConfig(config);
  atomicWriteConfig(paths.configPath, config);
  return { configPath: paths.configPath, restored: restored.restored, skipped: restored.skipped };
}

export function restoreCodexEnforcement(input: {
  codexHome: string;
  cwd: string;
  nodePath: string;
  cliPath: string;
}): RestoreResult | null {
  const paths = codexPaths(input.codexHome);
  if (!existsSync(paths.configPath)) return null;
  const backupPath = `${paths.configPath}.charon.bak`;
  if (existsSync(backupPath)) {
    const backup = readFileSync(backupPath, "utf8");
    validateCodexConfig(backup);
    atomicWriteConfig(paths.configPath, backup);
    return { restoredFromBackup: true, backupPath, restoredMcp: 0, skippedMcp: 0 };
  }

  const original = readConfigFile(paths.configPath);
  validateCodexConfig(original);
  const restored = unguardCodexMcpServers(original);
  let config = removeCharonMcpServer(restored.config);
  config = removeFeature(config, "shell_tool");
  config = removeFeature(config, "js_repl");
  validateCodexConfig(config);
  atomicWriteConfig(paths.configPath, config);
  return { restoredFromBackup: false, restoredMcp: restored.restored, skippedMcp: restored.skipped };
}

export function readEnforcementReport(input: {
  codexHome: string;
  cwd: string;
  nodePath: string;
  cliPath: string;
}): EnforcementReport {
  const paths = codexPaths(input.codexHome);
  const target = targetFromValues(input.nodePath, input.cliPath, input.cwd);
  const config = readConfigFile(paths.configPath);
  return enforcementReport(config, target);
}

export function mcpServerStatus(input: {
  codexHome: string;
  cwd: string;
  nodePath: string;
  cliPath: string;
}): Array<{ name: string; guarded: boolean; skipped: boolean }> {
  const paths = codexPaths(input.codexHome);
  const target = targetFromValues(input.nodePath, input.cliPath, input.cwd);
  return listMcpServers(readConfigFile(paths.configPath), target);
}

export function enforcementReport(config: string, target: CharonMcpTarget): EnforcementReport {
  let parsed: any;
  try {
    parsed = parseCodexConfig(config);
  } catch (error) {
    return {
      configValid: false,
      configError: error instanceof Error ? error.message : String(error),
      shellDisabled: false,
      jsReplDisabled: false,
      hooksEnabled: false,
      hooksInstalled: false,
      hooksTargetValid: false,
      bundledBypassPlugins: 0,
      nativeBypassMcp: 0,
      charonInstalled: false,
      charonRequired: false,
      charonCommandValid: false,
      charonServerValid: false,
      charonCwdValid: false,
      guardedMcp: 0,
      openMcp: 0,
      enforced: false,
    };
  }

  const features = parsed.features || {};
  const mcpServers = parsed.mcp_servers || {};
  const plugins = parsed.plugins || {};
  const charon = mcpServers.charon;
  const charonArgs = Array.isArray(charon?.args) ? charon.args.map(String) : [];
  const cwdIndex = charonArgs.indexOf("--cwd");

  let nativeBypassMcp = 0;
  let guardedMcp = 0;
  let openMcp = 0;
  const statusTarget = target;
  for (const [name, server] of Object.entries<any>(mcpServers)) {
    if (name === "charon") continue;
    if (server?.enabled === false) continue;
    if (name === "node_repl" || String(server?.command || "").includes("node_repl")) nativeBypassMcp += 1;
    const args = Array.isArray(server?.args) ? server.args.map(String) : [];
    const guarded = server?.command === statusTarget.nodePath && args.includes(statusTarget.cliPath) && args.includes("mcp") && args.includes("proxy");
    if (guarded) guardedMcp += 1;
    else openMcp += 1;
  }

  const shellDisabled = features.shell_tool === false;
  const jsReplDisabled = features.js_repl === false;
  const hooksEnabled = features.hooks === true;
  const hooksInstalled = hasCharonHooks(config);
  const hooksTargetValid = charonHooksTargetValid(config, target);
  const bundledBypassPlugins = countBundledBypassPlugins(plugins);
  const charonInstalled = Boolean(charon);
  const charonRequired = charon?.required === true;
  const charonCommandValid = charon?.command === target.nodePath;
  const charonServerValid = charonArgs.includes(target.cliPath) && charonArgs.includes("mcp") && charonArgs.includes("server");
  const charonCwdValid = cwdIndex >= 0 && charonArgs[cwdIndex + 1] === target.cwd;
  const enforced = shellDisabled &&
    jsReplDisabled &&
    hooksEnabled &&
    hooksInstalled &&
    hooksTargetValid &&
    bundledBypassPlugins === 0 &&
    nativeBypassMcp === 0 &&
    charonInstalled &&
    charonRequired &&
    charonCommandValid &&
    charonServerValid &&
    charonCwdValid &&
    openMcp === 0;

  return {
    configValid: true,
    shellDisabled,
    jsReplDisabled,
    hooksEnabled,
    hooksInstalled,
    hooksTargetValid,
    bundledBypassPlugins,
    nativeBypassMcp,
    charonInstalled,
    charonRequired,
    charonCommandValid,
    charonServerValid,
    charonCwdValid,
    guardedMcp,
    openMcp,
    enforced,
  };
}

export function failedReportReasons(report: EnforcementReport): string[] {
  const reasons: string[] = [];
  if (!report.configValid) reasons.push(report.configError || "invalid config");
  if (!report.shellDisabled) reasons.push("native shell enabled");
  if (!report.jsReplDisabled) reasons.push("local JS runtime enabled");
  if (!report.hooksEnabled) reasons.push("hooks feature disabled");
  if (!report.hooksInstalled) reasons.push("Charon hooks missing");
  if (!report.hooksTargetValid) reasons.push("Charon hooks target invalid");
  if (report.bundledBypassPlugins) reasons.push(`bundled bypass plugins enabled=${report.bundledBypassPlugins}`);
  if (report.nativeBypassMcp) reasons.push(`native bypass MCP open=${report.nativeBypassMcp}`);
  if (!report.charonInstalled) reasons.push("Charon MCP missing");
  if (!report.charonRequired) reasons.push("Charon MCP not required");
  if (!report.charonCommandValid) reasons.push("Charon MCP command invalid");
  if (!report.charonServerValid) reasons.push("Charon MCP server target invalid");
  if (!report.charonCwdValid) reasons.push("Charon MCP cwd invalid");
  if (report.openMcp) reasons.push(`external MCP open=${report.openMcp}`);
  return reasons;
}

function hasCharonHooks(config: string): boolean {
  return config.includes("# >>> charon hooks") &&
    config.includes("# <<< charon hooks") &&
    /codex\s+hook\s+pre-tool-use/.test(config) &&
    /codex\s+hook\s+permission-request/.test(config) &&
    /codex\s+hook\s+post-tool-use/.test(config);
}

function charonHooksTargetValid(config: string, target: CharonMcpTarget): boolean {
  if (!hasCharonHooks(config)) return false;
  const block = charonHooksBlock(config);
  return block.includes(target.nodePath) && block.includes(target.cliPath);
}

function countBundledBypassPlugins(plugins: Record<string, any>): number {
  let count = 0;
  for (const name of ["browser@openai-bundled", "chrome@openai-bundled", "computer-use@openai-bundled"]) {
    const plugin = plugins?.[name];
    if (!plugin) continue;
    const pluginOpen = plugin.enabled !== false;
    const nodeRepl = plugin?.mcp_servers?.node_repl;
    const nodeReplOpen = nodeRepl && nodeRepl.enabled !== false;
    if (pluginOpen || nodeReplOpen) count += 1;
  }
  return count;
}

function charonHooksBlock(config: string): string {
  const start = config.indexOf("# >>> charon hooks");
  const end = config.indexOf("# <<< charon hooks", start);
  if (start < 0 || end < 0) return "";
  return config.slice(start, end);
}
