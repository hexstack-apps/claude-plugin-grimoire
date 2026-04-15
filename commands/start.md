---
name: grimoire
description: Launch Claude Grimoire — visual GUI for managing commands, agents, pipelines, and prompts
user-invocable: true
---

Launch the Claude Grimoire desktop application.

**Step 1 — Update the plugin to the latest version (non-blocking).** If the update fails (offline, network issue, etc.) continue anyway so the user can still launch whatever version they already have installed:

```bash
claude plugin install grimoire 2>&1 || true
```

**Step 2 — Ensure Bun is installed.** If it isn't, install it:

```bash
command -v bun >/dev/null 2>&1 || curl -fsSL https://bun.sh/install | bash
```

**Step 3 — Launch the app:**

```bash
bun "${CLAUDE_PLUGIN_ROOT}/launcher.js"
```

After launching, inform the user that Grimoire has been started (and whether the update step succeeded).
