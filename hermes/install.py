#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
from pathlib import Path

try:
    import yaml
except Exception:
    yaml = None


ROOT = Path(__file__).resolve().parent
PLUGIN_NAME = "charon"


def hermes_home() -> Path:
    home = os.getenv("HERMES_HOME")
    if home:
        return Path(home).expanduser()
    return Path("~/.hermes").expanduser()


def install_target() -> Path:
    return hermes_home() / "plugins" / PLUGIN_NAME


def default_policy() -> str:
    return """mode: strict

red_lines:
  never_expose:
    - GITHUB_TOKEN
    - GH_TOKEN
    - ANTHROPIC_API_KEY
    - CLAUDE_CODE_OAUTH_TOKEN
    - OPENAI_API_KEY
  never_read:
    - .env
    - .env.local
    - .env.production
    - .env.development
    - .env.test
    - .envrc
    - ~/.ssh/**
    - ~/.aws/**
  never_call:
    - pastebin.com
    - webhook.site
  irreversible:
    default: block
    commands:
      - git push
      - gh pr merge
      - gh release create
      - npm publish
      - rm -rf

terminal:
  allow_hosts:
    - api.github.com
"""


def ensure_policy_file() -> None:
    path = hermes_home() / "charon.yaml"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(default_policy(), encoding="utf-8")


def ensure_config_enabled() -> None:
    path = hermes_home() / "config.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    if yaml is None:
        if not path.exists():
            path.write_text("plugins:\n  enabled:\n    - charon\n", encoding="utf-8")
        else:
            text = path.read_text(encoding="utf-8")
            if "plugins:" not in text or "charon" not in text:
                with path.open("a", encoding="utf-8") as fh:
                    fh.write("\nplugins:\n  enabled:\n    - charon\n")
        return

    data = {}
    if path.exists():
        loaded = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if isinstance(loaded, dict):
            data = loaded
    plugins = data.setdefault("plugins", {})
    enabled = plugins.setdefault("enabled", [])
    if not isinstance(enabled, list):
        enabled = []
        plugins["enabled"] = enabled
    if PLUGIN_NAME not in enabled:
        enabled.append(PLUGIN_NAME)
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")


def install_plugin() -> None:
    target = install_target()
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() or target.is_symlink():
        if target.is_symlink() and target.resolve() == ROOT:
            return
        if target.is_dir() and not target.is_symlink():
            shutil.rmtree(target)
        else:
            target.unlink()
    target.symlink_to(ROOT, target_is_directory=True)


def main() -> None:
    install_plugin()
    ensure_config_enabled()
    ensure_policy_file()
    print(f"Installed Charon for Hermes at {install_target()}")
    print(f"Enabled plugin in {hermes_home() / 'config.yaml'}")
    print(f"Policy file: {hermes_home() / 'charon.yaml'}")


if __name__ == "__main__":
    main()
