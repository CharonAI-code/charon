"use strict";

const fs = require("fs");
const path = require("path");

function createActionNormalizer(options = {}) {
  const cwd = options.cwd || process.cwd();
  const readJson = options.readJson || ((file) => JSON.parse(fs.readFileSync(file, "utf8")));
  const redactText = options.redactText || ((value) => ({ value: String(value || "") }));
  const expandPath = options.expandPath || ((value) => value);
  const env = options.env || process.env;

  function normalizeAction(command) {
    const raw = command.map(String);
    const rendered = raw.join(" ");
    const executable = raw[0] || "";
    const args = raw.slice(1);
    const shell = parseShellAction(raw);
    const script = parseNpmScript(raw);
    const segments = [commandSegment(raw)].filter(Boolean);
    if (shell) segments.push(...shell.segments);
    if (script) segments.push(...script.segments);

    const commandCandidates = [...new Set(segments.map((segment) => segment.executable).filter(Boolean))];
    const argCandidates = segments.map((segment) => segment.args);
    const commandStrings = [...new Set([rendered, ...segments.map((segment) => segment.rendered)].filter(Boolean))];
    const searchText = commandStrings.join("\n");
    const pathHints = extractPathHints(searchText).map(normalizeCandidatePath);
    const networkHosts = extractHosts(searchText, env);

    return {
      raw,
      rendered,
      executable,
      args,
      shell,
      script,
      segments,
      commandCandidates,
      argCandidates,
      commandStrings,
      searchText,
      pathHints,
      networkHosts,
      summary: {
        executable: redactText(executable).value,
        args: args.map((arg) => redactText(arg).value),
        shell: shell ? { commands: shell.segments.map(redactedSegment) } : null,
        script: script ? { name: script.name, commands: script.segments.map(redactedSegment) } : null,
        chain: segments.length > 1 ? segments.map(redactedSegment) : [],
      },
    };
  }

  function redactedSegment(segment) {
    return {
      executable: redactText(segment.executable).value,
      args: segment.args.map((arg) => redactText(arg).value),
      command: redactText(segment.rendered).value,
    };
  }

  function parseShellAction(raw) {
    if (!raw.length || !["sh", "bash", "zsh"].includes(path.basename(raw[0]))) return null;
    const index = raw.findIndex((arg, i) => i > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg));
    if (index === -1 || !raw[index + 1]) return null;
    const segments = parseCommandSegments(raw[index + 1]);
    return segments.length ? { raw: raw[index + 1], segments, rendered: segments.map((segment) => segment.rendered).join(" && ") } : null;
  }

  function parseNpmScript(raw) {
    if (raw[0] !== "npm" || raw[1] !== "run" || !raw[2] || !fs.existsSync(path.join(cwd, "package.json"))) return null;
    try {
      const pkg = readJson(path.join(cwd, "package.json"));
      const scriptText = pkg.scripts && pkg.scripts[raw[2]];
      if (!scriptText) return null;
      const segments = parseCommandSegments(scriptText);
      return segments.length ? { name: raw[2], raw: scriptText, segments, rendered: segments.map((segment) => segment.rendered).join(" && ") } : null;
    } catch {
      return null;
    }
  }

  function actionReferencesPath(action, pattern) {
    const normalizedPattern = normalizePolicyPath(pattern);
    const candidates = [...pathCandidates(action), ...((action.pathHints || []).map(normalizeCandidatePath))];
    return candidates.some((candidate) => pathPatternMatches(candidate, normalizedPattern)) || action.searchText.includes(stripGlob(pattern));
  }

  function pathCandidates(action) {
    const candidates = new Set();
    for (const text of action.commandStrings) {
      for (const token of tokenizeCommand(text)) candidates.add(token);
    }
    for (const args of action.argCandidates) {
      for (const arg of args) candidates.add(String(arg));
    }
    return [...candidates].map(normalizeCandidatePath);
  }

  function normalizePolicyPath(pattern) {
    return normalizeCandidatePath(String(pattern || "").replace(/^read:/, ""));
  }

  function normalizeCandidatePath(value) {
    let text = String(value || "").replace(/^["']|["']$/g, "");
    text = text.replace(/^file:\/\//, "");
    text = expandPath(text);
    const globSuffix = text.endsWith("/**") ? "/**" : text.endsWith("*") ? "*" : "";
    text = text.replace(/\*\*$/g, "").replace(/\*$/g, "");
    if (!path.isAbsolute(text) && looksPathLike(text)) text = path.resolve(cwd, text);
    text = path.normalize(text);
    return `${text}${globSuffix}`;
  }

  function stripGlob(value) {
    return expandPath(value).replace(/\*\*$/g, "").replace(/\*$/g, "").replace(/\/$/g, "");
  }

  return {
    normalizeAction,
    actionReferencesPath,
  };
}

function parseCommandSegments(text) {
  const segments = [];
  for (const tokens of splitCommandChain(tokenizeCommandWithOperators(text))) {
    const segment = commandSegment(tokens);
    if (segment) segments.push(segment);
  }
  return segments;
}

function commandSegment(tokens) {
  const clean = (tokens || []).map(String).filter(Boolean);
  if (!clean.length) return null;
  return {
    tokens: clean,
    executable: clean[0],
    args: clean.slice(1),
    rendered: clean.join(" "),
  };
}

function tokenizeCommand(text) {
  return tokenizeCommandWithOperators(text).filter((token) => !isCommandOperator(token));
}

function tokenizeCommandWithOperators(text) {
  const tokens = [];
  let current = "";
  let quote = "";
  let escaped = false;
  const push = () => { if (current) { tokens.push(current); current = ""; } };
  const source = String(text || "");
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) { current += ch; escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (quote) {
      if (ch === quote) quote = "";
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (/\s/.test(ch)) { push(); continue; }
    if (ch === "&" && source[i + 1] === "&") { push(); tokens.push("&&"); i += 1; continue; }
    if (ch === "|" && source[i + 1] === "|") { push(); tokens.push("||"); i += 1; continue; }
    if ([";", "|"].includes(ch)) { push(); tokens.push(ch); continue; }
    current += ch;
  }
  push();
  return tokens;
}

function splitCommandChain(tokens) {
  const out = [];
  let current = [];
  for (const token of tokens) {
    if (isCommandOperator(token)) {
      if (current.length) out.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  if (current.length) out.push(current);
  return out;
}

function isCommandOperator(token) {
  return [";", "&&", "||", "|"].includes(token);
}

function extractHosts(value, env = {}) {
  const hosts = new Set();
  const addFrom = (input) => {
    const text = String(input || "");
    const urlRe = /\bhttps?:\/\/([a-zA-Z0-9.-]+)(?::\d+)?(?:[/?#][^\s"']*)?/g;
    for (const match of text.matchAll(urlRe)) hosts.add(match[1].toLowerCase());
    const bareDomainRe = /(?:^|[\s"'(@=])([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)(?::\d+)?(?:[/?#][^\s"']*)?/g;
    for (const match of text.matchAll(bareDomainRe)) {
      const host = match[1].toLowerCase();
      if (/\.(com|org|net|io|dev|app|site|co|ai|cloud)$/.test(host)) hosts.add(host);
    }
  };
  addFrom(value);
  for (const name of extractEnvRefs(value)) {
    const envValue = env && Object.prototype.hasOwnProperty.call(env, name) ? env[name] : "";
    addFrom(envValue);
  }
  return [...hosts].sort();
}

function extractPathHints(value) {
  const text = String(value || "");
  const hints = new Set();
  const literalRe = /(?:readFileSync|readFile|createReadStream|openSync|open|cat|grep|less|more|tail|head)\s*\(?\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(literalRe)) {
    if (looksPathLike(match[1])) hints.add(match[1]);
  }
  const pythonOpenRe = /\bopen\s*\(\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(pythonOpenRe)) {
    if (looksPathLike(match[1])) hints.add(match[1]);
  }
  const jsonPathRe = /["'](?:path|file|filename|filepath|src|source)["']\s*:\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(jsonPathRe)) {
    if (looksPathLike(match[1])) hints.add(match[1]);
  }
  return [...hints];
}

function extractEnvRefs(value) {
  const refs = new Set();
  const text = String(value || "");
  for (const match of text.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g)) refs.add(match[1]);
  for (const match of text.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) refs.add(match[1]);
  for (const match of text.matchAll(/process\.env\[["']([A-Z_][A-Z0-9_]*)["']\]/g)) refs.add(match[1]);
  return [...refs];
}

function looksPathLike(value) {
  return value === "." || value.startsWith(".") || value.startsWith("/") || value.startsWith("~") || value.includes("/") || /^\.env(?:\.|$)/.test(value);
}

function pathPatternMatches(candidate, pattern) {
  const base = pattern.replace(/\*\*$/g, "").replace(/\*$/g, "").replace(/\/$/g, "");
  if (!base) return false;
  if (pattern.endsWith("/**")) return candidate === base || candidate.startsWith(`${base}/`);
  if (pattern.endsWith("*")) return candidate.startsWith(base);
  return candidate === base || (candidate.endsWith(`/${path.basename(base)}`) && path.basename(base).startsWith(".env"));
}

module.exports = {
  createActionNormalizer,
  extractHosts,
  extractPathHints,
  parseCommandSegments,
  tokenizeCommand,
};
