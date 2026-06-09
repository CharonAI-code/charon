#!/usr/bin/env node
"use strict";

const { main } = require("../dist/src/cli");

main(process.argv.slice(2)).catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error(`charon: ${message}`);
  process.exitCode = err && Number.isInteger(err.exitCode) ? err.exitCode : 1;
});
