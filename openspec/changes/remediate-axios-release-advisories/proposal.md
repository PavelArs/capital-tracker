## Why

Hosted production dependency audit run 36857990125 failed on 2026-10-01 with
seven high and six moderate production findings; the displayed high findings are Axios advisories. The installed 1.18.0 release is below
the verified 1.20.0 fix floor; this blocks the manual + CSV MVP release.

## What Changes

- Pin backend and frontend Axios to the verified exact 1.20.0 release and update
  only their associated lock entries.
- Retain the fail-closed production audit and visible findings at every severity.
- Update the release-image provider probe's exact Axios version assertion.
- Record frozen installation, existing characterization, real HTTP transport,
  builds, registry audit and subsequent independent/runtime review evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `engineering-gates`: add reproducible security-remediation evidence and retained
  Axios transport/provider characterization to the dependency gate contract.

## Impact

Dependency manifests, lockfile, synthetic provider probe, and security evidence
only. No database/schema/data changes or new services, quotas or costs. Depends
on the existing production audit and isolated release acceptance. General lock
refresh, deployment, canonical archive, network-sync features and AI are non-goals.
