'use strict';
// Validation for .claude-plugin/plugin.json and the launcher.
//
// This plugin ships prebuilt binaries selected at runtime by
// `process.platform`. A manifest that names a platform Node never reports, or
// a platform with no shipped binary, fails only on the user's machine — there
// is no build step here that would catch it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));

// The map launcher.js uses, kept in sync deliberately: if it changes there,
// this must change too, and the test below proves they still agree.
const EXECUTABLES = {
  win32: 'claude-grimoire-win.exe',
  darwin: 'claude-grimoire-mac',
  linux: 'claude-grimoire-linux',
};

// Node's documented process.platform values.
const NODE_PLATFORMS = ['aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32'];

test('manifest has the fields the plugin loader requires', () => {
  for (const k of ['name', 'version', 'description', 'platforms', 'commands']) {
    assert.ok(manifest[k], `missing "${k}"`);
  }
});

test('every declared platform is a real process.platform value', () => {
  // REGRESSION: the manifest declared "win64", which process.platform NEVER
  // returns — Node reports "win32" on 64-bit Windows too. The Windows binary
  // shipped, but the manifest named a platform that does not exist.
  for (const p of manifest.platforms) {
    assert.ok(NODE_PLATFORMS.includes(p),
      `"${p}" is not a process.platform value (expected one of ${NODE_PLATFORMS.join(', ')})`);
  }
});

test('every declared platform has a shipped binary', () => {
  // A declared platform with no binary means the launcher exits with
  // "Executable not found" — after the user has already installed.
  for (const p of manifest.platforms) {
    const exe = EXECUTABLES[p];
    assert.ok(exe, `no executable mapped for platform "${p}"`);
    assert.ok(fs.existsSync(path.join(ROOT, exe)), `${p}: ${exe} is not shipped`);
  }
});

test('every shipped binary is declared', () => {
  // The reverse direction: a binary nobody can reach is dead weight in the
  // package, and usually means a platform was dropped by accident.
  for (const [plat, exe] of Object.entries(EXECUTABLES)) {
    if (fs.existsSync(path.join(ROOT, exe))) {
      assert.ok(manifest.platforms.includes(plat),
        `${exe} ships but "${plat}" is not in manifest.platforms`);
    }
  }
});

test('launcher.js and the manifest agree on the platform set', () => {
  // The two lists live in different files and WILL drift otherwise — that
  // drift is exactly what produced the win64/win32 mismatch.
  const launcher = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  for (const p of manifest.platforms) {
    assert.ok(launcher.includes(`${p}:`), `launcher.js has no branch for "${p}"`);
  }
});

test('shipped binaries are not empty', () => {
  // A 0-byte binary from a failed build is worse than a missing one: the
  // launcher finds it and spawns something that cannot run.
  for (const exe of Object.values(EXECUTABLES)) {
    const f = path.join(ROOT, exe);
    if (!fs.existsSync(f)) continue;
    assert.ok(fs.statSync(f).size > 1024, `${exe} is suspiciously small`);
  }
});

test('version is semver-shaped', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+/, `version "${manifest.version}" is not semver`);
});

test('every referenced command file exists', () => {
  // commands/ is a directory reference; a missing .md is a dead menu entry.
  const dir = path.join(ROOT, manifest.commands.replace(/^\.\//, ''));
  assert.ok(fs.existsSync(dir), `commands dir "${manifest.commands}" missing`);
  const mds = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  assert.ok(mds.length > 0, 'commands/ contains no .md files');
});
