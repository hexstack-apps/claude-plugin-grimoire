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
