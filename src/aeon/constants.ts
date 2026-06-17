// @ts-nocheck
"use strict";

const path = require("path");

const CONFIG = "charon.aeon.yml";
const STATE_DIR = ".charon";
const RECEIPTS_DIR = path.join(STATE_DIR, "receipts");
const AEON_DIR = path.join(STATE_DIR, "aeon");
const REVIEWS_DIR = path.join(AEON_DIR, "reviews");
const TELEGRAM_DIR = path.join(AEON_DIR, "telegram");
const EXPORTS_DIR = path.join(AEON_DIR, "exports");
const PREFLIGHT_START = "# >>> charon aeon preflight";
const PREFLIGHT_END = "# <<< charon aeon preflight";

module.exports = {
  CONFIG,
  STATE_DIR,
  RECEIPTS_DIR,
  AEON_DIR,
  REVIEWS_DIR,
  TELEGRAM_DIR,
  EXPORTS_DIR,
  PREFLIGHT_START,
  PREFLIGHT_END,
};
