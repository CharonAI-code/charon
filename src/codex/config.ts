import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as TOML from "@iarna/toml";

export interface TomlSection {
  path: string[];
  header: string;
  start: number;
  bodyStart: number;
  end: number;
  text: string;
  body: string;
}

export interface CharonMcpTarget {
  nodePath: string;
  cliPath: string;
  cwd: string;
}

export interface GuardResult {
  config: string;
  guarded: number;
  already: number;
  skipped: number;
}

export interface RemoveResult {
  config: string;
  removed: number;
}

export interface RestoreResult {
  config: string;
  restored: number;
  skipped: number;
}

export function parseCodexConfig(config: string): any {
  try {
    return TOML.parse(config || "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid Codex config TOML: ${message}`);
  }
}

export function validateCodexConfig(config: string): void {
  parseCodexConfig(config);
}

export function readConfigFile(configPath: string): string {
  return existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
}

export function atomicWriteConfig(configPath: string, config: string): void {
  mkdirSync(dirname(configPath), { recursive: true });
  const tmp = `${configPath}.charon-${process.pid}-${Date.now()}.tmp`;
  writeFileSync(tmp, config);
  renameSync(tmp, configPath);
}

export function writeBackups(configPath: string, config: string): void {
  if (!existsSync(configPath)) return;
  const stable = `${configPath}.charon.bak`;
  if (!existsSync(stable)) writeFileSync(stable, config);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(`${configPath}.charon.${stamp}.bak`, config);
}

export function sections(config: string): TomlSection[] {
  const matches = [...config.matchAll(/^[ \t]*\[([^\]]+)\][ \t]*$/gm)];
  return matches.map((match, index) => {
    const start = match.index || 0;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index || config.length : config.length;
    const headerEnd = config.indexOf("\n", start);
    const bodyStart = headerEnd >= 0 ? headerEnd + 1 : nextStart;
    const text = config.slice(start, nextStart);
    return {
      path: splitTomlPath(match[1]),
      header: match[0].trim(),
      start,
      bodyStart,
      end: nextStart,
      text,
      body: config.slice(bodyStart, nextStart),
    };
  });
}

export function setFeature(config: string, key: string, value: boolean): string {
  const rendered = `${key} = ${value ? "true" : "false"}`;
  const feature = sections(config).find((section) => samePath(section.path, ["features"]));
  if (!feature) return `${trimRight(config)}\n\n[features]\n${rendered}\n`;

  const body = feature.body;
  const keyRe = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(?:true|false)\\s*$`, "m");
  if (keyRe.test(body)) {
    return spliceSectionBody(config, feature, body.replace(keyRe, rendered));
  }
  return spliceSectionBody(config, feature, `${rendered}\n${body}`);
}

export function setCodexHardening(config: string): string {
  let output = config;
  output = setTopLevelString(output, "approval_policy", "on-request");
  output = setTopLevelString(output, "sandbox_mode", "workspace-write");
  output = setTopLevelString(output, "default_permissions", "charon_workspace");
  output = setFeature(output, "hooks", true);
  output = setFeature(output, "browser_use", false);
  output = setFeature(output, "browser_use_full_cdp_access", false);
  output = setFeature(output, "in_app_browser", false);
  output = removeSectionPath(output, ["plugins", "browser-bundled"]);
  output = disableNativeBypassServers(output);
  for (const plugin of ["browser@openai-bundled", "chrome@openai-bundled", "computer-use@openai-bundled"]) {
    output = setPluginEnabled(output, plugin, false);
    output = setPluginMcpServerEnabled(output, plugin, "node_repl", false);
  }
  output = setCharonPermissionProfile(output);
  return output;
}

export function setCharonHooks(config: string, target: CharonMcpTarget): string {
  const command = `${shellQuote(target.nodePath)} ${shellQuote(target.cliPath)} codex hook`;
  const block = [
    "",
    "# >>> charon hooks",
    "[[hooks.PreToolUse]]",
    'matcher = "*"',
    "",
    "[[hooks.PreToolUse.hooks]]",
    "type = \"command\"",
    `command = ${tomlString(`${command} pre-tool-use`)}`,
    "timeout = 30",
    "statusMessage = \"Charon policy check\"",
    "",
    "[[hooks.PermissionRequest]]",
    'matcher = "*"',
    "",
    "[[hooks.PermissionRequest.hooks]]",
    "type = \"command\"",
    `command = ${tomlString(`${command} permission-request`)}`,
    "timeout = 30",
    "statusMessage = \"Charon approval check\"",
    "",
    "[[hooks.PostToolUse]]",
    'matcher = "*"',
    "",
    "[[hooks.PostToolUse.hooks]]",
    "type = \"command\"",
    `command = ${tomlString(`${command} post-tool-use`)}`,
    "timeout = 30",
    "statusMessage = \"Charon result check\"",
    "# <<< charon hooks",
    "",
  ].join("\n");
  return `${trimRight(removeCharonHooks(config))}${block}`;
}

export function removeCharonHooks(config: string): string {
  return config
    .replace(/(?:\n)?# >>> charon hooks[\s\S]*?# <<< charon hooks(?:\n)?/m, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function setCharonMcpServer(config: string, target: CharonMcpTarget): string {
  const block = [
    "",
    "# >>> charon",
    "[mcp_servers.charon]",
    `command = ${tomlString(target.nodePath)}`,
    `args = ${tomlArray([target.cliPath, "mcp", "server", "--cwd", target.cwd])}`,
    "required = true",
    'default_tools_approval_mode = "approve"',
    "",
    '[mcp_servers.charon.tools."charon_shell.run"]',
    'approval_mode = "approve"',
    "",
    '[mcp_servers.charon.tools."charon_file.read"]',
    'approval_mode = "approve"',
    "",
    '[mcp_servers.charon.tools."charon_file.write"]',
    'approval_mode = "approve"',
    "",
    '[mcp_servers.charon.tools."charon_git.run"]',
    'approval_mode = "approve"',
    "",
    '[mcp_servers.charon.tools."charon_network.fetch"]',
    'approval_mode = "approve"',
    "",
    '[mcp_servers.charon.tools."charon_policy.status"]',
    'approval_mode = "approve"',
    "# <<< charon",
    "",
  ].join("\n");
  return `${trimRight(removeCharonMcpServer(config))}${block}`;
}

export function removeCharonMcpServer(config: string): string {
  const managed = config.replace(/(?:\n)?# >>> charon[\s\S]*?\[mcp_servers\.charon\][\s\S]*?# <<< charon(?:\n)?/m, "\n");
  return removeMcpServer(managed, "charon").config
    .replace(/(?:^|\n)# >>> charon\s*(?=\n|$)/g, "\n")
    .replace(/(?:^|\n)# <<< charon\s*(?=\n|$)/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function removeNativeBypassServers(config: string, names = ["node_repl"]): RemoveResult {
  let output = config;
  let removed = 0;
  for (const name of names) {
    const result = removeMcpServer(output, name);
    if (result.removed) removed += 1;
    output = result.config;
  }
  return { config: output.replace(/\n{3,}/g, "\n\n"), removed };
}

export function disableNativeBypassServers(config: string, names = ["node_repl"]): string {
  let output = config;
  for (const name of names) {
    output = removeMcpServer(output, name).config;
    output = trimRight(output) + "\n\n[mcp_servers." + name + "]\nenabled = false\ncommand = " + tomlString(name) + "\nargs = []\n";
  }
  return output.replace(/\n{3,}/g, "\n\n");
}

export function removeMcpServer(config: string, name: string): RemoveResult {
  const removable = sections(config)
    .filter((section) => section.path[0] === "mcp_servers" && section.path[1] === name)
    .sort((a, b) => b.start - a.start);
  let output = config;
  for (const section of removable) {
    output = `${output.slice(0, section.start)}${output.slice(section.end)}`;
  }
  return { config: output, removed: removable.length ? 1 : 0 };
}

export function guardCodexMcpServers(config: string, target: CharonMcpTarget): GuardResult {
  const parsed = parseCodexConfig(config);
  const rootSections = sections(config).filter((section) => isRootMcpSection(section));
  let output = "";
  let cursor = 0;
  let guarded = 0;
  let already = 0;
  let skipped = 0;

  for (const section of rootSections) {
    output += config.slice(cursor, section.start);
    const name = section.path[1];
    if (name === "charon") {
      skipped += 1;
      output += section.text;
      cursor = section.end;
      continue;
    }
    const server = parsed?.mcp_servers?.[name] || {};
    const command = typeof server.command === "string" ? server.command : "";
    const args = Array.isArray(server.args) ? server.args.map(String) : [];
    if (isGuardedMcpServer(section, server, target)) {
      already += 1;
      output += section.text;
    } else if (!command) {
      skipped += 1;
      output += section.text;
    } else {
      guarded += 1;
      output += rewriteMcpRootAsGuarded(section, command, args, target);
    }
    cursor = section.end;
  }

  output += config.slice(cursor);
  return { config: output, guarded, already, skipped };
}

export function unguardCodexMcpServers(config: string): RestoreResult {
  const rootSections = sections(config).filter((section) => isRootMcpSection(section));
  let output = "";
  let cursor = 0;
  let restored = 0;
  let skipped = 0;

  for (const section of rootSections) {
    output += config.slice(cursor, section.start);
    if (section.path[1] === "charon" || !hasGuardMarker(section)) {
      skipped += 1;
      output += section.text;
    } else {
      const originalLines = readMarkerJson(section.body, "charon.original_lines");
      const command = readMarkerJson(section.body, "charon.original_command");
      const args = readMarkerJson(section.body, "charon.original_args");
      if (Array.isArray(originalLines) && originalLines.every((item) => typeof item === "string")) {
        restored += 1;
        output += rewriteMcpRootAsOriginal(section, originalLines);
      } else if (typeof command === "string" && Array.isArray(args)) {
        restored += 1;
        output += rewriteMcpRootAsOriginal(section, [
          `command = ${tomlString(command)}`,
          `args = ${tomlArray(args.map(String))}`,
        ]);
      } else {
        skipped += 1;
        output += section.text;
      }
    }
    cursor = section.end;
  }

  output += config.slice(cursor);
  return { config: output, restored, skipped };
}

export function listMcpServers(config: string, target: CharonMcpTarget): Array<{ name: string; guarded: boolean; skipped: boolean }> {
  const parsed = parseCodexConfig(config);
  return sections(config)
    .filter((section) => isRootMcpSection(section))
    .map((section) => {
      const name = section.path[1];
      const server = parsed?.mcp_servers?.[name] || {};
      return {
        name,
        skipped: name === "charon",
        guarded: name !== "charon" && isGuardedMcpServer(section, server, target),
      };
    });
}

export function removeFeature(config: string, key: string): string {
  const feature = sections(config).find((section) => samePath(section.path, ["features"]));
  if (!feature) return config;
  const keyRe = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(?:true|false)\\s*\\n?`, "m");
  return spliceSectionBody(config, feature, feature.body.replace(keyRe, ""));
}

function setPluginEnabled(config: string, plugin: string, enabled: boolean): string {
  const pluginPath = ["plugins", plugin];
  const section = sections(config).find((section) => samePath(section.path, pluginPath));
  const rendered = "enabled = " + (enabled ? "true" : "false");
  if (!section) return trimRight(config) + "\n\n[plugins." + tomlString(plugin) + "]\n" + rendered + "\n";

  const body = section.body;
  const keyRe = new RegExp("^\\s*enabled\\s*=\\s*(?:true|false)\\s*$", "m");
  if (keyRe.test(body)) {
    return spliceSectionBody(config, section, body.replace(keyRe, rendered));
  }
  return spliceSectionBody(config, section, rendered + "\n" + body);
}

function setPluginMcpServerEnabled(config: string, plugin: string, server: string, enabled: boolean): string {
  const path = ["plugins", plugin, "mcp_servers", server];
  const without = removeSectionPath(config, path);
  const rendered = "enabled = " + (enabled ? "true" : "false");
  return trimRight(without) + "\n\n[plugins." + tomlString(plugin) + ".mcp_servers." + server + "]\n" + rendered + "\n";
}

function setTopLevelString(config: string, key: string, value: string): string {
  const rendered = `${key} = ${tomlString(value)}`;
  const rootEnd = firstSectionStart(config);
  const root = config.slice(0, rootEnd);
  const suffix = config.slice(rootEnd);
  const keyRe = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*.+$`, "m");
  if (keyRe.test(root)) return `${root.replace(keyRe, rendered)}${suffix}`;
  const separator = root.trim() ? "\n" : "";
  return `${trimRight(root)}${separator}${rendered}\n${suffix}`;
}

function firstSectionStart(config: string): number {
  const match = /^[ \t]*\[[^\]]+\][ \t]*$/m.exec(config);
  return match?.index ?? config.length;
}

function setCharonPermissionProfile(config: string): string {
  const without = removeSectionPath(removeSectionPath(config, ["permissions", "charon_workspace", "filesystem", ":workspace_roots"]), ["permissions", "charon_workspace"]);
  const block = [
    "",
    "[permissions.charon_workspace]",
    "description = \"Charon guarded workspace access\"",
    "extends = \":workspace\"",
    "",
    "[permissions.charon_workspace.filesystem.\":workspace_roots\"]",
    "\".\" = \"write\"",
    "\".git\" = \"read\"",
    "\".codex\" = \"read\"",
    "",
  ].join("\n");
  return `${trimRight(without)}${block}`;
}

function removeSectionPath(config: string, path: string[]): string {
  const removable = sections(config)
    .filter((section) => samePath(section.path, path))
    .sort((a, b) => b.start - a.start);
  let output = config;
  for (const section of removable) {
    output = `${output.slice(0, section.start)}${output.slice(section.end)}`;
  }
  return output.replace(/\n{3,}/g, "\n\n");
}

export function targetFromValues(nodePath: string, cliPath: string, cwd: string): CharonMcpTarget {
  return { nodePath, cliPath, cwd };
}

export function samePath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function splitTomlPath(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let escaped = false;
  for (const ch of value.trim()) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && inQuote) {
      current += ch;
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      current += ch;
      inQuote = !inQuote;
      continue;
    }
    if (ch === "." && !inQuote) {
      parts.push(unquoteTomlPart(current.trim()));
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(unquoteTomlPart(current.trim()));
  return parts;
}

function unquoteTomlPart(part: string): string {
  if (part.startsWith("\"") && part.endsWith("\"")) {
    try {
      return JSON.parse(part);
    } catch {
      return part.slice(1, -1);
    }
  }
  return part;
}

function isRootMcpSection(section: TomlSection): boolean {
  return section.path[0] === "mcp_servers" && section.path.length === 2;
}

function isGuardedMcpServer(section: TomlSection, server: any, target: CharonMcpTarget): boolean {
  if (hasGuardMarker(section)) return true;
  const args = Array.isArray(server?.args) ? server.args.map(String) : [];
  return server?.command === target.nodePath && args.includes(target.cliPath) && args.includes("mcp") && args.includes("proxy");
}

function hasGuardMarker(section: TomlSection): boolean {
  return /#\s*charon\.guarded\s*=\s*true/.test(section.body);
}

function rewriteMcpRootAsGuarded(section: TomlSection, command: string, args: string[], target: CharonMcpTarget): string {
  const lines = section.text.split("\n");
  const originalLines = lines.filter((line) => /^\s*(?:command|args)\s*=/.test(line));
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*(?:command|args)\s*=/.test(line) || /^\s*#\s*charon\./.test(line)) continue;
    out.push(line);
    if (line.trim() === section.header) {
      out.push("# charon.guarded = true");
      out.push(`# charon.original_command = ${JSON.stringify(command)}`);
      out.push(`# charon.original_args = ${JSON.stringify(args)}`);
      out.push(`# charon.original_lines = ${JSON.stringify(originalLines)}`);
      out.push(`command = ${tomlString(target.nodePath)}`);
      out.push(`args = ${tomlArray([target.cliPath, "mcp", "proxy", "--", command, ...args])}`);
    }
  }
  return out.join("\n");
}

function rewriteMcpRootAsOriginal(section: TomlSection, originalLines: string[]): string {
  const lines = section.text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*(?:command|args)\s*=/.test(line) || /^\s*#\s*charon\./.test(line)) continue;
    out.push(line);
    if (line.trim() === section.header) out.push(...originalLines);
  }
  return out.join("\n");
}

function readMarkerJson(body: string, key: string): unknown {
  const match = body.match(new RegExp(`^\\s*#\\s*${escapeRegExp(key)}\\s*=\\s*(.+?)\\s*$`, "m"));
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

function spliceSectionBody(config: string, section: TomlSection, body: string): string {
  const suffix = config.slice(section.end);
  let nextBody = body;
  if (suffix && !nextBody.endsWith("\n")) nextBody += "\n";
  return `${config.slice(0, section.bodyStart)}${nextBody}${suffix}`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function trimRight(value: string): string {
  return value.replace(/\s*$/g, "");
}

function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
