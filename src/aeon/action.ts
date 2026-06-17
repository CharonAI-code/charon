// @ts-nocheck
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { createActionRequest } = require("../action");

function createAeonAction(input) {
  const skill = String(input.skill || "");
  const trigger = String(input.trigger || "unknown");
  const repo = String(input.repo || process.env.GITHUB_REPOSITORY || "");
  const variable = String(input.var || "");
  const resources = [
    { role: "mcp-tool", value: `aeon.skill:${skill}`, source: "aeon.skill" },
    { role: "unknown", value: `aeon.trigger:${trigger}`, source: "aeon.trigger" },
  ];
  if (variable) resources.push({ role: "unknown", value: `aeon.var:${variable}`, source: "aeon.var" });
  if (repo) resources.push({ role: "git-remote-url", value: `https://github.com/${repo}`, source: "github.repository" });
  const skillMeta = readSkillMetadata(input.cwd, skill);
  if (skillMeta.commits) resources.push({ role: "write-path", value: ".", source: "skill.commits" });
  for (const permission of skillMeta.permissions) resources.push({ role: "unknown", value: `aeon.permission:${permission}`, source: "skill.permissions" });
  for (const required of skillMeta.requires) resources.push({ role: "unknown", value: `aeon.requires:${required}`, source: "skill.requires" });
  for (const mcp of skillMeta.mcp) resources.push({ role: "mcp-tool", value: `aeon.mcp:${mcp}`, source: "skill.mcp" });
  return createActionRequest({
    id: input.id || `aeon-${crypto.randomUUID()}`,
    runtime: "aeon",
    toolName: "aeon.skill.preflight",
    args: {
      skill,
      var: variable,
      trigger,
      repo,
      runId: input.runId,
      actor: input.actor,
    },
    cwd: input.cwd,
    actor: { id: String(input.actor || ""), runtime: "github-actions" },
    resources,
    context: `Aeon preflight for skill ${skill}`,
    metadata: {
      skill,
      trigger,
      repo,
      runId: input.runId,
      actor: input.actor,
      skillMeta,
    },
  });
}

function readSkillMetadata(cwd, skill) {
  const empty = { commits: false, permissions: [], requires: [], mcp: [] };
  if (!skill || !/^[a-zA-Z0-9_-]+$/.test(skill)) return empty;
  const file = path.join(cwd, "skills", skill, "SKILL.md");
  if (!fs.existsSync(file)) return empty;
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return empty;
  try {
    const meta = yaml.load(match[1]) || {};
    return {
      commits: meta.commits === true,
      permissions: arrayOfStrings(meta.permissions),
      requires: arrayOfStrings(meta.requires),
      mcp: arrayOfStrings(meta.mcp),
    };
  } catch {
    return empty;
  }
}

function arrayOfStrings(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

module.exports = { createAeonAction, readSkillMetadata };
