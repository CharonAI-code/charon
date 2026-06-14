"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ACTIONS, POLICY_YAML, type SimAction } from "../lib/simulation-data";

type Speed = 1 | 3 | 5;

const RULE_TO_YAML_LINE: Record<string, number> = {
  "default.pass": 1,
  "bounds.pause": 3,
  "release.git_push": 3,
  "bounds.deny": 7,
  "release.npm_publish": 7,
  "controls.network.default": 7,
  "controls.files.write": 12,
  "controls.files.deny": 14,
  "controls.network.allow": 15,
  "controls.commands.deny": 17,
  "inspection.obfuscation": 19,
};

function getYamlLine(ruleId: string): number {
  return RULE_TO_YAML_LINE[ruleId] ?? 1;
}

const yamlLines = POLICY_YAML.split("\n");

export default function SimulationTerminal() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState<Speed>(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(true);
  const [showPause, setShowPause] = useState(true);
  const [showDeny, setShowDeny] = useState(true);
  const tableRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const onTableScroll = useCallback(() => {
    const el = tableRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const baseDelay = useMemo(() => {
    return speed === 1 ? 350 : speed === 3 ? 120 : 70;
  }, [speed]);

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => {
      setCurrentIndex((i) => (i + 1) % ACTIONS.length);
    }, baseDelay);
    return () => clearTimeout(timer);
  }, [running, currentIndex, baseDelay]);

  const visibleActions = useMemo(() => {
    return ACTIONS.slice(0, currentIndex + 1).filter((a) => {
      if (a.verdict === "PASS" && !showPass) return false;
      if (a.verdict === "PAUSE" && !showPause) return false;
      if (a.verdict === "DENY" && !showDeny) return false;
      return true;
    });
  }, [currentIndex, showPass, showPause, showDeny]);

  const currentAction = visibleActions[visibleActions.length - 1] ?? ACTIONS[0];
  const selectedAction = selectedId
    ? visibleActions.find((a) => a.id === selectedId) ?? currentAction
    : currentAction;
  const activeLine = getYamlLine(selectedAction.ruleId);

  useEffect(() => {
    const el = tableRef.current;
    if (!el || !running) return;
    if (atBottomRef.current) {
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [visibleActions.length, running]);

  const handleClick = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "8px 40px 40px 40px",
        maxWidth: "860px",
        width: "100%",
        position: "relative",
        zIndex: 1,
      }}
    >
      {/* Controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          border: "1px solid #1e1a1a",
          borderBottom: "none",
          fontSize: "11px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={() => setRunning(!running)}
            style={{
              width: "22px",
              height: "22px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid #5a5454",
              color: "#8a8282",
              fontSize: "9px",
            }}
          >
            {running ? "||" : ">"}
          </button>
          {running && <span className="charon-pulse-dot" />}
          {([1, 3, 5] as Speed[]).map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              style={{
                color: speed === s ? "#f0ece4" : "#5a5454",
                fontWeight: speed === s ? 700 : 400,
              }}
            >
              {s}x
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <FilterToggle label="PASS" active={showPass} color="#4a8a5c" onClick={() => setShowPass(!showPass)} />
          <FilterToggle label="PAUSE" active={showPause} color="#c49a74" onClick={() => setShowPause(!showPause)} />
          <FilterToggle label="DENY" active={showDeny} color="#a05040" onClick={() => setShowDeny(!showDeny)} />
        </div>
      </div>

      {/* Simulation table */}
      <div
        style={{
          border: "1px solid #1e1a1a",
          borderBottom: "none",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "72px 64px 140px 1fr 72px",
            padding: "0 12px",
            borderBottom: "1px solid #1e1a1a",
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "#5a5454",
            lineHeight: "28px",
          }}
        >
          <span>seq</span>
          <span>actor</span>
          <span>tool</span>
          <span>resource</span>
          <span>verdict</span>
        </div>
        <div
          ref={tableRef}
          onScroll={onTableScroll}
          style={{
            height: "360px",
            overflowY: "auto",
            padding: "0 12px",
          }}
        >
          {visibleActions.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              isSelected={selectedId === action.id}
              onClick={() => handleClick(action.id)}
            />
          ))}
        </div>
      </div>

      {/* Bottom: YAML + Receipt */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          border: "1px solid #1e1a1a",
          borderTop: "none",
        }}
      >
        <div
          style={{
            borderRight: "1px solid #1e1a1a",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "6px 12px",
              fontSize: "10px",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "#5a5454",
              borderBottom: "1px solid #1e1a1a",
              background: "#131010",
            }}
          >
            charon.yml
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              lineHeight: 1.6,
              paddingBottom: "8px",
            }}
          >
            {yamlLines.map((line, i) => {
              const isActive = i === activeLine;
              const isInBlock =
                (activeLine === 3 && i >= 3 && i <= 6) ||
                (activeLine === 7 && i >= 7 && i <= 11) ||
                (activeLine === 12 && i >= 12 && i <= 13) ||
                (activeLine === 15 && i >= 15 && i <= 16) ||
                (activeLine === 17 && i >= 17 && i <= 18);

              return (
                <div
                  key={i}
                  data-line={i}
                  style={{
                    padding: "0 12px",
                    borderLeft: isActive || isInBlock ? "2px solid #e8a040" : "2px solid transparent",
                    background: isActive || isInBlock ? "rgba(232,160,64,0.06)" : "transparent",
                    color: line.trimStart().startsWith("-")
                      ? "#5a5454"
                      : isActive || isInBlock
                        ? "#f0ece4"
                        : "#5a5454",
                    whiteSpace: "pre",
                  }}
                >
                  {line}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              padding: "6px 12px",
              fontSize: "10px",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "#5a5454",
              borderBottom: "1px solid #1e1a1a",
              background: "#131010",
            }}
          >
            receipt
          </div>
          <ReceiptFeed action={selectedAction} />
        </div>
      </div>
    </div>
  );
}

function ActionRow({
  action,
  isSelected,
  onClick,
}: {
  action: SimAction;
  isSelected: boolean;
  onClick: () => void;
}) {
  const verdictStyle =
    action.verdict === "PASS"
      ? { color: "#4a8a5c" }
      : action.verdict === "PAUSE"
        ? { color: "#c49a74" }
        : { color: "#a05040" };

  return (
    <button
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "72px 64px 140px 1fr 72px",
        width: "100%",
        alignItems: "center",
        borderBottom: "1px solid #1e1a1a",
        padding: "6px 0",
        fontSize: "11px",
        fontFamily: "var(--font-mono)",
        background: isSelected ? "rgba(232,160,64,0.05)" : "transparent",
        textAlign: "left" as const,
        color: "#f0ece4",
        cursor: "pointer",
        transition: "background 160ms ease",
      }}
    >
      <span style={{ color: "#5a5454", fontVariantNumeric: "tabular-nums" }}>
        {action.id.replace("req_", "")}
      </span>
      <span style={{ color: "#8a8282" }}>{action.runtime}</span>
      <span style={{ color: "#e8a040" }}>{action.toolName}</span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {action.resource}
      </span>
      <span
        style={{
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontSize: "10px",
          ...verdictStyle,
        }}
      >
        {action.verdict}
      </span>
    </button>
  );
}

function ReceiptFeed({ action }: { action: SimAction }) {
  const verdictColor =
    action.verdict === "PASS"
      ? "#4a8a5c"
      : action.verdict === "PAUSE"
        ? "#c49a74"
        : "#a05040";

  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        lineHeight: 1.8,
      }}
    >
      <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div>
          <span style={{ color: "#5a5454" }}>id</span>{" "}
          <span style={{ color: "#f0ece4" }}>{action.id}</span>
        </div>
        <div>
          <span style={{ color: "#5a5454" }}>verdict</span>{" "}
          <span style={{ color: verdictColor, fontWeight: 700, textTransform: "uppercase" }}>
            {action.verdict}
          </span>
        </div>
        <div>
          <span style={{ color: "#5a5454" }}>rule</span>{" "}
          <span style={{ color: "#e8a040" }}>{action.ruleId}</span>
        </div>
        {action.findings.length > 0 && (
          <div>
            <span style={{ color: "#5a5454" }}>findings</span>{" "}
            <span style={{ color: "#f0ece4" }}>
              {action.findings.map((f) => `[${f}]`).join(" ")}
            </span>
          </div>
        )}
        <div>
          <span style={{ color: "#5a5454" }}>receipt</span>{" "}
          <span style={{ color: "#5a5454", fontSize: "10px" }}>
            {action.receiptHash.slice(0, 26)}...
          </span>
        </div>
        <div>
          <span style={{ color: "#5a5454" }}>policy</span>{" "}
          <span style={{ color: "#5a5454", fontSize: "10px" }}>
            {action.policyHash.slice(0, 26)}...
          </span>
        </div>
        <div>
          <span style={{ color: "#5a5454" }}>time</span>{" "}
          <span style={{ color: "#8a8282" }}>{action.timestamp}</span>
        </div>
      </div>
    </div>
  );
}

function FilterToggle({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        color: active ? color : "#5a5454",
        fontWeight: active ? 700 : 400,
        fontSize: "11px",
      }}
    >
      {label}
    </button>
  );
}
