const SAMPLE = "0xb200000000000000000000c7d17966dc5e587ba0";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const EXPLORER = {
  "base-sepolia": "https://sepolia.basescan.org",
  base: "https://basescan.org",
  vibenet: null,
};

const MAX_UINT128 = (1n << 128n) - 1n;

const dom = {
  address: $("#addressInput"),
  inspectBtn: $("#inspectBtn"),
  inspectText: $(".inspect-text"),
  notice: $("#notice"),
  loading: $("#loadingState"),
  results: $("#results"),
  liveBadge: $("#liveBadge"),
  isB20: $("#isB20"),
  initialized: $("#initialized"),
  variant: $("#variant"),
  features: $("#features"),
  tokenStack: $("#tokenStack"),
  totalSupply: $("#totalSupply"),
  supplyCap: $("#supplyCap"),
  supplyBar: $("#supplyBar"),
  policyTable: $("#policyTable"),
  pauseRow: $("#pauseRow"),
  permitStack: $("#permitStack"),
  sourceStack: $("#sourceStack"),
  rawJson: $("#rawJson"),
  copyJson: $("#copyJson"),
  riskIndicator: $("#riskIndicator"),
  riskPin: $("#riskPin"),
  riskDot: $("#riskDot"),
  riskNum: $("#riskNum"),
  riskScore: $("#riskScore"),
  riskReasons: $("#riskReasons"),
};

let currentReport = null;
let currentChain = "base-sepolia";
let abortController = null;

// ─── Init from URL ──────────────────────────────────────────────────────

function initFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const addr = params.get("address");
  const chain = params.get("chain");
  if (addr) dom.address.value = addr;
  if (chain && Object.prototype.hasOwnProperty.call(EXPLORER, chain)) {
    currentChain = chain;
    $$(".chain-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.chain === chain);
    });
  }
}

function updateUrl(address, chain) {
  const params = new URLSearchParams();
  params.set("address", address);
  params.set("chain", chain);
  window.history.replaceState(null, "", `?${params.toString()}`);
}

// ─── Events ──────────────────────────────────────────────────────────────

dom.inspectBtn.addEventListener("click", inspect);
dom.address.addEventListener("keydown", (e) => {
  if (e.key === "Enter") inspect();
});

dom.copyJson.addEventListener("click", async () => {
  if (!currentReport) return;
  await navigator.clipboard.writeText(JSON.stringify(currentReport, null, 2));
  dom.copyJson.textContent = "copied";
  setTimeout(() => (dom.copyJson.textContent = "copy json"), 1200);
});

dom.riskPin.addEventListener("click", () => {
  dom.riskIndicator.classList.toggle("open");
});

document.addEventListener("click", (event) => {
  if (!dom.riskIndicator.contains(event.target)) dom.riskIndicator.classList.remove("open");
});

$$(".chain-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".chain-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentChain = btn.dataset.chain;
    inspect();
  });
});

// ─── Inspect ─────────────────────────────────────────────────────────────

async function inspect() {
  const address = dom.address.value.trim() || SAMPLE;

  if (abortController) abortController.abort();
  abortController = new AbortController();

  setLoading(true);
  hideNotice();
  showLoading(true);
  showResults();

  try {
    const res = await fetch(
      `/api/inspect?chain=${encodeURIComponent(currentChain)}&address=${encodeURIComponent(address)}&source=1`,
      { signal: abortController.signal }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "inspection failed");
    currentReport = data;
    updateUrl(address, currentChain);
    render(data);
  } catch (err) {
    if (err.name === "AbortError") return;
    currentReport = null;
    clearResults();
    hideResults();
    showNotice(err instanceof Error ? err.message : String(err), "fail");
  } finally {
    showLoading(false);
    setLoading(false);
  }
}

// ─── Render ──────────────────────────────────────────────────────────────

function render(r) {
  const chain = r.chain || {};
  const token = r.token || {};
  const policies = Array.isArray(r.policies) ? r.policies : [];
  const pause = Array.isArray(r.pause) ? r.pause : [];
  const permit = r.permit || {};
  const source = r.source || {};
  const errors = Array.isArray(r.errors) ? r.errors : [];

  const isValid = Boolean(token.isB20);
  const isActive = Boolean(chain.b20FeaturesActive);
  setBadge(
    dom.liveBadge,
    isValid ? "live b20" : isActive ? "not b20" : "inactive",
    isValid ? "pass" : isActive ? "warn" : "fail"
  );

  dom.isB20.textContent = yn(token.isB20);
  dom.isB20.className = `kv-value ${token.isB20 ? "yes" : "no"}`;
  dom.initialized.textContent = yn(token.initialized);
  dom.initialized.className = `kv-value ${token.initialized ? "yes" : "no"}`;
  dom.variant.textContent = token.variant || "—";
  dom.variant.className = `kv-value`;
  dom.features.textContent = isActive ? "active" : "not active";
  dom.features.className = `kv-value ${isActive ? "yes" : "no"}`;

  // Risk indicator
  renderRisk(r.risk);

  // Token
  dom.tokenStack.innerHTML = stackRows([
    ["address", explorerLink(token.address, token.address)],
    ["name", token.name || "—"],
    ["symbol", token.symbol || "—"],
    ["decimals", token.decimals ?? "—"],
    ["contract", explorerLink(token.contractURI, token.contractURI)],
  ]);

  // Supply
  const total = safeBigInt(token.totalSupply);
  const cap = safeBigInt(token.supplyCap);
  const isUnboundedCap = cap === MAX_UINT128;
  const pct = cap > 0n && !isUnboundedCap ? Number((total * 100n) / cap) : 0;
  dom.totalSupply.textContent = formatUnits(token.totalSupply, token.decimals);
  dom.supplyCap.textContent = formatSupplyCap(token.supplyCap, token.decimals);
  dom.supplyCap.className = `kv-value ${isUnboundedCap ? "warn" : ""}`;
  dom.supplyBar.style.width = `${Math.min(pct, 100)}%`;

  // Policies
  dom.policyTable.innerHTML = policies
    .map(
      (p) => `
    <div class="policy-row">
      <span class="policy-scope">${p.scope}</span>
      <span class="policy-label ${policyClass(p.label)}">${p.label || "—"}</span>
      <span class="policy-admin">${p.admin ? shortAddr(p.admin) : "—"}</span>
    </div>
  `
    )
    .join("");

  // Pause
  dom.pauseRow.innerHTML = pause
    .map(
      (p) => `
    <div class="pause-item">
      <span class="pause-label">${p.feature}</span>
      <div class="pause-status ${p.paused ? "paused" : "active"}">
        <span class="pause-dot ${p.paused ? "paused" : "active"}"></span>
        ${p.paused ? "paused" : "active"}
      </div>
    </div>
  `
    )
    .join("");

  // Permit
  const eip = permit.eip712Domain;
  dom.permitStack.innerHTML = stackRows([
    ["eip712", eip ? "yes" : "no"],
    ["version", eip?.version || "—"],
    ["chain id", eip?.chainId || "—"],
    ["verifying", eip?.verifyingContract ? explorerLink(eip.verifyingContract, shortAddr(eip.verifyingContract)) : "—"],
    ["separator", permit.domainSeparator || "—"],
  ]);

  // Source
  const sourceFallback = r.timing?.sourceLookup === "not_found" ? "not found" : "not loaded";
  dom.sourceStack.innerHTML = stackRows([
    ["factory", explorerLink(source.factory, shortAddr(source.factory))],
    ["policy registry", explorerLink(source.policyRegistry, shortAddr(source.policyRegistry))],
    ["activation", explorerLink(source.activationRegistry, shortAddr(source.activationRegistry))],
    ["created block", source.creationBlock ? blockLink(source.creationBlock) : sourceFallback],
    ["tx", source.creationTx ? explorerLink(source.creationTx, shortAddr(source.creationTx)) : sourceFallback],
  ]);

  dom.rawJson.textContent = JSON.stringify(r, null, 2);

  if (errors.length) {
    showNotice(
      `${errors.length} read warning(s). See raw JSON for details.`,
      "warn"
    );
  }
}

function renderRisk(risk) {
  if (!risk || risk.score === undefined) {
    dom.riskIndicator.classList.add("hidden");
    return;
  }

  dom.riskIndicator.classList.remove("hidden");

  const level = risk.level;
  const score = clamp(Number(risk.score || 0), 0, 100);

  dom.riskIndicator.className = `risk-indicator ${level}`;
  dom.riskPin.style.left = `calc(${score}% + ${score === 0 ? "7px" : score === 100 ? "-7px" : "0px"})`;
  dom.riskPin.className = `risk-pin ${level}`;
  dom.riskDot.className = `risk-dot ${level}`;
  dom.riskNum.textContent = String(score);
  dom.riskNum.className = `risk-num ${level}`;
  dom.riskScore.textContent = String(score);

  const reasons = Array.isArray(risk.reasons) ? risk.reasons : [];

  if (!reasons.length) {
    dom.riskReasons.innerHTML = '<p class="risk-tooltip-empty">no risk flags</p>';
    return;
  }

  dom.riskReasons.innerHTML = reasons
    .map(
      (r) => `
    <div class="risk-reason ${r.severity}">
      <span class="risk-sev">${r.severity}</span>
      <span class="risk-detail">${r.detail}</span>
    </div>
  `
    )
    .join("");
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function stackRows(items) {
  return items
    .map(
      ([label, value]) => `
    <div class="stack-row">
      <span class="stack-label">${label}</span>
      <span class="stack-value">${value}</span>
    </div>
  `
    )
    .join("");
}

function explorerLink(address, display) {
  if (!address || address === "—") return "—";
  const base = EXPLORER[currentChain];
  if (!base) return `<span class="val-text">${address}</span>`;
  const isAddr = address.startsWith("0x") && address.length === 42;
  const isTx = address.startsWith("0x") && address.length === 66;
  if (isAddr) {
    return `<a class="explorer-link" href="${base}/address/${address}" target="_blank" rel="noopener">${display || address}</a>`;
  }
  if (isTx) {
    return `<a class="explorer-link" href="${base}/tx/${address}" target="_blank" rel="noopener">${display || address}</a>`;
  }
  if (address.startsWith("http")) {
    return `<a class="explorer-link" href="${address}" target="_blank" rel="noopener">${display || address}</a>`;
  }
  return `<span class="val-text">${address}</span>`;
}

function blockLink(block) {
  const base = EXPLORER[currentChain];
  if (!base) return block;
  return `<a class="explorer-link" href="${base}/block/${block}" target="_blank" rel="noopener">#${block}</a>`;
}

function setLoading(loading) {
  dom.inspectBtn.disabled = loading;
  dom.inspectText.textContent = loading ? "reading" : "inspect";
}

function showLoading(show) {
  dom.loading.classList.toggle("hidden", !show);
}

function showResults() {
  dom.results.classList.remove("hidden");
}

function hideResults() {
  dom.results.classList.add("hidden");
}

function clearResults() {
  setBadge(dom.liveBadge, "waiting", "");
  dom.isB20.textContent = "—";
  dom.initialized.textContent = "—";
  dom.variant.textContent = "—";
  dom.features.textContent = "—";
  dom.tokenStack.innerHTML = "";
  dom.totalSupply.textContent = "—";
  dom.supplyCap.textContent = "—";
  dom.supplyBar.style.width = "0%";
  dom.policyTable.innerHTML = "";
  dom.pauseRow.innerHTML = "";
  dom.permitStack.innerHTML = "";
  dom.sourceStack.innerHTML = "";
  dom.rawJson.textContent = "{}";
  dom.riskIndicator.classList.add("hidden");
}

function showNotice(msg, kind = "warn") {
  dom.notice.textContent = msg;
  dom.notice.className = `notice ${kind}`;
}

function hideNotice() {
  dom.notice.className = "notice hidden";
}

function setBadge(el, text, kind) {
  el.textContent = text;
  el.className = `badge ${kind}`;
}

function yn(v) {
  return v ? "yes" : "no";
}

function policyClass(label) {
  if (label === "CUSTOM") return "custom";
  if (label === "ALWAYS_BLOCK") return "block";
  return "allow";
}

function shortAddr(addr) {
  if (!addr) return "—";
  if (addr === "0x0000000000000000000000000000000000000000") return "zero";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function safeBigInt(value) {
  if (value === null || value === undefined) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function formatUnits(value, decimals) {
  if (value === null || value === undefined) return "—";
  try {
    const raw = BigInt(value);
    const d = Number(decimals || 0);
    if (!d) return raw.toLocaleString();
    const base = 10n ** BigInt(d);
    const whole = raw / base;
    const frac = raw % base;
    const fracText = frac.toString().padStart(d, "0").replace(/0+$/, "");
    return fracText
      ? `${whole.toLocaleString()}.${fracText}`
      : whole.toLocaleString();
  } catch {
    return "—";
  }
}

function formatSupplyCap(value, decimals) {
  const cap = safeBigInt(value);
  if (cap === MAX_UINT128) return "unbounded";
  return formatUnits(value, decimals);
}

// ─── Init ────────────────────────────────────────────────────────────────

initFromUrl();
inspect();
