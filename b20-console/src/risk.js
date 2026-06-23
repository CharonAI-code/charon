const MAX_UINT128 = (1n << 128n) - 1n;

export function assessRisk(report) {
  const reasons = [];

  if (!report.chain.b20FeaturesActive) {
    add(reasons, 30, "high", "b20_features_inactive", "B20 features are not active on this chain.");
  }

  if (!report.token.isB20) {
    add(reasons, 40, "high", "not_b20", "The factory does not recognize this address as a B20 token.");
  }

  if (report.token.isB20 && !report.token.initialized) {
    add(reasons, 30, "high", "not_initialized", "The address matches B20 format but is not initialized.");
  }

  if (!report.chain.b20FeaturesActive || !report.token.isB20 || !report.token.initialized) {
    return finalize(reasons, report);
  }

  for (const policy of report.policies) {
    if (policy.id === null) {
      add(reasons, 12, "medium", `policy_read_failed.${policy.scope}`, `${policy.scope} could not be read.`);
      continue;
    }
    if (policy.label === "ALWAYS_BLOCK") {
      add(reasons, 24, "high", `policy_always_block.${policy.scope}`, `${policy.scope} blocks every matching operation.`);
    } else if (policy.label === "CUSTOM") {
      add(reasons, 18, "medium", `policy_custom.${policy.scope}`, `${policy.scope} uses a custom policy.`);
    }
    if (policy.exists === false) {
      add(reasons, 20, "high", `policy_missing.${policy.scope}`, `${policy.scope} points to a policy ID that does not exist.`);
    }
    if (policy.admin && !isZeroAddress(policy.admin)) {
      add(reasons, 10, "medium", `policy_admin.${policy.scope}`, `${policy.scope} has an active policy admin.`);
    }
    if (policy.pendingAdmin && !isZeroAddress(policy.pendingAdmin)) {
      add(reasons, 8, "medium", `policy_pending_admin.${policy.scope}`, `${policy.scope} has a pending policy admin transfer.`);
    }
  }

  for (const item of report.pause) {
    if (item.paused === true) {
      add(reasons, 15, "medium", `paused.${item.feature}`, `${item.feature} is currently paused.`);
    } else if (item.paused === null) {
      add(reasons, 8, "medium", `pause_read_failed.${item.feature}`, `${item.feature} pause state could not be read.`);
    }
  }

  if (report.token.supplyCap === null) {
    add(reasons, 8, "medium", "supply_cap_unknown", "Supply cap could not be read.");
  } else {
    const supplyCap = BigInt(report.token.supplyCap);
    if (supplyCap === MAX_UINT128) {
      add(reasons, 15, "medium", "supply_cap_unbounded", "Supply cap is set to the B20 max sentinel.");
    }
    if (report.token.totalSupply !== null && BigInt(report.token.totalSupply) > supplyCap) {
      add(reasons, 35, "high", "supply_exceeds_cap", "Total supply is greater than the reported supply cap.");
    }
  }

  if (!report.permit.eip712Domain || !report.permit.domainSeparator) {
    add(reasons, 6, "low", "permit_incomplete", "Permit domain could not be fully read.");
  }

  for (const error of report.errors) {
    if (error.code === "PRECOMPILE_INACTIVE") continue;
    add(reasons, 4, "low", `read_warning.${error.step}`, `${error.step} returned ${error.code}.`);
  }

  return finalize(reasons, report);
}

function add(reasons, points, severity, id, detail) {
  reasons.push({ points, severity, id, detail });
}

function riskLevel(score, report) {
  if (report.errors.length > 0 && score === 0) return "unknown";
  if (score >= 60) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function finalize(reasons, report) {
  const score = Math.min(100, reasons.reduce((sum, reason) => sum + reason.points, 0));
  return {
    level: riskLevel(score, report),
    score,
    methodology: "deterministic_rules_v1",
    reasons: reasons.map(({ points, ...reason }) => reason)
  };
}

function isZeroAddress(address) {
  return /^0x0{40}$/i.test(address);
}
