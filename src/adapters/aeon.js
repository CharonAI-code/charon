"use strict";

const { createCharon } = require("../cli");

function createAeonAdapter(options = {}) {
  const charon = createCharon(options);
  return {
    beforeToolCall(input) {
      return charon.gateToolCall({
        runtime: "aeon",
        skill: input.skill || input.skillName || "",
        toolName: input.toolName || input.tool || "tool",
        args: input.args,
        toolArgs: input.toolArgs,
        context: input.context || "",
      });
    },
  };
}

module.exports = { createAeonAdapter };
