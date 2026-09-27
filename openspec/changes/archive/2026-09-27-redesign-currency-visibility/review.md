# Independent review — 2026-09-27

Independent bounded review: approved

A separate gate agent reviewed the proposal/scenarios, acceptance oracles and final
product `87cf954`. Sol authored acceptance in a separate worktree; Luna authored scoped
CSS. Root integrated, implemented controllers and ran the actual Docker/browser gates.

Resolved findings:
- Shared command ownership survives Settings unmount/remount; the new instance waits,
  reads one fresh pair, and old completion cannot publish/refetch or steal focus.
- Paired reads wait for both settlements and publish only complete successful data.
  Initial failure does not invent zero/empty results; later failure retains both lists.
- Exact preference-table checks preserve foreign/unrelated rows and original identity/
  creation timestamps; financial/provider/catalogue fingerprints remain unchanged.
- The first real hide returned400 because the old wrapper omitted DTO isHidden. Source
  review initially missed that contract mismatch. Exact request assertions were corrected
  before the client fix; two observed unit failures and real400 establish the defect.
  Final true/false bodies satisfy existing validation; no backend relaxation.
- The original scope sentence was restored after retained DFX failed on changed copy.
  The entire DFX test remains byte-identical to the base.

The reviewer viewed all36actual final PNGs:18currency,6General,12FX; light/dark at
360/768/1440. Controls, labels, status, identities and focus are readable; narrow tables
use the specified contained horizontal scrolling. FX desktop preserves exact
123.45 →111.105EUR /11125.314RUB, with stored reads separate from provider collection.
Final actual log confirms2/2PASS37.7s,1worker0retries and synthetic cleanup. No blockers.

Evidence: `/private/tmp/capital-currency-workbench-final-artifacts`, `...-final.log`
and [verification.md](verification.md). Root also viewed representative actual currency
frames. Approval covers this scoped Chromium implementation and source, not owner UX
approval, other browsers, integration health, live providers or full release readiness.

A separate Sol read-only review of `/private/tmp/capital-integrate-currency-cleanup.py`
confirmed fixed path/HEAD/branch allowlists, patch equivalence, dependency links,
synthetic runtime filenames/cert subjects, owner hashes and non-force removal guards.
Execution still requires final archive/accepted commit and immediate preflight.
