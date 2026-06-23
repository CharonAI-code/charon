export function cleanError(step, error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    step,
    code: classifyError(step, message),
    message: firstLine(message)
  };
}

export function inspectError(code, message, status = 422, details = {}) {
  return Object.assign(new Error(message), { code, status, details });
}

function classifyError(step, message) {
  if (step === "input.address") return "INVALID_ADDRESS";
  if (step === "input.chain") return "UNSUPPORTED_CHAIN";
  if (/no contract deployed/i.test(message)) return "NO_CONTRACT";
  if (/not recognized/i.test(message)) return "NOT_B20";
  if (/returned no data|address is not a contract/i.test(message)) return "PRECOMPILE_INACTIVE";
  if (/timeout|timed out|abort/i.test(message)) return "RPC_TIMEOUT";
  if (/rate limit|too many requests|429/i.test(message)) return "RPC_RATE_LIMITED";
  if (/network|fetch failed|ECONNRESET|ENOTFOUND/i.test(message)) return "RPC_NETWORK_ERROR";
  if (/invalid address/i.test(message)) return "INVALID_ADDRESS";
  return "READ_FAILED";
}

function firstLine(message) {
  return String(message).split("\n")[0];
}
