## ADDED Requirements

### Requirement: RVR-001 Readable version on promoted images
Every candidate-bound CD run SHALL name one release version from the exact commit as
`v<YYYY.MM.DD>-<first 7 characters of the commit SHA>`, using the commit date in UTC,
and SHALL refuse any other shape. Promotion SHALL push every promoted image under that
version tag as well as the commit SHA tag, from the same tested local image, before
any preflight or deploy request. Receipts SHALL keep only the digests.

#### Scenario: RVR-001-A Name the version from the commit
- **GIVEN** a commit dated 2026-10-05T01:30:00+03:00
- **WHEN** the version is named
- **THEN** it is `v2026.10.04-` followed by the commit's first 7 SHA characters and is exported to later steps

#### Scenario: RVR-001-B Push the version tag with the tested images
- **WHEN** promotion publishes the backend, frontend and PostgreSQL images
- **THEN** each is pushed under the commit SHA tag and the version tag, both tagged from the tested image ID
- **AND** the receipt digests are those of the commit SHA tags

### Requirement: RVR-002 Git tag for the deployed release
After a successful `deploy` or `release` request, the workflow SHALL create the Git tag
named by the release version on the deployed commit in a separate job that needs the
deploy job, has only `contents: write`, and uses no environment or secret. An existing
tag SHALL be accepted only when it points at the same commit. Failed, `inventory`,
`promote` and `preflight` runs SHALL NOT create a tag. The deploy job SHALL keep its
permissions.

#### Scenario: RVR-002-A Tag only a successful deployment
- **WHEN** the dispatcher accepted the deploy request
- **THEN** the deploy job reports the version and the tag job creates `refs/tags/<version>` on the commit
- **AND** no version is reported for other modes or failed requests

#### Scenario: RVR-002-B Refuse conflicting or malformed tags
- **WHEN** the tag already exists on another commit, or the reported version is malformed
- **THEN** the tag job fails without creating or moving a tag
