#!/bin/bash
# SessionStart hook: provision the IPOR Fusion MCP server (fusion-mcp).
#
# The system Python can't install ipor-fusion globally (a transitive dep needs
# PyJWT 2.13, but the debian-installed PyJWT 2.7 can't be uninstalled), so we
# install into a dedicated venv and put its bin dir on PATH for the session.
# That lets .mcp.json launch the server with the plain `fusion-mcp` command.
set -euo pipefail

# Only needed in Claude Code on the web; local users install via pipx instead.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
VENV="$PROJECT_DIR/.venv-fusion"

# Idempotent: only build + install when the entry point is missing.
if [ ! -x "$VENV/bin/fusion-mcp" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet 'ipor-fusion[mcp]'
fi

# Expose fusion-mcp on PATH so .mcp.json's `fusion-mcp` command resolves.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$VENV/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
