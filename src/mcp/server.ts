import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import readline from "node:readline";
import { ActionCoordinator } from "../trusted-process";
import type { ActionResource } from "../action";
import { inspectOutput, InspectionSession } from "../inspection";
import { loadMcpPolicy } from "./policy";
import { writeMcpReceipt } from "./receipts";

export interface CharonMcpServerOptions {
  cwd?: string;
  policyPath?: string;
  receiptsDir?: string;
  stderr?: NodeJS.WritableStream;
  stdout?: NodeJS.WritableStream;
  stdin?: NodeJS.ReadableStream;
}

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number;
  method?: string;
  params?: any;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

export function startMcpServer(options: CharonMcpServerOptions = {}): void {
  const cwd = options.cwd || process.cwd();
  const stdout = options.stdout || process.stdout;
  const stdin = options.stdin || process.stdin;
  const session = new InspectionSession();
  const coordinator = new ActionCoordinator({ policy: loadMcpPolicy(options.policyPath || resolve(cwd, "charon.yml")), session });
  const tools = createTools({ cwd, coordinator, session, receiptsDir: options.receiptsDir || resolve(cwd, ".charon", "receipts") });
  const input = readline.createInterface({ input: stdin });

  input.on("line", async (line) => {
    const message = parseJson(line);
    if (!message) {
      write(stdout, jsonRpcError(null, -32700, "Parse error"));
      return;
    }

    try {
      if (message.method === "initialize") {
        write(stdout, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "charon", version: "0.2.0" },
          },
        });
        return;
      }
      if (message.method === "notifications/initialized") return;
      if (message.method === "tools/list") {
        write(stdout, {
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: tools.map(({ handler, ...tool }) => tool) },
        });
        return;
      }
      if (message.method === "tools/call") {
        await callTool({ message, tools, stdout });
        return;
      }
      write(stdout, jsonRpcError(message.id, -32601, `Unknown method: ${message.method || ""}`));
    } catch (error) {
      write(stdout, jsonRpcError(message.id, -32000, error instanceof Error ? error.message : String(error)));
    }
  });
}

function createTools(input: {
  cwd: string;
  coordinator: ActionCoordinator;
  session: InspectionSession;
  receiptsDir?: string;
}): ToolDefinition[] {
  const { cwd, coordinator, session, receiptsDir } = input;

  async function enforce<T>(
    toolName: string,
    args: Record<string, unknown>,
    executor?: () => Promise<T> | T,
    resources?: ActionResource[],
  ): Promise<{ text: string; isError?: boolean }> {
    const result = await coordinator.enforce({
      runtime: "mcp",
      toolName,
      cwd,
      args,
      resources,
      context: typeof args.context === "string" ? args.context : undefined,
    }, executor ? () => executor() : undefined);
    const receiptPath = writeMcpReceipt(result.receipt, receiptsDir);
    if (result.decision.verdict !== "PASS") {
      return {
        isError: true,
        text: `Charon ${result.decision.verdict}: ${result.decision.reason}\nReceipt: ${receiptPath}`,
      };
    }
    if (result.error) {
      return {
        isError: true,
        text: `Charon PASS but execution failed: ${result.error.message}\nReceipt: ${receiptPath}`,
      };
    }
    const rawText = typeof result.result === "string" ? result.result : JSON.stringify(result.result ?? {}, null, 2);
    const output = inspectOutput(rawText, "", { session, mode: "deny", store: "redacted", maxBytes: 4000 });
    if (output.verdict !== "PASS") {
      return {
        isError: true,
        text: `Charon ${output.verdict}: ${output.reason}\nReceipt: ${receiptPath}`,
      };
    }
    return {
      text: formatResult(output.combined || rawText, receiptPath),
    };
  }

  return [
    {
      name: "charon_shell.run",
      description: "Run a shell command through Charon policy before launch.",
      inputSchema: objectSchema({
        command: { type: "string", description: "Command to run" },
        args: { type: "array", items: { type: "string" }, description: "Command arguments" },
        context: { type: "string", description: "Why this command is needed" },
      }, ["command"]),
      handler: async (args) => {
        const command = [String(args.command), ...stringArray(args.args)].join(" ");
        const resources: ActionResource[] = [
          { role: "shell-command", value: command },
          ...inferDeleteResources(String(args.command), stringArray(args.args)),
        ];
        return enforce("charon_shell.run", args, () => runCommand(cwd, String(args.command), stringArray(args.args)), [
          ...resources,
        ]);
      },
    },
    {
      name: "charon_file.read",
      description: "Read a file through Charon policy.",
      inputSchema: objectSchema({
        path: { type: "string", description: "Path to read" },
        context: { type: "string", description: "Why this file is needed" },
      }, ["path"]),
      handler: async (args) => enforce("charon_file.read", args, () => readFileSync(resolve(cwd, String(args.path)), "utf8"), [
        { role: "read-path", value: String(args.path) },
      ]),
    },
    {
      name: "charon_file.write",
      description: "Write a file through Charon policy.",
      inputSchema: objectSchema({
        path: { type: "string", description: "Path to write" },
        content: { type: "string", description: "New file content" },
        context: { type: "string", description: "Why this write is needed" },
      }, ["path", "content"]),
      handler: async (args) => enforce("charon_file.write", args, () => {
        const target = resolve(cwd, String(args.path));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, String(args.content));
        return { path: target, bytes: Buffer.byteLength(String(args.content)) };
      }, [{ role: "write-path", value: String(args.path) }]),
    },
    {
      name: "charon_git.run",
      description: "Run a git command through Charon policy.",
      inputSchema: objectSchema({
        args: { type: "array", items: { type: "string" }, description: "Git arguments, excluding the git executable" },
        context: { type: "string", description: "Why this git command is needed" },
      }, ["args"]),
      handler: async (args) => {
        const gitArgs = stringArray(args.args);
        return enforce("charon_git.run", { ...args, command: "git" }, () => runCommand(cwd, "git", gitArgs), [
          { role: "shell-command", value: ["git", ...gitArgs].join(" ") },
          { role: "mcp-tool", value: "charon_git.run" },
          ...inferGitDeleteResources(gitArgs),
        ]);
      },
    },
    {
      name: "charon_network.fetch",
      description: "Fetch a URL through Charon policy.",
      inputSchema: objectSchema({
        url: { type: "string", description: "HTTP URL to fetch" },
        method: { type: "string", description: "HTTP method" },
        body: { type: "string", description: "Optional request body" },
        context: { type: "string", description: "Why this network request is needed" },
      }, ["url"]),
      handler: async (args) => enforce("charon_network.fetch", args, async () => {
        const response = await fetch(String(args.url), {
          method: String(args.method || "GET"),
          body: typeof args.body === "string" ? args.body : undefined,
        });
        return {
          status: response.status,
          url: response.url,
          body: await response.text(),
        };
      }, [{ role: "fetch-url", value: String(args.url) }]),
    },
    {
      name: "charon_policy.status",
      description: "Show Charon policy status for this workspace.",
      inputSchema: objectSchema({}, []),
      handler: async () => ({
        text: JSON.stringify({ cwd, policyLoaded: true }, null, 2),
      }),
    },
  ];
}

async function callTool(input: { message: JsonRpcRequest; tools: ToolDefinition[]; stdout: NodeJS.WritableStream }): Promise<void> {
  const { message, tools, stdout } = input;
  const name = String(message.params?.name || "");
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    write(stdout, jsonRpcError(message.id, -32602, `Unknown tool: ${name}`));
    return;
  }
  const result = await tool.handler(safeObject(message.params?.arguments));
  const text = typeof result === "object" && result && "text" in result ? String((result as any).text) : JSON.stringify(result, null, 2);
  write(stdout, {
    jsonrpc: "2.0",
    id: message.id,
    result: {
      content: [{ type: "text", text }],
      isError: Boolean((result as any)?.isError),
    },
  });
}

function runCommand(cwd: string, command: string, args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolveRun({ command, args, exitCode: code, signal, stdout, stderr });
    });
  });
}

function objectSchema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function formatResult(result: unknown, receiptPath: string): string {
  const value = typeof result === "string" ? result : JSON.stringify(result ?? {}, null, 2);
  return `${value}\n\nCharon receipt: ${receiptPath}`;
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

function inferDeleteResources(command: string, args: string[]): ActionResource[] {
  const base = command.split("/").pop() || command;
  if (base === "rm" || base === "unlink" || base === "rmdir" || base === "trash") {
    return args
      .filter((arg) => arg && !arg.startsWith("-"))
      .map((value) => ({ role: "delete-path", value }));
  }
  if (base === "find" && args.includes("-delete")) {
    const roots: string[] = [];
    for (const arg of args) {
      if (!arg || arg.startsWith("-")) break;
      roots.push(arg);
    }
    return (roots.length ? roots : ["."]).map((value) => ({ role: "delete-path", value }));
  }
  if ((base === "sh" || base === "zsh" || base === "bash") && args.includes("-lc")) {
    const script = args[args.indexOf("-lc") + 1] || "";
    return inferDeleteResourcesFromText(script);
  }
  return inferDeleteResourcesFromText([command, ...args].join(" "));
}

function inferGitDeleteResources(args: string[]): ActionResource[] {
  const subcommand = args.find((arg) => arg && !arg.startsWith("-")) || "";
  if (subcommand === "rm") {
    return args
      .slice(args.indexOf(subcommand) + 1)
      .filter((arg) => arg && !arg.startsWith("-"))
      .map((value) => ({ role: "delete-path", value }));
  }
  if (subcommand === "clean") {
    return [{ role: "delete-path", value: "." }];
  }
  if (subcommand === "restore" && args.includes("--source")) {
    return args
      .slice(args.indexOf(subcommand) + 1)
      .filter((arg) => arg && !arg.startsWith("-") && arg !== "HEAD" && arg !== "HEAD~1")
      .map((value) => ({ role: "delete-path", value }));
  }
  return [];
}

function inferDeleteResourcesFromText(text: string): ActionResource[] {
  const resources: ActionResource[] = [];
  const commandMatches = text.matchAll(/\b(?:rm|unlink|rmdir|trash)\b\s+([^;&|]+)/g);
  for (const match of commandMatches) {
    for (const token of splitShellLike(match[1] || "")) {
      if (token && !token.startsWith("-")) resources.push({ role: "delete-path", value: stripQuotes(token) });
    }
  }
  for (const match of text.matchAll(/\b(?:fs\.)?(?:rm|unlink|rmdir)\s*\(\s*["']([^"']+)["']/g)) {
    resources.push({ role: "delete-path", value: match[1] });
  }
  for (const match of text.matchAll(/\b(?:rmSync|unlinkSync|rmdirSync)\s*\(\s*["']([^"']+)["']/g)) {
    resources.push({ role: "delete-path", value: match[1] });
  }
  const findMatches = text.matchAll(/\bfind\b\s+([^;&|]*?)\s+-delete\b/g);
  for (const match of findMatches) {
    const roots: string[] = [];
    for (const token of splitShellLike(match[1] || "")) {
      if (!token || token.startsWith("-")) break;
      roots.push(token);
    }
    for (const root of roots.length ? roots : ["."]) resources.push({ role: "delete-path", value: stripQuotes(root) });
  }
  return resources;
}

function splitShellLike(text: string): string[] {
  return text.match(/"[^"]*"|'[^']*'|\S+/g) || [];
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function parseJson(line: string): JsonRpcRequest | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function write(stdout: NodeJS.WritableStream, message: unknown): void {
  stdout.write(`${JSON.stringify(message)}\n`);
}

function jsonRpcError(id: JsonRpcRequest["id"] | null, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}
