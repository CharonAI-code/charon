import { inspectB20 } from "../src/inspect.js";

export default async function handler(req, res) {
  try {
    const query = req.query || {};
    const address = first(query.address);
    const chain = first(query.chain) || "base-sepolia";
    const rpcUrl = first(query.rpc) || undefined;
    const source = first(query.source);
    const includeSource = source === "1" || source === "true";

    if (!address) return json(res, 400, { error: "missing address", code: "MISSING_ADDRESS" });

    const report = await inspectB20({ address, chain, rpcUrl, includeSource });
    return json(res, 200, report);
  } catch (error) {
    return json(res, Number(error?.status || 500), {
      error: error instanceof Error ? error.message : String(error),
      code: error?.code || "INTERNAL_ERROR",
      details: error?.details || undefined
    });
  }
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function json(res, status, body) {
  res.status(status).json(body);
}
