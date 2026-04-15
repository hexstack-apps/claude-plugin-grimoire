#!/usr/bin/env bun
import { mkdirSync, writeFileSync, existsSync, rmSync, chmodSync } from "fs";
import { homedir, platform, arch } from "os";
import { join, sep } from "path";
import { execSync } from "child_process";

// ─── Inlined CLI utilities (no external deps) ──────────────────────────────

interface CommandResult { ok: boolean; error?: string; [key: string]: any; }
type CommandHandler = (args: string[]) => CommandResult | Promise<CommandResult>;
type CommandDict = Record<string, CommandHandler>;

function parseArgs(argv: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  let i = 0;
  while (i < argv.length) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) { flags[key] = argv[i + 1]; i += 2; }
      else { flags[key] = "true"; i += 1; }
    } else { positional.push(argv[i]); i += 1; }
  }
  return { flags, positional };
}

function run(cmd: string, timeoutMs = 30_000): string {
  return execSync(cmd, { encoding: "utf-8", timeout: timeoutMs }).trim();
}

function tryRun(cmd: string, timeoutMs = 30_000): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: timeoutMs }).trim();
    return { ok: true, stdout, stderr: "" };
  } catch (e: any) {
    return { ok: false, stdout: e.stdout?.toString().trim() || "", stderr: e.stderr?.toString().trim() || e.message };
  }
}

function loginShell(cmd: string): string {
  const p = platform();
  if (p === "win32") return cmd;
  const shell = p === "darwin" ? "/bin/zsh" : "/bin/bash";
  const escaped = cmd.replace(/'/g, "'\\''");
  return `${shell} -lc '${escaped}'`;
}

function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[\s_]+/g, "-").replace(/[^a-zA-Z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

function sanitizeForShell(str: string): string {
  return str.replace(/[`$\\!"'\n\r]/g, "");
}

// ─── Builtin commands ───────────────────────────────────────────────────────

function cmdBuiltinOsInfo(): CommandResult {
  const p = platform();
  return { ok: true, platform: p, arch: arch(), homedir: homedir(), pathSep: sep, isWindows: p === "win32", isMac: p === "darwin", isLinux: p === "linux" };
}

function cmdHomeDir(): CommandResult { return { ok: true, homedir: homedir() }; }

function cmdEnsureDir(args: string[]): CommandResult {
  const { positional } = parseArgs(args);
  if (!positional[0]) return { ok: false, error: "ensure-dir requires a path argument" };
  mkdirSync(positional[0], { recursive: true });
  return { ok: true };
}

function cmdRemoveDir(args: string[]): CommandResult {
  const { positional } = parseArgs(args);
  if (!positional[0]) return { ok: false, error: "remove-dir requires a path argument" };
  if (existsSync(positional[0])) rmSync(positional[0], { recursive: true, force: true });
  return { ok: true };
}

function cmdOpenFile(args: string[]): CommandResult {
  const { positional } = parseArgs(args);
  if (!positional[0]) return { ok: false, error: "open-file requires a path argument" };
  const p = platform();
  try {
    if (p === "win32") tryRun(`powershell -Command "Start-Process '${positional[0].replace(/'/g, "''")}'"`);
    else if (p === "darwin") execSync(`open "${positional[0]}"`, { stdio: "ignore" });
    else execSync(`xdg-open "${positional[0]}"`, { stdio: "ignore" });
    return { ok: true };
  } catch (e: any) { return { ok: false, error: `Failed to open file: ${e.message}` }; }
}

function cmdOpenFolder(args: string[]): CommandResult {
  const { positional } = parseArgs(args);
  if (!positional[0]) return { ok: false, error: "open-folder requires a path argument" };
  const p = platform();
  try {
    if (p === "win32") tryRun(`powershell -Command "Invoke-Item '${positional[0].replace(/'/g, "''")}'"`);
    else if (p === "darwin") execSync(`open "${positional[0]}"`, { stdio: "ignore" });
    else execSync(`xdg-open "${positional[0]}"`, { stdio: "ignore" });
    return { ok: true };
  } catch (e: any) { return { ok: false, error: `Failed to open folder: ${e.message}` }; }
}

function getConfigDir(): string {
  if (platform() === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "claude");
  }
  return join(homedir(), ".claude");
}

// ─── Grimoire commands ──────────────────────────────────────────────────────

function cmdOsInfo(): CommandResult {
  const p = platform();
  return {
    ok: true, platform: p, arch: process.arch, homedir: homedir(),
    configDir: getConfigDir(), pathSep: sep,
    isWindows: p === "win32", isMac: p === "darwin", isLinux: p === "linux",
  };
}

function cmdLaunchTerminal(args: string[]): CommandResult {
  const { flags, positional } = parseArgs(args);
  const command = positional[0];
  if (!command) return { ok: false, error: "launch-terminal requires a command argument" };
  const title = flags["title"];
  const p = platform();

  if (p === "win32") {
    const escaped = command.replace(/"/g, '""');
    const r = tryRun(`wt new-tab cmd /k "${escaped}"`);
    if (!r.ok) run(`cmd /c start cmd /k "${escaped}"`);
  } else if (p === "darwin") {
    const escapedCmd = command.replace(/'/g, "'\\''");
    const escapedForAS = escapedCmd.replace(/"/g, '\\"');
    const parts = [`osascript`, `-e 'tell application "Terminal"'`];
    if (title) {
      parts.push(`-e 'set newTab to do script "${escapedForAS}"'`);
      parts.push(`-e 'set custom title of newTab to "${title}"'`);
    } else {
      parts.push(`-e 'do script "${escapedForAS}"'`);
    }
    parts.push(`-e 'end tell'`);
    execSync(parts.join(" "), { stdio: "ignore" });
  } else {
    const escaped = command.replace(/'/g, "'\\''");
    const terminals = [
      `gnome-terminal -- bash -ilc '${escaped}; exec bash'`,
      `konsole -e bash -ilc '${escaped}; exec bash'`,
      `xfce4-terminal -e "bash -ilc '${escaped}; exec bash'"`,
      `xterm -e bash -ilc '${escaped}; exec bash'`,
    ];
    let launched = false;
    for (const term of terminals) {
      if (tryRun(term).ok) { launched = true; break; }
    }
    if (!launched) return { ok: false, error: "No compatible terminal emulator found" };
  }
  return { ok: true };
}

function cmdRunEntity(args: string[]): CommandResult {
  const { flags } = parseArgs(args);
  const entityType = flags["type"];
  const name = flags["name"];
  if (!entityType || !name) return { ok: false, error: "run-entity requires --type and --name" };

  const prompt = flags["prompt"] ? sanitizeForShell(flags["prompt"]) : "";
  const cwd = flags["cwd"];
  const title = flags["title"];
  const skipPermissions = flags["skip-permissions"] === "true";
  const cliFlags = skipPermissions ? " --dangerously-skip-permissions" : "";
  const configDir = getConfigDir();
  const isWindows = platform() === "win32";
  const pathSep = isWindows ? "\\" : "/";

  let command = "";
  switch (entityType) {
    case "command":
      command = `claude${cliFlags} /${toKebabCase(name)}`;
      if (prompt) command += ` "${prompt}"`;
      break;
    case "agent": {
      const agentPath = [configDir, "agents", `${toKebabCase(name)}.md`].join(pathSep);
      command = isWindows
        ? (prompt ? `(type "${agentPath}" & echo --- & echo "${prompt}") | claude${cliFlags}` : `type "${agentPath}" | claude${cliFlags}`)
        : (prompt ? `(cat "${agentPath}"; echo "---"; echo "${prompt}") | claude${cliFlags}` : `claude${cliFlags} < "${agentPath}"`);
      break;
    }
    case "pipeline":
      command = `claude${cliFlags} /pipeline-${toKebabCase(name)}`;
      if (prompt) command += ` "${prompt}"`;
      break;
    case "prompt": {
      const promptPath = [configDir, "cco-prompts", `${toKebabCase(name)}.md`].join(pathSep);
      command = isWindows
        ? (prompt ? `(type "${promptPath}" & echo --- & echo "${prompt}") | claude${cliFlags}` : `type "${promptPath}" | claude${cliFlags}`)
        : (prompt ? `(cat "${promptPath}"; echo "---"; echo "${prompt}") | claude${cliFlags}` : `claude${cliFlags} < "${promptPath}"`);
      break;
    }
    default:
      return { ok: false, error: `Unknown entity type: ${entityType}` };
  }

  if (cwd) command = isWindows ? `cd /d "${cwd}" && ${command}` : `cd "${cwd}" && ${command}`;
  return cmdLaunchTerminal(title ? [command, "--title", title] : [command]);
}

async function cmdCheckVersion(args: string[]): Promise<CommandResult> {
  const { flags } = parseArgs(args);
  const currentVersion = flags["current"] || "0.0.0";
  try {
    const response = await fetch("https://hexstack.app/claude-grimoire/version.json", { signal: AbortSignal.timeout(5000) });
    const data = await response.json() as { version?: string };
    const latest = data?.version;
    if (!latest) return { ok: true, available: false, latest: null };
    const r = latest.split(".").map(Number), l = currentVersion.split(".").map(Number);
    let available = false;
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
      if ((r[i] ?? 0) > (l[i] ?? 0)) { available = true; break; }
      if ((r[i] ?? 0) < (l[i] ?? 0)) break;
    }
    return { ok: true, available, latest };
  } catch (e: any) {
    return { ok: false, error: `Version check failed: ${e.message}` };
  }
}

// ─── Git operations ─────────────────────────────────────────────────────────

const GIT_AUTHOR = 'CCO Backup <cco@local>';
const GIT_COMMIT_PREFIX = "cco-backup";
const GIT_MAX_COMMITS = 200;
const GITIGNORE_CONTENT = `# Ignore everything\n*\n\n# Allow specific directories and their contents\n!commands/\n!commands/**\n!agents/\n!agents/**\n!cco-prompts/\n!cco-prompts/**\n\n# Allow this file\n!.gitignore\n`;

function gitCmd(dir: string, args: string): string { return run(`git -C "${dir}" ${args}`); }
function gitCmdSafe(dir: string, args: string) { return tryRun(`git -C "${dir}" ${args}`); }
function stageEntityFiles(dir: string): void {
  gitCmd(dir, "read-tree --empty"); gitCmd(dir, "add --force .gitignore");
  for (const d of ["commands", "agents", "cco-prompts"]) { try { gitCmd(dir, `add ${d}/`); } catch {} }
}
function formatTimestamp(): string { return new Date().toISOString().replace(/[:.]/g, "-"); }

function cmdGitInit(): CommandResult {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, ".git"))) run(`git init -b main "${dir}"`);
  writeFileSync(join(dir, ".gitignore"), GITIGNORE_CONTENT);
  stageEntityFiles(dir);
  const status = gitCmdSafe(dir, "status --porcelain");
  if (status.ok && status.stdout) {
    gitCmd(dir, `commit --author="${GIT_AUTHOR}" -m "CCO backup enabled -- ${GIT_COMMIT_PREFIX}-${formatTimestamp()}"`);
  } else {
    try { gitCmd(dir, `commit --allow-empty --author="${GIT_AUTHOR}" -m "Initial backup -- ${GIT_COMMIT_PREFIX}-init"`); } catch {}
  }
  return { ok: true };
}

function cmdGitCommit(args: string[]): CommandResult {
  const { flags } = parseArgs(args);
  const entityType = flags["entity-type"], entityName = flags["entity-name"], action = flags["action"];
  if (!entityType || !entityName || !action) return { ok: false, error: "git-commit requires --entity-type, --entity-name, --action" };
  const dir = getConfigDir();
  if (!existsSync(join(dir, ".gitignore"))) writeFileSync(join(dir, ".gitignore"), GITIGNORE_CONTENT);
  stageEntityFiles(dir);
  const status = gitCmdSafe(dir, "status --porcelain");
  if (!status.ok || !status.stdout) return { ok: true, committed: false, reason: "no_changes" };
  const msg = `[${sanitizeForShell(entityType)}] ${sanitizeForShell(entityName)} ${sanitizeForShell(action).toUpperCase()} -- ${GIT_COMMIT_PREFIX}-${formatTimestamp()}`;
  gitCmd(dir, `commit --author="${GIT_AUTHOR}" -m "${msg}"`);
  return { ok: true, committed: true };
}

function cmdGitLog(): CommandResult {
  const dir = getConfigDir();
  try {
    const output = gitCmd(dir, `log --format=%H%n%s%n%aI -n ${GIT_MAX_COMMITS}`);
    if (!output) return { ok: true, commits: [] };
    const lines = output.split("\n");
    const commits: Array<{ hash: string; message: string; date: string }> = [];
    for (let i = 0; i + 2 < lines.length; i += 3) commits.push({ hash: lines[i], message: lines[i + 1], date: lines[i + 2] });
    return { ok: true, commits };
  } catch { return { ok: true, commits: [] }; }
}

function cmdGitRestore(args: string[]): CommandResult {
  const { positional } = parseArgs(args);
  const hash = positional[0], originalMessage = positional[1] || "";
  if (!hash || !/^[0-9a-f]{40}$/.test(hash)) return { ok: false, error: "git-restore requires a valid 40-char commit hash" };
  const dir = getConfigDir();
  for (const d of ["commands", "agents", "cco-prompts"]) { const p = join(dir, d); if (existsSync(p)) rmSync(p, { recursive: true, force: true }); }
  gitCmd(dir, `checkout ${hash} -- .`);
  stageEntityFiles(dir);
  gitCmd(dir, `commit --allow-empty --author="${GIT_AUTHOR}" -m "Restored: ${sanitizeForShell(originalMessage)} -- ${GIT_COMMIT_PREFIX}-${formatTimestamp()}"`);
  return { ok: true };
}

function cmdGitRemote(): CommandResult {
  const dir = getConfigDir();
  try { return { ok: true, remote: gitCmd(dir, "remote").split("\n")[0] || null }; }
  catch { return { ok: true, remote: null }; }
}

function cmdGitPull(): CommandResult {
  const dir = getConfigDir();
  const remote = gitCmd(dir, "remote").split("\n")[0];
  if (!remote || !/^[a-zA-Z0-9._-]+$/.test(remote)) return { ok: false, error: "No valid remote configured" };
  run(`GIT_TERMINAL_PROMPT=0 git -C "${dir}" pull --rebase ${remote} main`);
  return { ok: true };
}

function cmdGitPush(): CommandResult {
  const dir = getConfigDir();
  const remote = gitCmd(dir, "remote").split("\n")[0];
  if (!remote || !/^[a-zA-Z0-9._-]+$/.test(remote)) return { ok: false, error: "No valid remote configured" };
  run(`GIT_TERMINAL_PROMPT=0 git -C "${dir}" pull --rebase ${remote} main`);
  run(`GIT_TERMINAL_PROMPT=0 git -C "${dir}" push --force-with-lease -u ${remote} main`);
  return { ok: true };
}

function cmdGitRemove(): CommandResult {
  const gitDir = join(getConfigDir(), ".git");
  if (existsSync(gitDir)) rmSync(gitDir, { recursive: true, force: true });
  return { ok: true };
}

// ─── Docker discovery ───────────────────────────────────────────────────────

function cmdDockerDiscover(): CommandResult {
  const result: any = { ok: true, available: false, toolkitAvailable: false, discovered: [] };
  if (!tryRun("docker --version").ok) { result.error = "Docker is not installed or not running"; return result; }
  result.available = true;

  const psResult = tryRun(`docker ps --format '{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","ports":"{{.Ports}}","status":"{{.Status}}"}'`);
  if (psResult.ok && psResult.stdout) {
    for (const line of psResult.stdout.split("\n").filter(Boolean)) {
      try {
        const c = JSON.parse(line);
        const img = (c.image || "").toLowerCase(), nm = (c.name || "").toLowerCase();
        if (!img.startsWith("mcp/") && !img.includes("mcp-server") && !img.includes("mcp_server") && !img.includes("/mcp/") && !img.includes("modelcontextprotocol") && !nm.includes("mcp")) continue;
        const sn = (c.name || img.split("/").pop()?.split(":")[0] || c.id).replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
        result.discovered.push({ name: sn, image: c.image, containerId: c.id, ports: c.ports || "", status: c.status || "", source: "container",
          mcpServer: { name: sn, type: "stdio", command: "docker", args: ["run", "-i", "--rm", c.image], scope: "global" } });
      } catch {}
    }
  }

  if (tryRun("docker mcp version 2>/dev/null").ok) {
    result.toolkitAvailable = true;
    const lr = tryRun("docker mcp list --format json 2>/dev/null");
    if (lr.ok && lr.stdout) {
      try {
        const profiles = JSON.parse(lr.stdout);
        if (Array.isArray(profiles)) for (const p of profiles) {
          const pn = p.name || p.profile || "default";
          const n = `MCP_DOCKER_${pn.replace(/[^a-zA-Z0-9_-]/g, "-").toUpperCase()}`;
          result.discovered.push({ name: n, image: "docker mcp gateway", containerId: "", ports: "", status: "toolkit-managed", source: "toolkit-profile",
            mcpServer: { name: n, type: "stdio", command: "docker", args: ["mcp", "gateway", "run", "--profile", pn], scope: "global" } });
        }
      } catch {}
    }
  }
  return result;
}

// ─── Cron management ────────────────────────────────────────────────────────

const PM2_PREFIX = "cco-cron-";

function cmdCronStart(args: string[]): CommandResult {
  const { flags } = parseArgs(args);
  const id = flags["id"], cronExpr = flags["cron"];
  // Support both new (--entity-type/--entity-name) and old (--pipeline) flags
  const entityType = flags["entity-type"] || "pipeline";
  const entityName = flags["entity-name"] || flags["pipeline"];
  if (!id || !entityName || !cronExpr) return { ok: false, error: "cron-start requires --id, --entity-name (or --pipeline), --cron" };
  const cwd = flags["cwd"], skipPermissions = flags["skip-permissions"] === "true";
  const configDir = getConfigDir(), logsDir = join(configDir, "cco-cron-logs"), runnerLogDir = join(logsDir, id);
  mkdirSync(runnerLogDir, { recursive: true });
  const cliFlags = skipPermissions ? " --dangerously-skip-permissions" : "";
  // Construct the correct claude command based on entity type
  let claudeCmd: string;
  switch (entityType) {
    case "command":
      claudeCmd = `echo "/${toKebabCase(entityName)}" | claude${cliFlags} --print`;
      break;
    case "agent": {
      const agentPath = join(configDir, "agents", `${toKebabCase(entityName)}.md`);
      claudeCmd = `claude${cliFlags} --print < "${agentPath}"`;
      break;
    }
    case "pipeline":
    default:
      claudeCmd = `echo "/pipeline-${toKebabCase(entityName)}" | claude${cliFlags} --print`;
      break;
  }
  const scriptPath = join(configDir, `cco-cron-${id}.sh`), latestLink = join(runnerLogDir, "latest.log");
  const entityLabel = `${entityType.charAt(0).toUpperCase() + entityType.slice(1)}: ${entityName}`;
  const pidFile = join(runnerLogDir, "claude.pid");
  const skipFlag = join(runnerLogDir, "skip.flag");
  const counterFile = join(runnerLogDir, "run_counter");
  const lines = ["#!/bin/bash", "", '[ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.zshrc"', '[ -f "$HOME/.bashrc" ] && SHELL_RC="$HOME/.bashrc"',
    '[ -n "$SHELL_RC" ] && source "$SHELL_RC" 2>/dev/null', "", `mkdir -p "${runnerLogDir}"`, "",
    `PID_FILE="${pidFile}"`, `SKIP_FLAG="${skipFlag}"`, `COUNTER_FILE="${counterFile}"`, "",
    '# Kill leftover claude from previous run that did not exit',
    'if [ -f "$PID_FILE" ]; then',
    '  OLD_PID=$(cat "$PID_FILE" 2>/dev/null)',
    '  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then',
    '    echo "[$(date -Iseconds)] Previous claude (PID $OLD_PID) still running — sending EXIT"',
    '    kill -TERM "$OLD_PID" 2>/dev/null',
    '    for i in $(seq 1 10); do kill -0 "$OLD_PID" 2>/dev/null || break; sleep 1; done',
    '    kill -0 "$OLD_PID" 2>/dev/null && kill -9 "$OLD_PID" 2>/dev/null',
    '    echo "[$(date -Iseconds)] Previous claude stopped"',
    '  fi',
    '  rm -f "$PID_FILE"',
    'fi', "",
    '# Increment run counter',
    'RUN_NUM=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)',
    'RUN_NUM=$((RUN_NUM + 1))',
    'echo "$RUN_NUM" > "$COUNTER_FILE"', "",
    '# Trap SIGTERM: kill claude child before exiting',
    'cleanup() { [ -f "$PID_FILE" ] && kill -TERM "$(cat "$PID_FILE")" 2>/dev/null; rm -f "$PID_FILE"; exit 0; }',
    'trap cleanup SIGTERM SIGINT', "",
    'RUN_TS="$(date +%Y-%m-%d_%H-%M-%S)"', `LOG_FILE="${runnerLogDir}/run_\${RUN_TS}.log"`, "",
    `ln -sf "run_\${RUN_TS}.log" "${latestLink}"`, "", "{",
    `  echo "[$(date -Iseconds)] ======== CRON RUN #\${RUN_NUM} START ========"`,
    `  echo "[$(date -Iseconds)] ${entityLabel}"`,
    ...(cwd ? [`  echo "[$(date -Iseconds)] CWD:      ${cwd}"`, "", `  cd "${cwd}" || { echo "[$(date -Iseconds)] ERROR: Failed to cd to ${cwd}"; exit 1; }`] : []),
    '  echo ""', "",
    '  # Check skip flag — if present, skip this run',
    '  if [ -f "$SKIP_FLAG" ]; then',
    `    echo "[$(date -Iseconds)] ⏭  Run #\${RUN_NUM} SKIPPED (skip.flag present)"`,
    '    rm -f "$SKIP_FLAG"',
    `    echo "[$(date -Iseconds)] ======== CRON RUN #\${RUN_NUM} END (skipped) ========"`,
    '  else',
    `    ${claudeCmd} 2>&1 &`, '    CLAUDE_PID=$!', '    echo "$CLAUDE_PID" > "$PID_FILE"', '    wait $CLAUDE_PID', "    EXIT_CODE=$?",
    '    rm -f "$PID_FILE"', '    echo ""',
    `    echo "[$(date -Iseconds)] ======== CRON RUN #\${RUN_NUM} END (exit: \$EXIT_CODE) ========"`,
    '  fi',
    '} | tee -a "$LOG_FILE"', "", "sleep infinity &", "wait"];
  writeFileSync(scriptPath, lines.join("\n") + "\n");
  chmodSync(scriptPath, 0o755);
  const name = `${PM2_PREFIX}${id}`;
  const app: Record<string, unknown> = { name, script: scriptPath, cron_restart: cronExpr, autorestart: false,
    out_file: join(logsDir, `${id}-out.log`), error_file: join(logsDir, `${id}-err.log`), merge_logs: true };
  if (cwd) app.cwd = cwd;
  writeFileSync(join(configDir, "cco-cron-ecosystem.config.cjs"), `module.exports = { apps: [${JSON.stringify(app, null, 2)}] };\n`);
  const r = tryRun(loginShell(`bunx pm2 start "${join(configDir, "cco-cron-ecosystem.config.cjs")}" --only "${name}"`));
  if (!r.ok || r.stderr.includes("Error")) return { ok: false, error: r.stderr || "Failed to start cron runner" };
  return { ok: true };
}

function cmdCronSkipCurrent(args: string[]): CommandResult {
  const { flags } = parseArgs(args);
  const id = flags["id"];
  if (!id) return { ok: false, error: "cron-skip-current requires --id" };
  const pidFile = join(getConfigDir(), "cco-cron-logs", id, "claude.pid");
  if (!existsSync(pidFile)) return { ok: true, log: "No running claude process to skip" };
  try {
    const pid = require("node:fs").readFileSync(pidFile, "utf8").trim();
    if (pid) {
      tryRun(`kill -TERM ${pid}`);
      return { ok: true, log: `Sent SIGTERM to claude (PID ${pid})` };
    }
  } catch {}
  return { ok: true, log: "Skipped" };
}

function cmdCronSkipNext(args: string[]): CommandResult {
  const { flags } = parseArgs(args);
  const id = flags["id"];
  if (!id) return { ok: false, error: "cron-skip-next requires --id" };
  const runnerLogDir = join(getConfigDir(), "cco-cron-logs", id);
  mkdirSync(runnerLogDir, { recursive: true });
  const skipFlag = join(runnerLogDir, "skip.flag");
  writeFileSync(skipFlag, `skip requested at ${new Date().toISOString()}\n`);
  return { ok: true, log: "Next run will be skipped" };
}

function cmdCronStop(args: string[]): CommandResult {
  const { flags } = parseArgs(args);
  const id = flags["id"];
  if (!id) return { ok: false, error: "cron-stop requires --id" };
  tryRun(loginShell(`bunx pm2 delete "${PM2_PREFIX}${id}"`));
  const sp = join(getConfigDir(), `cco-cron-${id}.sh`);
  if (existsSync(sp)) rmSync(sp, { force: true });
  return { ok: true };
}

function cmdCronStatus(): CommandResult {
  const r = tryRun(loginShell("bunx pm2 jlist 2>/dev/null"));
  if (!r.ok) return { ok: true, running: [] };
  try {
    const list = JSON.parse(r.stdout) as Array<{ name: string }>;
    return { ok: true, running: list.filter(p => p.name.startsWith(PM2_PREFIX)).map(p => p.name.replace(PM2_PREFIX, "")) };
  } catch { return { ok: true, running: [] }; }
}

function cmdCronLog(args: string[]): CommandResult {
  const { flags } = parseArgs(args);
  const id = flags["id"];
  if (!id) return { ok: false, error: "cron-log requires --id" };
  const lines = parseInt(flags["lines"] || "10", 10);
  const r = tryRun(`tail -n ${lines} "${join(getConfigDir(), "cco-cron-logs", id, "latest.log")}" 2>/dev/null`);
  return { ok: true, log: r.stdout || "" };
}

function cmdCronClean(): CommandResult {
  const r = tryRun(loginShell("bunx pm2 jlist"));
  if (r.ok) { try { for (const p of (JSON.parse(r.stdout) as Array<{ name: string }>).filter(p => p.name.startsWith(PM2_PREFIX))) tryRun(loginShell(`bunx pm2 delete "${p.name}"`)); } catch {} }
  return { ok: true };
}

function cmdKillTerminals(args: string[]): CommandResult {
  const { positional } = parseArgs(args);
  if (!positional[0]) return { ok: false, error: "kill-terminals requires a JSON array of tab titles" };
  let titles: string[];
  try { titles = JSON.parse(positional[0]); } catch { return { ok: false, error: "Invalid JSON for titles" }; }
  if (platform() !== "darwin") return { ok: true };
  for (const title of titles) {
    const r = tryRun(`osascript -e 'tell application "Terminal"' -e 'repeat with w in windows' -e 'repeat with t in tabs of w' -e 'if custom title of t is "${title}" then' -e 'return tty of t' -e 'end if' -e 'end repeat' -e 'end repeat' -e 'end tell'`);
    if (r.stdout) tryRun(`pkill -t ${r.stdout.replace("/dev/", "")}`);
  }
  return { ok: true };
}

function cmdKillCrons(): CommandResult {
  const r = tryRun(loginShell("bunx pm2 jlist 2>/dev/null"));
  if (r.ok) { try { for (const p of (JSON.parse(r.stdout) as Array<{ name: string }>).filter(p => p.name.startsWith(PM2_PREFIX))) tryRun(loginShell(`bunx pm2 delete "${p.name}" 2>/dev/null`)); } catch {} }
  return { ok: true };
}

// ─── Advanced Brain management ──────────────────────────────────────────────

const BRAINS_SUBDIR = join("claude-grimoire", "brains");

function getBrainsDir(): string {
  return join(getConfigDir(), BRAINS_SUBDIR);
}

const BRAIN_DIRS = [
  "episodic/claude-mem",
  "semantic/opencontext",
  "semantic/obsidian",
  "structured/beads",
  "identity/mempalace",
  "shared/inbox",
  "shared/outbox",
  "shared/event-log",
];

// ─── Obsidian Brain ─────────────────────────────────────────────────────────

const OBSIDIAN_SKILL_DIRS = ["obsidian-cli", "obsidian-markdown", "obsidian-bases", "json-canvas", "defuddle"];

function getObsidianBrainDir(): string { return join(getConfigDir(), "claude-grimoire", "obsidian-brain"); }
function getObsidianHookDir(): string { return join(getObsidianBrainDir(), "hooks"); }
function getObsidianEnabledFlag(): string { return join(getObsidianBrainDir(), "enabled"); }
function getObsidianVaultDataDir(): string { return join(getBrainsDir(), "semantic", "obsidian"); }
function getClaudeSkillsDir(): string { return join(getConfigDir(), "skills"); }

function obsidianAppInstalled(): boolean {
  const p = platform();
  if (p === "darwin") return existsSync("/Applications/Obsidian.app");
  if (p === "win32") return existsSync(join(homedir(), "AppData", "Local", "Programs", "Obsidian", "Obsidian.exe"));
  return tryRun("command -v obsidian").ok;
}

function skillsInstalled(): boolean {
  const skillsDir = getClaudeSkillsDir();
  return OBSIDIAN_SKILL_DIRS.some(s => existsSync(join(skillsDir, s)));
}

function hooksInstalled(): boolean {
  const hookDir = getObsidianHookDir();
  return existsSync(join(hookDir, "session-start.sh"))
      && existsSync(join(hookDir, "user-prompt.sh"))
      && existsSync(join(hookDir, "stop.sh"));
}

function cmdObsidianBrainStatus(): CommandResult {
  return {
    ok: true,
    skillsInstalled: skillsInstalled(),
    hooksInstalled: hooksInstalled(),
    enabled: existsSync(getObsidianEnabledFlag()),
    obsidianAppInstalled: obsidianAppInstalled(),
    hookDir: getObsidianHookDir(),
    vaultDataDir: getObsidianVaultDataDir(),
  };
}

/**
 * Generates the three hook scripts. Each script no-ops when the enabled
 * flag is absent, so toggling off is instant (no re-wire needed).
 */
function writeHookScripts() {
  const hookDir = getObsidianHookDir();
  const dataDir = getObsidianVaultDataDir();
  mkdirSync(hookDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, "prompts"), { recursive: true });
  mkdirSync(join(dataDir, "sessions"), { recursive: true });

  const enabledFlag = getObsidianEnabledFlag();
  const promptsDir = join(dataDir, "prompts");
  const sessionsDir = join(dataDir, "sessions");
  const indexFile = join(dataDir, "index.md");

  // Common preamble
  const preamble = [
    '#!/bin/bash',
    `ENABLED_FLAG="${enabledFlag}"`,
    `DATA_DIR="${dataDir}"`,
    `PROMPTS_DIR="${promptsDir}"`,
    `SESSIONS_DIR="${sessionsDir}"`,
    `INDEX_FILE="${indexFile}"`,
    '',
    '# Self-disable when toggle is off',
    '[ ! -f "$ENABLED_FLAG" ] && exit 0',
    '',
    '# Read JSON input from Claude Code',
    'INPUT="$(cat)"',
    '',
    'iso_now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }',
    'slug() { echo "$1" | tr "[:upper:]" "[:lower:]" | tr -c "a-z0-9\\n" "-" | sed "s/^-//;s/-$//" | cut -c1-80; }',
    'hash_prompt() { echo "$1" | shasum -a 256 2>/dev/null | cut -c1-12 || md5sum | cut -c1-12; }',
    '',
  ].join('\n');

  // session-start.sh: find relevant prior prompts for the current cwd
  const sessionStart = preamble + [
    '# SessionStart: surface related prior prompts from the vault',
    'CWD="$(pwd)"',
    'CWD_SLUG=$(slug "$CWD")',
    'echo "{\\"hookSpecificOutput\\":{\\"hookEventName\\":\\"SessionStart\\",\\"additionalContext\\":\\"$(',
    '  echo "📚 Obsidian Brain active. Vault: $DATA_DIR"',
    '  # Find recent prompts touching this cwd',
    '  RECENT=$(grep -l "cwd: $CWD" "$PROMPTS_DIR"/*.md 2>/dev/null | head -5)',
    '  if [ -n "$RECENT" ]; then',
    '    echo "\\n🔗 Related prior prompts:"',
    '    for f in $RECENT; do',
    '      TITLE=$(grep "^title:" "$f" 2>/dev/null | head -1 | sed "s/^title: //")',
    '      STATUS=$(grep "^status:" "$f" 2>/dev/null | head -1 | sed "s/^status: //")',
    '      echo "  - [[$TITLE]] ($STATUS)"',
    '    done',
    '  fi',
    ') | sed \'s/"/\\\\"/g\' | tr \'\\n\' \' \')\\"}}"',
    'exit 0',
  ].join('\n');

  // user-prompt.sh: store the prompt, cross-link related ones
  const userPrompt = preamble + [
    '# UserPromptSubmit: persist prompt + link related',
    'PROMPT=$(echo "$INPUT" | sed -n \'s/.*"prompt"[[:space:]]*:[[:space:]]*"\\(.*\\)".*/\\1/p\' | head -1)',
    'SESSION_ID=$(echo "$INPUT" | sed -n \'s/.*"session_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' | head -1)',
    'CWD=$(echo "$INPUT" | sed -n \'s/.*"cwd"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' | head -1)',
    '[ -z "$PROMPT" ] && exit 0',
    '',
    'HASH=$(hash_prompt "$PROMPT")',
    'TS=$(iso_now)',
    'FIRST_LINE=$(echo "$PROMPT" | head -1 | cut -c1-80)',
    'SLUG=$(slug "$FIRST_LINE")',
    'FILE="$PROMPTS_DIR/${SLUG:-prompt}-${HASH}.md"',
    '',
    '# Find related prompts by shared cwd or keywords',
    'RELATED=""',
    'if [ -n "$CWD" ]; then',
    '  RELATED=$(grep -l "cwd: $CWD" "$PROMPTS_DIR"/*.md 2>/dev/null | grep -v "$FILE" | head -5 | while read f; do',
    '    basename "$f" .md | sed "s/^/  - [[/;s/$/]]/"',
    '  done)',
    'fi',
    '',
    'if [ ! -f "$FILE" ]; then',
    '  cat > "$FILE" <<EOF',
    '---',
    'title: "$FIRST_LINE"',
    'created: $TS',
    'updated: $TS',
    'status: in-progress',
    'session: $SESSION_ID',
    'cwd: $CWD',
    'hash: $HASH',
    '---',
    '',
    '## Prompt',
    '',
    '$PROMPT',
    '',
    '## Related',
    '',
    '$RELATED',
    '',
    '## Progress',
    '',
    '- [$TS] Started',
    'EOF',
    'else',
    '  # Update existing prompt note',
    '  sed -i.bak "s/^updated: .*/updated: $TS/" "$FILE" && rm -f "$FILE.bak"',
    '  echo "- [$TS] Re-submitted" >> "$FILE"',
    'fi',
    '',
    '# Update index',
    'touch "$INDEX_FILE"',
    'if ! grep -q "$HASH" "$INDEX_FILE" 2>/dev/null; then',
    '  echo "- [[$SLUG-$HASH]] — $FIRST_LINE ($TS)" >> "$INDEX_FILE"',
    'fi',
    'exit 0',
  ].join('\n');

  // stop.sh: mark prompt as done, update status
  const stop = preamble + [
    '# Stop: mark the latest prompt for this session as done',
    'SESSION_ID=$(echo "$INPUT" | sed -n \'s/.*"session_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' | head -1)',
    '[ -z "$SESSION_ID" ] && exit 0',
    '',
    'TS=$(iso_now)',
    '# Find the most recent in-progress prompt from this session',
    'LATEST=$(grep -l "session: $SESSION_ID" "$PROMPTS_DIR"/*.md 2>/dev/null | xargs -I{} stat -f "%m {}" {} 2>/dev/null | sort -rn | head -1 | cut -d" " -f2-)',
    '[ -z "$LATEST" ] && LATEST=$(grep -l "session: $SESSION_ID" "$PROMPTS_DIR"/*.md 2>/dev/null | xargs ls -t 2>/dev/null | head -1)',
    '[ -z "$LATEST" ] && exit 0',
    '',
    'sed -i.bak "s/^status: .*/status: completed/" "$LATEST" && rm -f "$LATEST.bak"',
    'sed -i.bak "s/^updated: .*/updated: $TS/" "$LATEST" && rm -f "$LATEST.bak"',
    'echo "- [$TS] Completed" >> "$LATEST"',
    'exit 0',
  ].join('\n');

  writeFileSync(join(hookDir, "session-start.sh"), sessionStart);
  writeFileSync(join(hookDir, "user-prompt.sh"), userPrompt);
  writeFileSync(join(hookDir, "stop.sh"), stop);
  chmodSync(join(hookDir, "session-start.sh"), 0o755);
  chmodSync(join(hookDir, "user-prompt.sh"), 0o755);
  chmodSync(join(hookDir, "stop.sh"), 0o755);
}

function cmdObsidianBrainInstall(): CommandResult {
  const skillsDir = getClaudeSkillsDir();
  mkdirSync(skillsDir, { recursive: true });

  const log: string[] = [];

  // 1. Install obsidian-skills (kepano)
  log.push("Cloning obsidian-skills…");
  const tmp = "/tmp/obsidian-skills-tmp";
  tryRun(`rm -rf "${tmp}"`);
  const cloneResult = tryRun(`git clone --depth 1 https://github.com/kepano/obsidian-skills.git "${tmp}"`, 60_000);
  if (!cloneResult.ok) {
    return { ok: false, error: "Failed to clone obsidian-skills: " + cloneResult.stderr, log: log.join("\n") };
  }
  const copyResult = tryRun(`cp -r "${tmp}/skills/"* "${skillsDir}/"`);
  tryRun(`rm -rf "${tmp}"`);
  if (!copyResult.ok) {
    return { ok: false, error: "Failed to copy skills: " + copyResult.stderr, log: log.join("\n") };
  }
  log.push(`✓ Obsidian skills installed to ${skillsDir}`);

  // 2. Generate hook scripts
  log.push("Writing hook scripts…");
  try {
    writeHookScripts();
    log.push(`✓ Hook scripts created in ${getObsidianHookDir()}`);
  } catch (e: any) {
    return { ok: false, error: "Failed to write hooks: " + e.message, log: log.join("\n") };
  }

  // 3. Create data directories in vault
  mkdirSync(getObsidianVaultDataDir(), { recursive: true });
  log.push(`✓ Vault data dir ready: ${getObsidianVaultDataDir()}`);

  // 4. Obsidian app hint
  if (!obsidianAppInstalled()) {
    log.push("ℹ Obsidian desktop app not detected — install from https://obsidian.md");
  } else {
    log.push("✓ Obsidian app detected");
  }

  log.push("");
  log.push("Use the ON/OFF toggle to activate.");
  return { ok: true, log: log.join("\n") };
}

function cmdObsidianBrainUninstall(): CommandResult {
  const log: string[] = [];
  const skillsDir = getClaudeSkillsDir();

  for (const s of OBSIDIAN_SKILL_DIRS) {
    const p = join(skillsDir, s);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      log.push(`✓ Removed skill: ${s}`);
    }
  }

  const brainDir = getObsidianBrainDir();
  if (existsSync(brainDir)) {
    rmSync(brainDir, { recursive: true, force: true });
    log.push(`✓ Removed ${brainDir}`);
  }

  // Note: vault data is preserved on purpose — user may want to keep the notes
  log.push(`ℹ Vault data preserved at ${getObsidianVaultDataDir()} (delete manually if desired)`);

  return { ok: true, log: log.join("\n") };
}

function cmdObsidianBrainSetEnabled(args: string[]): CommandResult {
  const { flags } = parseArgs(args);
  const enabled = flags["enabled"] === "true";
  const flag = getObsidianEnabledFlag();
  mkdirSync(getObsidianBrainDir(), { recursive: true });
  if (enabled) {
    writeFileSync(flag, new Date().toISOString() + "\n");
  } else {
    if (existsSync(flag)) rmSync(flag, { force: true });
  }
  return { ok: true, hookDir: getObsidianHookDir(), enabled };
}

// ─── Command dictionary ─────────────────────────────────────────────────────

const COMMANDS: CommandDict = {
  // Builtins
  "os-info": cmdOsInfo,
  "home-dir": cmdHomeDir,
  "ensure-dir": cmdEnsureDir,
  "remove-dir": cmdRemoveDir,
  "open-file": cmdOpenFile,
  "open-folder": cmdOpenFolder,
  // Grimoire commands
  "launch-terminal": cmdLaunchTerminal,
  "run-entity": cmdRunEntity,
  "check-version": cmdCheckVersion,
  "git-init": cmdGitInit,
  "git-commit": cmdGitCommit,
  "git-log": cmdGitLog,
  "git-restore": cmdGitRestore,
  "git-pull": cmdGitPull,
  "git-push": cmdGitPush,
  "git-remote": cmdGitRemote,
  "git-remove": cmdGitRemove,
  "docker-discover": cmdDockerDiscover,
  "cron-start": cmdCronStart,
  "cron-stop": cmdCronStop,
  "cron-skip-current": cmdCronSkipCurrent,
  "cron-skip-next": cmdCronSkipNext,
  "cron-status": cmdCronStatus,
  "cron-log": cmdCronLog,
  "cron-clean": cmdCronClean,
  "kill-terminals": cmdKillTerminals,
  "kill-crons": cmdKillCrons,
  "obsidian-brain-status": cmdObsidianBrainStatus,
  "obsidian-brain-install": cmdObsidianBrainInstall,
  "obsidian-brain-uninstall": cmdObsidianBrainUninstall,
  "obsidian-brain-set-enabled": cmdObsidianBrainSetEnabled,
};

// ─── Entry point ────────────────────────────────────────────────────────────

const [cmd, ...restArgs] = process.argv.slice(2);
if (!cmd || !COMMANDS[cmd]) {
  console.log(JSON.stringify({ ok: false, error: `Unknown command: ${cmd || "(none)"}` }));
  process.exit(1);
}
const result = COMMANDS[cmd](restArgs);
const finish = (r: CommandResult) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1); };
if (result instanceof Promise) result.then(finish).catch((e: Error) => finish({ ok: false, error: e.message }));
else finish(result);
