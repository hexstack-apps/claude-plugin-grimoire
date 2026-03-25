#!/usr/bin/env bun
/**
 * Claude Grimoire Plugin Launcher
 * Cross-platform launcher for Claude Code plugin
 */

import { exec, spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const platform = process.platform; // 'win32', 'darwin', 'linux'

// Check if Bun is installed
function checkBun() {
  try {
    const result = exec("bun --version", { stdio: "pipe" });
    return true;
  } catch {
    console.error("Error: Bun is required but not installed.");
    console.error("Please install Bun from: https://bun.sh");
    console.error("");
    console.error("Quick install: curl -fsSL https://bun.sh/install | bash");
    process.exit(1);
  }
}

// Platform-specific configuration
const executables = {
  win32: "claude-grimoire-win.exe",
  darwin: "claude-grimoire-mac",
  linux: "claude-grimoire-linux"
};

const executable = executables[platform];
if (!executable) {
  console.error(`Unsupported platform: ${platform}`);
  process.exit(1);
}

const execPath = join(__dirname, executable);
if (!existsSync(execPath)) {
  console.error(`Executable not found: ${execPath}`);
  process.exit(1);
}

// Ensure shared resources are in place
function setupResources() {
  const resourcesPath = join(__dirname, "resources.neu");
  const sharedResourcesPath = join(__dirname, "shared", "resources.neu");

  if (!existsSync(resourcesPath) && existsSync(sharedResourcesPath)) {
    console.log("Setting up resources...");
    const { copyFileSync } = require("fs");
    copyFileSync(sharedResourcesPath, resourcesPath);

    const licensingPath = join(__dirname, "licensing-cli");
    const sharedLicensingPath = join(__dirname, "shared", "licensing-cli");
    if (!existsSync(licensingPath) && existsSync(sharedLicensingPath)) {
      copyFileSync(sharedLicensingPath, licensingPath);
    }
  }
}

// Main execution
async function main() {
  checkBun();
  setupResources();

  console.log(`Starting Claude Grimoire on ${platform}...`);

  // Launch the application
  const child = spawn(execPath, process.argv.slice(2), {
    stdio: "inherit",
    cwd: __dirname
  });

  child.on("error", (err) => {
    console.error("Failed to start application:", err);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
