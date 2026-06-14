import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { ActionCoordinator } from "../trusted-process";
import { inspectOutput, InspectionSession } from "../inspection";
import { loadMcpPolicy } from "./policy";
import { writeMcpReceipt } from "./receipts";

export interface McpProxyOptions {
  command: string;
  args?: string[];
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

export function startMcpProxy(options: McpProxyOptions): ChildProcessWithoutNullStreams {
  const cwd = options.cwd || process.cwd();
  const stdout = options.stdout || process.stdout;
  const stdin = options.stdin || process.stdin;
  const stderr = options.stderr || process.stderr;
  let upstreamReady = true;
  const session = new InspectionSession();
  const child = spawn(options.command, options.args || [], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const policy = loadMcpPolicy(options.policyPath || "charon.yml");
  const coordinator = new ActionCoordinator({ policy, session });
  const pendingCalls = new Map<string | number, string>();

  child.stderr.on("data", (chunk) => stderr.write(chunk));
  child.on("error", (error) => {
    upstreamReady = false;
    stderr.write(`charon mcp proxy upstream error: ${error.message}\n`);
  });
  child.on("exit", (code, signal) => {
    upstreamReady = false;
    if (signal) stderr.write(`charon mcp proxy upstream exited by ${signal}\n`);
    else if (code && code !== 0) stderr.write(`charon mcp proxy upstream exited ${code}\n`);
  });

  const client = readline.createInterface({ input: stdin });
  const server = readline.createInterface({ input: child.stdout });

  client.on("line", async (line) => {
    const message = parseJson(line);
    if (!message) {
      stdout.write(`${JSON.stringify(jsonRpcError(null, -32700, "Parse error"))}\n`);
      return;
    }
    if (message.method !== "tools/call") {
      forwardToUpstream(child, line, stdout, message);
      return;
    }
    if (!upstreamReady) {
      stdout.write(`${JSON.stringify(jsonRpcError(message.id, -32001, "Charon MCP upstream is unavailable"))}\n`);
      return;
    }

    const toolName = String(message.params?.name || "unknown");
    if (!message.params || typeof message.params !== "object" || !message.params.name) {
      stdout.write(`${JSON.stringify(jsonRpcError(message.id, -32602, "Invalid MCP tools/call params"))}\n`);
      return;
    }
    let result;
    let receiptPath = "";
    try {
      result = await coordinator.enforce({
        runtime: "mcp",
        toolName,
        cwd,
        args: message.params?.arguments || {},
        metadata: {
          jsonrpcId: message.id,
          mcpMethod: message.method,
        },
      });
      receiptPath = writeMcpReceipt(result.receipt, options.receiptsDir);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      stdout.write(`${JSON.stringify(blockedToolResult(message, "DENY", `receipt or policy failure: ${reason}`, ""))}\n`);
      return;
    }

    if (result.decision.verdict === "PASS") {
      pendingCalls.set(message.id ?? `id-${Math.random()}`, toolName);
      forwardToUpstream(child, line, stdout, message);
      return;
    }

    stdout.write(`${JSON.stringify(blockedToolResult(message, result.decision.verdict, result.decision.reason, receiptPath))}\n`);
  });

  server.on("line", (line) => {
    const message = parseJson(line);
    if (!message || message.id === undefined || !pendingCalls.has(message.id)) {
      stdout.write(`${line}\n`);
      return;
    }
    pendingCalls.delete(message.id);
    const content = extractToolText(message);
    if (!content) {
      stdout.write(`${line}\n`);
      return;
    }
    const output = inspectOutput(content, "", {
      session,
      mode: "deny",
      store: "redacted",
      maxBytes: 4000,
    });
    if (output.verdict !== "PASS") {
      stdout.write(`${JSON.stringify(blockedToolResult(message, output.verdict, output.reason, ""))}\n`);
      return;
    }
    const redacted = replaceToolText(message, output.combined || content);
    stdout.write(`${JSON.stringify(redacted)}\n`);
  });

  stdin.on("end", () => child.stdin.end());
  return child;
}

function parseJson(line: string): JsonRpcRequest | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function forwardToUpstream(child: ChildProcessWithoutNullStreams, line: string, stdout: NodeJS.WritableStream, request: JsonRpcRequest): void {
  if (child.killed || child.stdin.destroyed || !child.stdin.writable) {
    stdout.write(`${JSON.stringify(jsonRpcError(request.id, -32001, "Charon MCP upstream is unavailable"))}\n`);
    return;
  }
  try {
    child.stdin.write(`${line}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    stdout.write(`${JSON.stringify(jsonRpcError(request.id, -32001, `Charon MCP upstream write failed: ${reason}`))}\n`);
  }
}

function jsonRpcError(id: JsonRpcRequest["id"] | null, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function blockedToolResult(request: JsonRpcRequest, verdict: string, reason: string, receiptPath: string) {
  return {
    jsonrpc: "2.0",
    id: request.id,
    result: {
      content: [
        {
          type: "text",
          text: receiptPath ? `Charon ${verdict}: ${reason}\nReceipt: ${receiptPath}` : `Charon ${verdict}: ${reason}`,
        },
      ],
      isError: true,
    },
  };
}

function extractToolText(message: JsonRpcRequest): string {
  const content = Array.isArray(message.params?.content)
    ? message.params.content
    : Array.isArray((message as any).result?.content)
      ? (message as any).result.content
      : [];
  return content
    .filter((item: any) => item && item.type === "text" && typeof item.text === "string")
    .map((item: any) => item.text)
    .join("\n");
}

function replaceToolText(message: JsonRpcRequest, text: string): JsonRpcRequest {
  if (!Array.isArray((message as any).result?.content)) return message;
  const clone = JSON.parse(JSON.stringify(message));
  let replaced = false;
  clone.result.content = clone.result.content.map((item: any) => {
    if (!replaced && item && item.type === "text") {
      replaced = true;
      return { ...item, text };
    }
    return item;
  });
  return clone;
}
