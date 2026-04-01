---
name: grimoire
description: Launch Claude Grimoire — visual GUI for managing commands, agents, pipelines, and prompts
user-invocable: true
---

Launch the Claude Grimoire desktop application.

First, check if Bun is installed. If not, install it:

```bash
command -v bun >/dev/null 2>&1 || curl -fsSL https://bun.sh/install | bash
```

Then run the launcher script:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/launcher.js"
```

After launching, inform the user that Grimoire has been started.
