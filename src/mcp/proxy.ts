import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { ActionCoordinator } from "../trusted-process";
import { loadMcpPolicy } from "./policy";
import { writeMcpReceipt } from "./receipts";

export interface McpProxyOptions {
  command: string;
  args?: string[];
  cwd?: string;
  policyPath?: string;
  receiptsDir?: string;
  stderr?: NodeJS.WritableStream;
}

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number;
  method?: string;
  params?: any;
}

export function startMcpProxy(options: McpProxyOptions): ChildProcessWithoutNullStreams {
  const cwd = options.cwd || process.cwd();
  const child = spawn(options.command, options.args || [], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const coordinator = new ActionCoordinator({ policy: loadMcpPolicy(options.policyPath || "charon.yml") });
  const stderr = options.stderr || process.stderr;

  child.stderr.on("data", (chunk) => stderr.write(chunk));
  child.on("exit", (code, signal) => {
    if (signal) stderr.write(`charon mcp proxy upstream exited by ${signal}\n`);
    else if (code && code !== 0) stderr.write(`charon mcp proxy upstream exited ${code}\n`);
  });

  const client = readline.createInterface({ input: process.stdin });
  const server = readline.createInterface({ input: child.stdout });

  client.on("line", async (line) => {
    const message = parseJson(line);
    if (!message || message.method !== "tools/call") {
      child.stdin.write(`${line}\n`);
      return;
    }

    const toolName = String(message.params?.name || "unknown");
    const result = await coordinator.enforce({
      runtime: "mcp",
      toolName,
      cwd,
      args: message.params?.arguments || {},
      metadata: {
        jsonrpcId: message.id,
        mcpMethod: message.method,
      },
    });
    const receiptPath = writeMcpReceipt(result.receipt, options.receiptsDir);

    if (result.decision.verdict === "PASS") {
      child.stdin.write(`${line}\n`);
      return;
    }

    process.stdout.write(`${JSON.stringify(blockedToolResult(message, result.decision.verdict, result.decision.reason, receiptPath))}\n`);
  });

  server.on("line", (line) => {
    process.stdout.write(`${line}\n`);
  });

  process.stdin.on("end", () => child.stdin.end());
  return child;
}

function parseJson(line: string): JsonRpcRequest | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function blockedToolResult(request: JsonRpcRequest, verdict: string, reason: string, receiptPath: string) {
  return {
    jsonrpc: "2.0",
    id: request.id,
    result: {
      content: [
        {
          type: "text",
          text: `Charon ${verdict}: ${reason}\nReceipt: ${receiptPath}`,
        },
      ],
      isError: true,
    },
  };
}
