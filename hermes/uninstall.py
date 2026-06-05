#!/usr/bin/env python3
from __future__ import annotations

import os
from pathlib import Path

try:
    import yaml
except Exception:
    yaml = None


PLUGIN_NAME = "charon"


def hermes_home() -> Path:
    home = os.getenv("HERMES_HOME")
    if home:
        return Path(home).expanduser()
    return Path("~/.hermes").expanduser()


def plugin_target() -> Path:
    return hermes_home() / "plugins" / PLUGIN_NAME


def remove_plugin_entry() -> None:
    path = hermes_home() / "config.yaml"
    if not path.exists() or yaml is None:
        return
    loaded = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(loaded, dict):
        return
    plugins = loaded.get("plugins")
    if not isinstance(plugins, dict):
        return
    enabled = plugins.get("enabled")
    if not isinstance(enabled, list):
        return
    plugins["enabled"] = [item for item in enabled if item != PLUGIN_NAME]
    path.write_text(yaml.safe_dump(loaded, sort_keys=False), encoding="utf-8")


def main() -> None:
    target = plugin_target()
    if target.is_symlink() or target.exists():
        if target.is_dir() and not target.is_symlink():
            raise SystemExit(f"Refusing to remove non-symlink directory: {target}")
        target.unlink()
    remove_plugin_entry()
    print(f"Removed Hermes plugin link at {target}")
    print("Kept ~/.hermes/charon.yaml and ~/.hermes/charon/receipts/")


if __name__ == "__main__":
    main()
