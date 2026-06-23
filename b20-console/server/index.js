#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectB20 } from "../src/inspect.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const webRoot = path.join(root, "web");
const port = Number(process.env.PORT || 4173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/inspect") {
      const address = url.searchParams.get("address");
      const chain = url.searchParams.get("chain") || "base-sepolia";
      const rpcUrl = url.searchParams.get("rpc") || undefined;
      const includeSource = url.searchParams.get("source") === "1" || url.searchParams.get("source") === "true";
      if (!address) return json(res, 400, { error: "missing address" });
      const report = await inspectB20({ address, chain, rpcUrl, includeSource });
      return json(res, 200, report);
    }
    return serveStatic(url.pathname, res);
  } catch (error) {
    const status = Number(error?.status || 500);
    return json(res, status, {
      error: error instanceof Error ? error.message : String(error),
      code: error?.code || "INTERNAL_ERROR",
      details: error?.details || undefined
    });
  }
});

async function serveStatic(requestPath, res) {
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(webRoot, cleanPath));
  if (!filePath.startsWith(webRoot)) return notFound(res);
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, { "content-type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    return notFound(res);
  }
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function notFound(res) {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
}

server.listen(port, () => {
  console.log(`B20 Console running at http://localhost:${port}`);
});
