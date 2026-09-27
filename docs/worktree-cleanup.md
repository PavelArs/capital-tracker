# Merged worktree cleanup — 2026-09-27

The owner explicitly requested removal of already merged worktrees. This supersedes
the earlier blanket retention of development worktrees; it does not authorize deletion
of original repositories, unique work or owner data.

Inventory at mainc3a4dbd covered108registered worktrees. Root removed101 with
`git worktree remove`, without force, after a separate agent inventory and independent
review:19ancestral HEADs and82patch-equivalent branches. All82patch-only ranges contained
no merge commits and every `git cherry` entry was negative. Per-path HEAD/status/proof
were checked again immediately before removal; no tracked/untracked unique edits existed.
Nine worktrees only had an untracked root dependency symlink; exact validated links
were unlinked while the main dependency directories remained intact.

Ignored output was restricted to build/coverage/browser reports/results and known
synthetic E2E runtime fixtures. Fifteen runtime trees contained only the six expected
MFA/proxy/TLS files, no symlinks or preview subtree; certificate subjects matched the
synthetic `.invalid` hosts. No secret contents were printed. The first preflight stopped
on backend/coverage in two link-only worktrees omitted from the initial clean-candidate
ignored inventory; those generated paths were inspected before the allowlist was amended.
The subsequent full preflight and removal passed.

Final verification found all101paths absent and every corresponding branch still at
its original HEAD. Seven worktrees remain:

| Worktree | Why retained |
| --- | --- |
| capital-tracker | Main checkout, owner Nginx edit, dependencies and durable preview files |
| capital-tracker-analytics-workbench | Active integration/specification |
| capital-test-analytics-workbench | Active acceptance |
| capital-tracker-analytics-styles | Active scoped styling |
| capital-tracker-transfer-acceptance | HEAD5add71a has non-equivalent commits; no safe merge proof |
| capital-tracker-transfer-page | HEAD1a53400 has a non-equivalent migration-sync commit |
| capital-tracker-worktrees/manual-opening-backend | HEADcf83aae has a non-equivalent storage commit |

These three exceptions retain their original working trees and branches. Their eventual
cleanup requires reconciling the unique commits; they are not treated as merged.

Main remainsc3a4dbd with only the original frontend/nginx.conf modification. Its SHA256
is115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432; lockSHA256 remains
6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d. Primary dependencies,
preview volume capital-tracker-preview_preview_data, original image7eff01d1 and stopped
preview containers remain. E2E container inventory is empty; no Docker mutation or
production/preview deployment occurred during this cleanup.

Local operational evidence: `/private/tmp/capital-merged-worktrees-inventory.json`,
`capital-merged-worktrees-preflight.log`, `capital-merged-worktrees-removal.json` and
`capital-merged-worktrees-removal.log`. Original project consolidation remains governed
by [consolidation-plan.md](consolidation-plan.md).
