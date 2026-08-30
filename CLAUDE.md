# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

This is the plugin version of Claude Grimoire that requires Bun to be installed on the system.

## Repository location

- Local: `/var/minis/repos/claude-plugin-grimoire` — **all repos live under `/var/minis/repos/`**
- Remote: `hexstack-apps/claude-plugin-grimoire` (private)

## Stack

JavaScript, TypeScript

## Conventions

- One logical change = one commit, with the measurements behind it.
- Add a `Requested: "..."` trailer citing the originating request.
- Push to the private `hexstack-apps` remote — that is the backup.
- Never `mv` a git repo inside `/var/minis` (it corrupts the object
  store on this Android FS); re-clone from GitHub instead.
- Run tests AND build before deploying; smoke-test the bundle.

## 🔴 Platform names: `win32`, never `win64`

The manifest declared `"win64"`, which **`process.platform` never returns** —
Node reports `win32` on 64-bit Windows too. `launcher.js` keys its executable
map on `process.platform`, so the Windows binary shipped (2.7 MB, present in
the repo) while the manifest named a platform that does not exist in Node's
vocabulary.

There is no build step here to catch that: the plugin ships prebuilt binaries
selected at runtime, so a wrong platform name fails only on the user's machine,
after installation.

`npm test` now enforces four invariants that cannot drift apart silently:

1. every declared platform is a real `process.platform` value
2. every declared platform has a shipped binary
3. every shipped binary is declared (a binary nobody can reach is dead weight,
   and usually means a platform was dropped by accident)
4. `launcher.js` has a branch for every declared platform — the two lists live
   in different files and **that drift is exactly what produced this bug**

Also checked: binaries are not 0-byte (a failed build produces a file the
launcher happily spawns), version is semver, and `commands/` actually contains
`.md` files.

Verified by mutation: restoring `win64` turns 4 tests red; declaring a platform
with no binary turns 2 red.
