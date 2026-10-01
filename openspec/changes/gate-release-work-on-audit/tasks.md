## 1. Specify and demonstrate acceptance failure

- [x] 1.1 Specify ENG-004-A/B/C and reviewed risk-based policy verification scope.
- [x] 1.2 Add actual workflow prerequisite and no-bypass assertions in `backend/src/engineering/gates.spec.ts`; observe intended missing early-gate RED before implementation.

## 2. Implement and verify

- [x] 2.1 Add audit/specification prerequisites to the release job; run new ENG-004 tests and existing affected engineering gate regressions to GREEN.
- [x] 2.2 Check scoped formatting, strict OpenSpec validation and unchanged release/security/acceptance commands; record exact evidence and unrun checks in verification.md.
- [ ] 2.3 Obtain independent root review before integration or archive; resolve findings.

## 3. Owner-requested temporary CI E2E pause

- [x] 3.1 Specify ENG-005-A/B/C and obtain independent design review for default pause, retained builds/scans and release provenance refusal.
- [x] 3.2 Add executable actual workflow and CD embedded-validator acceptance tests; observe genuine missing pause/export guards and wrongly accepted skipped/absent/failed/cancelled/unknown acceptance RED.
- [x] 3.3 Implement source switch, explicit paused builds and guarded browser/candidate steps; require actual successful full-acceptance provenance for non-inventory CD modes; obtain affected policy GREEN.
- [ ] 3.4 Record final scoped checks and limitations; independently review the final diff before integration or archive.
