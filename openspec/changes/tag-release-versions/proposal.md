## Why

The owner cannot tell which version runs on the server (2026-10-04: "теги для образов
надо бы создавать перед деплоем, чтобы понимать какая сейчас версия крутится на
сервере"). Promotion pushes each image only under the full commit SHA, the server
pins images by digest, and nothing in GitHub marks which commit was last deployed.

## What Changes

- Every candidate-bound run (`promote`, `preflight`, `deploy`, `release`) names one
  readable release version from the exact commit: `v<YYYY.MM.DD>-<short SHA>`, the
  date being the commit date in UTC (for example `v2026.10.04-74604d9`).
- Promotion pushes each promoted image under that version tag as well as the commit
  SHA tag, before any preflight or deploy. Receipts and the server still pin digests.
- After a successful `deploy` or `release`, a separate job with only
  `contents: write` creates the Git tag of the same name on the deployed commit.
  The newest version tag is therefore the release running on the server; failed
  releases create no Git tag.

## Capabilities

### New Capabilities
- `release-versions`: readable release version tags on promoted images and on the
  deployed commit.

## Impact

`.github/workflows/cd.yml` and engineering gate tests only. No server file, receipt,
dispatcher, runner or schema change; the owner does not need to run the installer
`update` for this. The deploy job keeps its permissions; only the new tag job can
write repository contents, and it holds no secret.
