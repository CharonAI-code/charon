"use strict";

const { createCharon } = require("../cli");

function createCodexAdapter(options = {}) {
  const charon = createCharon(options);
  return {
    beforeToolCall(input) {
      return charon.gateToolCall({
        runtime: "codex",
        toolName: input.toolName || input.tool || "tool",
        args: input.args,
        toolArgs: input.toolArgs,
        context: input.context || "",
      });
    },
  };
}

module.exports = { createCodexAdapter };
