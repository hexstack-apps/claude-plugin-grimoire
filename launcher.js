#!/usr/bin/env bun
import { exec, spawn } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const platform = process.platform;

const executables = { win32: "claude-grimoire-win.exe", darwin: "claude-grimoire-mac", linux: "claude-grimoire-linux" };
const executable = executables[platform];
if (!executable) { console.error("Unsupported platform: " + platform); process.exit(1); }

const execPath = join(__dirname, executable);
if (!existsSync(execPath)) { console.error("Executable not found: " + execPath); process.exit(1); }

console.log("Starting Claude Grimoire on " + platform + "...");
const child = spawn(execPath, process.argv.slice(2), { stdio: "inherit", cwd: __dirname });
child.on("error", (err) => { console.error("Failed to start:", err); process.exit(1); });
child.on("exit", (code) => { process.exit(code || 0); });
