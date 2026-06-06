"use strict";

const { createCharon } = require("../cli");

function createClaudeAdapter(options = {}) {
  const charon = createCharon(options);
  return {
    beforeToolCall(input) {
      return charon.gateToolCall({
        runtime: "claude",
        toolName: input.toolName || input.tool || "tool",
        args: input.args,
        toolArgs: input.toolArgs,
        context: input.context || "",
      });
    },
  };
}

module.exports = { createClaudeAdapter };
