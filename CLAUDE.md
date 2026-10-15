@AGENTS.md

<!-- Shared rules for every coding agent belong in AGENTS.md. Codex and the Codex reviewer
read AGENTS.md but not this file. Keep only Claude Code-specific notes below, and run
/doctor prompt-audit after editing either file. -->

## Claude Code

- Cloud sessions start with Node 22 (`/opt/node22/bin`) first on `PATH`, where backend Jest fails with "Must use import to load ES Module". nvm is installed (`/opt/nvm`, loaded lazily from `~/.bashrc`) but has no Node 26, so run `nvm install 26.10.0` once. Environment variables don't persist between Bash calls: begin every command that runs Node or pnpm with `export PATH=/opt/nvm/versions/node/v26.10.0/bin:$PATH &&`. The preinstalled pnpm 12.9.1 then runs on Node 26; check with `node --version && pnpm --version`.
- The built-in Explore and Plan subagents start without these instructions. When you delegate to them, include the rules the task depends on, for example that owner decisions override the brief.
