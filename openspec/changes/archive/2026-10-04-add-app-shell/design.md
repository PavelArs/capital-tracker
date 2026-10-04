## Context

The current shell (`components/Layout.tsx`, archived change
`redesign-application-shell`) is a Russian sidebar whose root redirects to
`/manual-accounts`, with older views inside a "Прежние данные" disclosure. The owner
accepted a prototype with a 232 px sidebar, five English sections and dark-first
tokens. Twenty-one critical Playwright cases (hosted CI only) drive the current
screens through the shell: they click legacy links by their Russian names, use the
skip link and the compact menu button, and read the owner email inside the
navigation landmark.

## Goals / Non-Goals

Goals: new sections reachable; nothing current lost; same keyboard and compact-width
contract; theme setting with System default. Non-goals are listed in the proposal.

## Decisions

**One `<nav>` landmark for the whole sidebar.** Tests and assistive technology find
one named navigation that also holds the owner email, as today. The prototype's
`aside` + inner `nav` would split it into two landmarks for no gain.

**Legacy is an open disclosure, Russian labels kept.** D6 keeps old screens as they
are until retired; their link names are part of that and are what the critical cases
click. The group is open by default (the owner still works there daily), can be
collapsed, and reopens when a legacy URL is visited.

**New Settings at `/preferences`.** `/settings` is the legacy settings screen and the
product requirements keep legacy URLs unchanged. M20 can later move or redirect.

**Theme: reuse `ThemeContext`.** It already stores `system | light | dark` under
`localStorage.theme`, defaults to `system`, follows `prefers-color-scheme` and sets
`data-theme` on `<html>`. The new control is a segmented radio group on top of it.
Server-side storage waits for `owner_settings` (M5).

**Tokens namespaced.** New tokens (`--bg`, `--surface`, `--ink`, `--accent`, …) are
defined for `[data-theme='dark']` and `[data-theme='light']` and do not collide with
legacy tokens (`--bg-color`, `--text-color`, …); the prototype's `--shadow` becomes
`--shadow-lg` because legacy uses `--shadow`. Fonts use the system stack: no external
font request.

**Breakpoint stays at 960 px.** Below it the existing compact menu (button with
`aria-expanded`/`aria-controls`, Escape returns focus) is kept, because SHELL-002 and
SWAP-UI rely on it at 360 and 768 px. Desktop 1280 and 1440 both show the full
sidebar; content is capped at 1200 px.

**Placeholders make no requests.** They render static text and a link to the legacy
screen to use meanwhile, so landing on `/dashboard` after login adds no API traffic
and does not change what critical cases observe.

## Risks / Trade-offs

- Browser acceptance cannot run in the sandbox; the shell E2E RED/GREEN comes from
  hosted CI. Mitigated by mechanical text replacements only in other specs and unit
  tests for the layout, placeholders and theme control.
- Mixed English shell and Russian legacy labels until legacy screens are replaced.
  Accepted by D6.

## Migration Plan

None (frontend only). Rollback is reverting the PR.
