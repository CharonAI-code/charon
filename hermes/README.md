# Charon for Hermes

Charon for Hermes is a native Hermes plugin.

It plugs into Hermes's real hook system and guards tool execution before it
runs.

## What It Does

- blocks terminal commands that hit denied hosts
- blocks terminal commands that try to exfiltrate denied env vars
- blocks terminal commands that match irreversible red lines
- blocks explicit red-line file reads on Hermes file tools
- writes per-tool receipts under `~/.hermes/charon/receipts/`
- redacts tool results before they return to model context

## Files

- [plugin.yaml](./plugin.yaml)
- [__init__.py](./__init__.py)
- [install.py](./install.py)
- [uninstall.py](./uninstall.py)
- [tests/test_charon_hermes.py](./tests/test_charon_hermes.py)

## Install

From this repo:

```bash
python3 charon/hermes/install.py
```

That will:

- install or symlink the plugin into `~/.hermes/plugins/charon`
- add `charon` to `plugins.enabled` in `~/.hermes/config.yaml`
- create `~/.hermes/charon.yaml` if it does not exist

Remove it:

```bash
python3 charon/hermes/uninstall.py
```

## Policy

Default policy file:

```txt
~/.hermes/charon.yaml
```

Main controls:

- `red_lines.never_expose`
- `red_lines.never_read`
- `red_lines.never_call`
- `red_lines.irreversible.commands`
- `terminal.allow_hosts`

## Test

```bash
python3 -m unittest discover -s charon/hermes/tests -p 'test_*.py'
```
