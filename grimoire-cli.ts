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

function getObsidianBrainScriptPath(): string {
  return join(getObsidianBrainDir(), "obsidian-brain.ts");
}

function hooksInstalled(): boolean {
  const hookDir = getObsidianHookDir();
  return existsSync(join(hookDir, "session-start.sh"))
      && existsSync(join(hookDir, "user-prompt.sh"))
      && existsSync(join(hookDir, "stop.sh"))
      && existsSync(getObsidianBrainScriptPath());
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
 * Ensure all brain directories exist. Idempotent and tolerant of missing parents.
 */
function ensureBrainDirs() {
  const dataDir = getObsidianVaultDataDir();
  mkdirSync(getObsidianBrainDir(), { recursive: true });
  mkdirSync(getObsidianHookDir(), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, "prompts"), { recursive: true });
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  mkdirSync(getClaudeSkillsDir(), { recursive: true });
}

/**
 * The main brain script — a single bun TS file that handles all hook modes
 * AND runs as an MCP server. Written to disk on install.
 *
 * Modes:
 *   session-start → output relevant prior prompts as additionalContext
 *   user-prompt   → persist prompt page with keyword+cwd related links
 *   stop          → parse transcript, append "## Outcome" section, mark completed
 *   mcp           → run MCP server exposing brain_search, brain_recent, brain_read
 */
const OBSIDIAN_BRAIN_SCRIPT = String.raw`#!/usr/bin/env bun
/* eslint-disable */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const BRAIN_DIR = join(homedir(), ".claude", "claude-grimoire", "obsidian-brain");
const DATA_DIR  = join(homedir(), ".claude", "claude-grimoire", "brains", "semantic", "obsidian");
const PROMPTS_DIR = join(DATA_DIR, "prompts");
const INDEX_FILE  = join(DATA_DIR, "index.md");
const ENABLED_FLAG = join(BRAIN_DIR, "enabled");

const STOPWORDS = new Set([
  "the","and","for","you","with","this","that","please","from","have","been","will","can","not",
  "are","was","were","but","any","all","how","what","why","when","where","use","using","also",
  "just","like","them","they","their","into","over","about","than","then","some","make","maybe",
  "need","want","does","did","doing","get","got","run","ran","see","sees","saw","look","looking",
  "now","next","new","old","add","added","remove","removed","fix","fixed","still","yet","its","it",
]);

function enabled() { return existsSync(ENABLED_FLAG); }
function ensureDirs() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(PROMPTS_DIR, { recursive: true });
}
function iso() { return new Date().toISOString(); }
function sha(s: string): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(s);
  return h.digest("hex").slice(0, 12);
}
function slug(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}
function keywords(text: string): string[] {
  const hits = (text || "").toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
  const out = new Set<string>();
  for (const w of hits) if (!STOPWORDS.has(w)) out.add(w);
  return [...out];
}

function readStdin(): string {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function parseFrontmatter(content: string): { fm: Record<string, string>; body: string; raw: string } {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: {}, body: content, raw: content };
  const fm: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (kv) fm[kv[1]!] = kv[2] || "";
  }
  return { fm, body: content.slice(m[0].length), raw: content };
}

interface PromptEntry { file: string; path: string; fm: Record<string, string>; body: string; mtime: number; }

function listPrompts(): PromptEntry[] {
  ensureDirs();
  if (!existsSync(PROMPTS_DIR)) return [];
  const out: PromptEntry[] = [];
  for (const f of readdirSync(PROMPTS_DIR)) {
    if (!f.endsWith(".md")) continue;
    const p = join(PROMPTS_DIR, f);
    try {
      const content = readFileSync(p, "utf8");
      const { fm, body } = parseFrontmatter(content);
      const mtime = statSync(p).mtimeMs;
      out.push({ file: f, path: p, fm, body, mtime });
    } catch {}
  }
  return out;
}

function scoreRelated(query: string, cwd: string | undefined, prompts: PromptEntry[], excludePath?: string) {
  const qkw = new Set(keywords(query));
  const results: Array<{ entry: PromptEntry; score: number }> = [];
  for (const p of prompts) {
    if (excludePath && p.path === excludePath) continue;
    let score = 0;
    if (cwd && p.fm.cwd === cwd) score += 3;
    const okw = new Set(keywords((p.fm.title || "") + " " + p.body));
    for (const w of qkw) if (okw.has(w)) score += 1;
    if (score > 0) results.push({ entry: p, score });
  }
  results.sort((a, b) => b.score - a.score || b.entry.mtime - a.entry.mtime);
  return results;
}

// ── Hook: SessionStart ─────────────────────────────────────────────────
function handleSessionStart() {
  const input = (() => { try { return JSON.parse(readStdin() || "{}"); } catch { return {}; } })();
  const cwd = input.cwd || process.cwd();
  const prompts = listPrompts();
  const related = scoreRelated("", cwd, prompts).slice(0, 5);

  const lines: string[] = [];
  lines.push("📚 Obsidian Brain active. Vault: " + DATA_DIR);
  if (related.length > 0) {
    lines.push("");
    lines.push("🔗 Related prior work (this cwd):");
    for (const r of related) {
      const t = r.entry.fm.title || r.entry.file.replace(/\.md$/, "");
      const s = r.entry.fm.status || "?";
      const ref = r.entry.file.replace(/\.md$/, "");
      lines.push("  • [[" + ref + "]] — " + t + " (" + s + ")");
    }
    lines.push("");
    lines.push("Use MCP tools brain_search / brain_recent / brain_read to dig in.");
  } else {
    lines.push("No prior prompts for this cwd yet.");
  }

  const out = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: lines.join("\n"),
    },
  };
  process.stdout.write(JSON.stringify(out) + "\n");
}

// ── Hook: UserPromptSubmit ─────────────────────────────────────────────
function handleUserPrompt() {
  const input = (() => { try { return JSON.parse(readStdin() || "{}"); } catch { return {}; } })();
  const prompt: string = input.prompt || "";
  const sessionId: string = input.session_id || "";
  const cwd: string = input.cwd || "";
  if (!prompt) return;

  ensureDirs();
  const ts = iso();
  const firstLine = prompt.split("\n")[0]!.slice(0, 80);
  const s = slug(firstLine);
  const hash = sha(prompt);
  const fileName = (s || "prompt") + "-" + hash + ".md";
  const filePath = join(PROMPTS_DIR, fileName);

  // Score related by keyword + cwd
  const related = scoreRelated(prompt, cwd, listPrompts(), filePath).slice(0, 5);
  const relatedLines = related.map(r => "  - [[" + r.entry.file.replace(/\.md$/, "") + "]] (score " + r.score + ")").join("\n");
  const kwList = keywords(prompt).slice(0, 12).join(", ");

  if (!existsSync(filePath)) {
    const escTitle = firstLine.replace(/"/g, '\\"');
    const doc = [
      "---",
      'title: "' + escTitle + '"',
      "created: " + ts,
      "updated: " + ts,
      "status: in-progress",
      "session: " + sessionId,
      "cwd: " + cwd,
      "hash: " + hash,
      "keywords: " + kwList,
      "---",
      "",
      "## Prompt",
      "",
      prompt,
      "",
      "## Related",
      "",
      relatedLines || "  _(no related prompts found)_",
      "",
      "## Progress",
      "",
      "- [" + ts + "] Started",
      "",
    ].join("\n");
    writeFileSync(filePath, doc);
  } else {
    let content = readFileSync(filePath, "utf8");
    content = content.replace(/^updated: .*/m, "updated: " + ts);
    if (!content.endsWith("\n")) content += "\n";
    content += "- [" + ts + "] Re-submitted\n";
    writeFileSync(filePath, content);
  }

  // Append to index.md if new
  if (!existsSync(INDEX_FILE)) writeFileSync(INDEX_FILE, "# Obsidian Brain — prompt index\n\n");
  const idx = readFileSync(INDEX_FILE, "utf8");
  if (!idx.includes(hash)) {
    appendFileSync(INDEX_FILE, "- [[" + (s || "prompt") + "-" + hash + "]] — " + firstLine + " (" + ts + ")\n");
  }
}

// ── Hook: Stop (outcome capture) ───────────────────────────────────────
function extractOutcomeFromTranscript(tp: string) {
  if (!tp || !existsSync(tp)) return null;
  let raw: string;
  try { raw = readFileSync(tp, "utf8"); } catch { return null; }
  const lines = raw.split("\n").filter(Boolean);
  const toolCounts: Record<string, number> = {};
  const filesTouched = new Set<string>();
  let lastText = "";
  for (const line of lines) {
    let entry: any;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === "tool_use") {
        toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;
        const inp = block.input || {};
        const fp = inp.file_path || inp.filePath || inp.path || inp.notebook_path;
        if (typeof fp === "string") filesTouched.add(fp);
      } else if (block && block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0) {
        lastText = block.text;
      }
    }
  }
  return { toolCounts, filesTouched: [...filesTouched], lastText };
}

function formatOutcomeSection(o: NonNullable<ReturnType<typeof extractOutcomeFromTranscript>>): string {
  const tools = Object.entries(o.toolCounts).sort((a, b) => b[1] - a[1]).map(([n, c]) => n + " (" + c + ")").join(", ");
  const files = o.filesTouched.map(f => "- \`" + f + "\`").join("\n");
  const summary = (o.lastText || "").slice(0, 1000).trim();
  const parts: string[] = [];
  if (tools)   parts.push("**Tools used:** " + tools);
  if (files)   parts.push("**Files touched:**\n" + files);
  if (summary) parts.push("**Summary:**\n" + summary);
  return parts.length > 0 ? parts.join("\n\n") : "_(no activity captured)_";
}

function handleStop() {
  const input = (() => { try { return JSON.parse(readStdin() || "{}"); } catch { return {}; } })();
  const sessionId: string = input.session_id || "";
  const transcriptPath: string = input.transcript_path || "";
  if (!sessionId) return;

  const prompts = listPrompts();
  let latest: PromptEntry | null = null;
  for (const p of prompts) {
    if (p.fm.session === sessionId && p.fm.status === "in-progress") {
      if (!latest || p.mtime > latest.mtime) latest = p;
    }
  }
  if (!latest) {
    // Fall back to any prompt from this session
    for (const p of prompts) {
      if (p.fm.session === sessionId) {
        if (!latest || p.mtime > latest.mtime) latest = p;
      }
    }
  }
  if (!latest) return;

  const ts = iso();
  let content = readFileSync(latest.path, "utf8");
  content = content.replace(/^status: .*/m, "status: completed");
  content = content.replace(/^updated: .*/m, "updated: " + ts);

  // Append outcome section if not already present
  const outcome = extractOutcomeFromTranscript(transcriptPath);
  if (outcome && !/^## Outcome$/m.test(content)) {
    if (!content.endsWith("\n")) content += "\n";
    content += "\n## Outcome\n\n" + formatOutcomeSection(outcome) + "\n";
  }

  if (!content.endsWith("\n")) content += "\n";
  content += "- [" + ts + "] Completed\n";
  writeFileSync(latest.path, content);
}

// ── MCP Server ─────────────────────────────────────────────────────────
function mcpSend(id: any, result: any) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function mcpError(id: any, code: number, message: string) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

function toolSearch(query: string, limit: number): string {
  if (!query || !query.trim()) return "Empty query.";
  const prompts = listPrompts();
  const scored = scoreRelated(query, undefined, prompts);
  const top = scored.slice(0, Math.max(1, Math.min(limit || 10, 50)));
  if (top.length === 0) return "No matches for: " + query;
  return top.map(r => {
    const ref = r.entry.file.replace(/\.md$/, "");
    const t = r.entry.fm.title || ref;
    const s = r.entry.fm.status || "?";
    const cwd = r.entry.fm.cwd || "";
    return "• [" + s + "] " + t + "\n  ref: " + ref + "\n  cwd: " + cwd + "\n  score: " + r.score;
  }).join("\n\n");
}

function toolRecent(cwd: string | undefined, limit: number): string {
  const prompts = listPrompts();
  prompts.sort((a, b) => b.mtime - a.mtime);
  const filtered = cwd ? prompts.filter(p => p.fm.cwd === cwd) : prompts;
  const top = filtered.slice(0, Math.max(1, Math.min(limit || 10, 50)));
  if (top.length === 0) return cwd ? "No prompts for cwd: " + cwd : "No prompts in brain.";
  return top.map(p => {
    const ref = p.file.replace(/\.md$/, "");
    const t = p.fm.title || ref;
    const s = p.fm.status || "?";
    return "• [" + s + "] " + t + "\n  ref: " + ref + "\n  cwd: " + (p.fm.cwd || "");
  }).join("\n\n");
}

function toolRead(ref: string): string {
  if (!ref) return "ref is required.";
  const prompts = listPrompts();
  for (const p of prompts) {
    const noExt = p.file.replace(/\.md$/, "");
    if (noExt === ref || p.file === ref || p.fm.hash === ref || p.file.endsWith("-" + ref + ".md")) {
      return readFileSync(p.path, "utf8");
    }
  }
  return "Not found: " + ref;
}

async function runMcp() {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) handleMcpLine(line);
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

function handleMcpLine(line: string) {
  let msg: any;
  try { msg = JSON.parse(line); } catch { return; }
  const id = msg.id;
  const method = msg.method;

  if (method === "initialize") {
    return mcpSend(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "obsidian-brain", version: "1.0.0" },
    });
  }
  if (method === "initialized" || method === "notifications/initialized") return;
  if (method === "tools/list") {
    return mcpSend(id, {
      tools: [
        {
          name: "brain_search",
          description: "Search prior prompts in the Obsidian Brain vault by keyword overlap (ranked).",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search terms" },
              limit: { type: "number", description: "Max results (default 10, max 50)" },
            },
            required: ["query"],
          },
        },
        {
          name: "brain_recent",
          description: "List recent prompts (by updated time), optionally filtered by cwd.",
          inputSchema: {
            type: "object",
            properties: {
              cwd:   { type: "string", description: "Filter by working directory (optional)" },
              limit: { type: "number", description: "Max results (default 10, max 50)" },
            },
          },
        },
        {
          name: "brain_read",
          description: "Read the full markdown of a specific prompt page by filename, filename-hash, or hash.",
          inputSchema: {
            type: "object",
            properties: { ref: { type: "string", description: "Prompt ref" } },
            required: ["ref"],
          },
        },
      ],
    });
  }
  if (method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments || {};
    let text = "";
    try {
      if      (name === "brain_search") text = toolSearch(args.query, args.limit);
      else if (name === "brain_recent") text = toolRecent(args.cwd, args.limit);
      else if (name === "brain_read")   text = toolRead(args.ref);
      else    text = "Unknown tool: " + name;
    } catch (e: any) {
      text = "Error: " + (e?.message || String(e));
    }
    return mcpSend(id, { content: [{ type: "text", text }] });
  }
  if (typeof id !== "undefined") mcpError(id, -32601, "Method not found: " + method);
}

// ── Entry ──────────────────────────────────────────────────────────────
const mode = process.argv[2] || "";
// Hook modes self-disable when the enabled flag is absent; MCP always runs.
if (mode !== "mcp" && !enabled()) process.exit(0);

switch (mode) {
  case "session-start": handleSessionStart(); break;
  case "user-prompt":   handleUserPrompt();   break;
  case "stop":          handleStop();         break;
  case "mcp":           await runMcp();       break;
  default:
    console.error("Usage: obsidian-brain.ts <session-start|user-prompt|stop|mcp>");
    process.exit(1);
}
`;

/**
 * Generates the brain TS script and three thin bash hook wrappers.
 * Each wrapper is small, checks the enabled flag, and hands off to bun.
 */
function writeHookScripts() {
  ensureBrainDirs();

  const hookDir = getObsidianHookDir();
  const scriptPath = getObsidianBrainScriptPath();
  const enabledFlag = getObsidianEnabledFlag();

  // Main TS script
  writeFileSync(scriptPath, OBSIDIAN_BRAIN_SCRIPT);
  chmodSync(scriptPath, 0o755);

  // Bash wrappers — source shell rc for PATH (bun typically in ~/.bun/bin)
  const makeWrapper = (mode: string) => [
    "#!/bin/bash",
    `ENABLED_FLAG="${enabledFlag}"`,
    '[ ! -f "$ENABLED_FLAG" ] && exit 0',
    '[ -f "$HOME/.zshrc" ]  && SHELL_RC="$HOME/.zshrc"',
    '[ -f "$HOME/.bashrc" ] && SHELL_RC="$HOME/.bashrc"',
    '[ -n "$SHELL_RC" ] && source "$SHELL_RC" 2>/dev/null',
    `exec bun "${scriptPath}" ${mode}`,
    "",
  ].join("\n");

  writeFileSync(join(hookDir, "session-start.sh"), makeWrapper("session-start"));
  writeFileSync(join(hookDir, "user-prompt.sh"),   makeWrapper("user-prompt"));
  writeFileSync(join(hookDir, "stop.sh"),          makeWrapper("stop"));
  chmodSync(join(hookDir, "session-start.sh"), 0o755);
  chmodSync(join(hookDir, "user-prompt.sh"),   0o755);
  chmodSync(join(hookDir, "stop.sh"),          0o755);
}

function cmdObsidianBrainInstall(): CommandResult {
  const log: string[] = [];

  // 0. Ensure all directories exist up-front (avoid downstream ENOENT)
  try {
    ensureBrainDirs();
    log.push("✓ Brain directories prepared");
  } catch (e: any) {
    return { ok: false, error: "Failed to create brain dirs: " + e.message, log: log.join("\n") };
  }

  const skillsDir = getClaudeSkillsDir();

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

  // 2. Generate the brain script + hook wrappers
  log.push("Writing brain script + hook wrappers…");
  try {
    writeHookScripts();
    log.push(`✓ Brain script at ${getObsidianBrainScriptPath()}`);
    log.push(`✓ Hook wrappers in ${getObsidianHookDir()}`);
  } catch (e: any) {
    return { ok: false, error: "Failed to write brain script: " + e.message, log: log.join("\n") };
  }

  // 3. Create seed index.md if missing
  const indexFile = join(getObsidianVaultDataDir(), "index.md");
  if (!existsSync(indexFile)) {
    writeFileSync(indexFile, "# Obsidian Brain — prompt index\n\n");
    log.push(`✓ Vault index created: ${indexFile}`);
  }

  // 4. Register MCP server with Claude Code (so the AI can query mid-session)
  const scriptPath = getObsidianBrainScriptPath();
  // Remove stale registration (if any) then add fresh
  tryRun(loginShell(`claude mcp remove obsidian-brain -s user`), 15_000);
  const mcpAdd = tryRun(loginShell(`claude mcp add obsidian-brain -s user -- bun "${scriptPath}" mcp`), 15_000);
  if (mcpAdd.ok) {
    log.push("✓ MCP server 'obsidian-brain' registered (brain_search, brain_recent, brain_read)");
  } else {
    log.push("⚠ Failed to register MCP server — install Claude Code CLI or register manually:");
    log.push(`   claude mcp add obsidian-brain -s user -- bun "${scriptPath}" mcp`);
  }

  // 5. Obsidian app hint
  if (!obsidianAppInstalled()) {
    log.push("ℹ Obsidian desktop app not detected — install from https://obsidian.md");
  } else {
    log.push("✓ Obsidian app detected");
  }

  log.push("");
  log.push("Use the ON/OFF toggle to activate hooks.");
  log.push("The MCP server is always available to Claude Code for brain queries.");
  return { ok: true, log: log.join("\n") };
}

function cmdObsidianBrainUninstall(): CommandResult {
  const log: string[] = [];
  const skillsDir = getClaudeSkillsDir();

  // 1. Unregister MCP server
  const mcpRemove = tryRun(loginShell(`claude mcp remove obsidian-brain -s user`), 15_000);
  if (mcpRemove.ok) log.push("✓ MCP server 'obsidian-brain' unregistered");

  // 2. Remove Obsidian skills
  for (const s of OBSIDIAN_SKILL_DIRS) {
    const p = join(skillsDir, s);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      log.push(`✓ Removed skill: ${s}`);
    }
  }

  // 3. Remove brain dir (hooks + script + enabled flag)
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
