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

The first-stage verification found all101paths absent and every corresponding branch
still at its original HEAD. Seven worktrees remained at that checkpoint:

| Worktree | Why retained |
| --- | --- |
| capital-tracker | Main checkout, owner Nginx edit, dependencies and durable preview files |
| capital-tracker-analytics-workbench | Active integration/specification |
| capital-test-analytics-workbench | Active acceptance |
| capital-tracker-analytics-styles | Active scoped styling |
| capital-tracker-transfer-acceptance | HEAD5add71a has non-equivalent commits; no safe merge proof |
| capital-tracker-transfer-page | HEAD1a53400 has a non-equivalent migration-sync commit |
| capital-tracker-worktrees/manual-opening-backend | HEADcf83aae has a non-equivalent storage commit |

These three exceptions initially required a deeper integration proof; see the resolved
followup below. Their branches remain retained.

At that checkpoint main remainedc3a4dbd with only the original frontend/nginx.conf modification. Its SHA256
is115b56ac8b3e19bd0f09db1b0b0217e7344d93c39ddeff7c6c3bd95f7b94b432; lockSHA256 remains
6a6ee2c908a07c1a362e5a0dafdfd49f920e5090dbec2c701c6f8d8e005d883d. Primary dependencies,
preview volume capital-tracker-preview_preview_data, original image7eff01d1 and stopped
preview containers remain. E2E container inventory is empty; no Docker mutation or
production/preview deployment occurred during this cleanup.

Local operational evidence: `/private/tmp/capital-merged-worktrees-inventory.json`,
`capital-merged-worktrees-preflight.log`, `capital-merged-worktrees-removal.json` and
`capital-merged-worktrees-removal.log`. Original project consolidation remains governed
by [consolidation-plan.md](consolidation-plan.md).

## Resolved integration exceptions

Luna inspected the three initially positive git-cherry cases; a separate reviewer and
root independently verified exact proof before deletion:

- Transfer acceptance: stable patch identities68daaa3→7f87f15,
  f802a34→530c8a5,5add71a→89aac53,6be8548→4fbf2bf; all right-hand commits
  are main ancestors. Mergee0a5f3d has empty remerge diff and its second parent
  20b94ac is already ancestral, so there is no unique merge resolution.
- Transfer page: ffb4367's migration file blob and complete file diff are identical
  to main-ancestor b200e64, then1a53400→bbe99ee is patch-equivalent.
- Opening backend: all seven resultant d01fc1b files match ancestor f537161;
  the five backend entity/migration files are still byte-identical in current main.
  The original tasks/verification are retained in the completed opening archive.
  cf83aae→d646507 is patch-equivalent.

Root's first additional preflight refused unlisted dist directories before any removal.
Inspection found only compiled backend JS/declarations/maps/build-info and frontend
HTML/JS/CSS, with no symlinks; the allowlist was updated. Exact HEAD/status/proofs,
owner hashes, preview directory and dependency targets were rechecked. The three
worktrees were then removed without force and every original branch HEAD verified.
At this second checkpoint104had been removed; main plus three active analytics
worktrees remained until the verified integration below.

Evidence: `/private/tmp/capital-remove-integrated-exceptions.py`,
`capital-integrated-exceptions-removal.log` (initial refusal),
`capital-integrated-exceptions-removal-final.log` and
`capital-integrated-exceptions-removal.json`. No original project or owner data removed.

## Final integrated analytics cleanup

After genuine5/5HTTPS/MFA/PostgreSQL acceptance, local gates, independent source and
38-frame review, and OpenSpec archive/comparison, analytics commit2f9ba1f was
fast-forward integrated into refactor/brownfield-baseline. Main's only unrelated edit
remained frontend/nginx.conf with its original bytes/mode; lockfile stayed unchanged.

All three analytics trees passed immediate HEAD/status/generated-file/dependency-link
checks. Root HEAD was ancestral after integration; all three acceptance commits and
the styling commit were patch-equivalent. The six disposable E2E runtime files had
expected names, no symlinks/preview subtree and synthetic certificate subjects. The
38final screenshots were already copied outside those trees. Seven validated links
to primary dependency directories were unlinked; actual dependencies were retained.
Normal non-force worktree removal then deleted all three trees, preserving branches.

Final total:107integrated worktrees removed, only capital-tracker remains registered.
All107unique paths are absent. All104named source branches retain their recorded HEADs;
the other3were detached review trees with HEADs already ancestral to main. The now-empty
capital-tracker-worktrees grouping directory was also removed. Original repositories,
durable preview files/volume/images and owner data remain. No deployment.

Evidence: `/private/tmp/capital-integrate-analytics-cleanup.py`,
`capital-analytics-integration-cleanup.log`, `capital-analytics-integration-cleanup.json`
and `capital-all-worktrees-cleanup-verification.log`. Future independent changes may
create new worktrees; remove them after verified integration under the same guards.
