## 1. Characterization and acceptance first

- [ ] 1.1 Review the screen inventory, current spec contracts and protected-file baseline; run relevant current frontend characterization and record actual results before changing UI behavior.
- [ ] 1.2 Add focused shell interaction tests and one real SHELL-UI browser journey for SHELL-001/002/003; demonstrate genuine predecessor failure for the new default landing/grouped keyboard navigation while retaining existing auth/financial characterization.

## 2. Shell and entry implementation

- [ ] 2.1 Replace Layout navigation with grouped active links, skip link, responsive in-flow disclosure and keyboard focus/close behavior; remove measured-position timers and preserve the Outlet/drafts.
- [ ] 2.2 Route the authenticated root to manual accounts, preserve the labelled legacy overview and existing deep links; retain default-deny auth, logout errors and retired liability notice.
- [ ] 2.3 Apply restrained shell/login styling and shared theme tokens within scoped selectors; verify light/dark, visible focus, reduced motion and360/768/1440px layouts without truncating exact evidence.

## 3. Review and verification

- [ ] 3.1 Independently review navigation, focus, responsive screenshots, honest scope and preservation of auth/recovery behavior; resolve findings and record any quota blocker without claiming review completion.
- [ ] 3.2 Run the scoped manifest against actual release images; record RED/GREEN, image digests, screenshots, retained oracles, protected hashes, cleanup and unrun checks. Update owner/backlog/continuity docs with partial-redesign status.
- [ ] 3.3 After required gates pass, archive using supported OpenSpec commands, compare synchronized canonical requirements and untouched specs, and verify final strict validation. Do not mark all FUI work complete.

## Scoped verification manifest

- Focused component tests: grouped/active links, menu expanded/hidden state, Escape
  focus and skip link. They prove UI behavior only, not authentication security.
- Existing login and accounting draft/presentation characterization; frontend type
  check/build/lint and changed-file formatting. Preserve financial assertions.
- New single `SHELL-UI` Playwright journey: real HTTPS/password/MFA/PostgreSQL,
  anonymous and password-only private denial, new landing, grouped legacy access,
  mobile keyboard/menu/overflow checks,1440desktop and actual logout revocation.
  Use360/768/1440 viewports within the journey; do not multiply the whole E2E suite.
- Retained `SWAP-UI` real committed-response-loss/SPA retry/stale review/correction/
  void and independent trade draft case. Use real backend responses, with only
  already documented transport delay/abort; external providers alone may be stubbed.
- One Chromium worker, zero retries, actual frontend image plus retained backend;
  synthetic screenshots at required widths/light-dark states. No owner screenshots,
  cookies or preview reset. Check changed frontend production dependencies if any;
  run the established production audit before final delivery without hiding failures.
- Strict OpenSpec validation and protected Nginx/lock hashes; test-stack cleanup only.
  No new PostgreSQL financial/migration matrix is needed if backend/schema stay unchanged.
- Unrun by default: full browser matrix, unrelated backend suites, hosted CI,
  production rollout, whole security/release/backup validation and full FUI acceptance.
