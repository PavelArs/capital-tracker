## Context

The verified harness preserves the current owner's 1348-byte file but incorrectly
requires its SHA-256 in every checkout. The tracked 573-byte file has different bytes.
Neither is a production image input: containers use deploy/container-nginx.conf.

## Goals / Non-Goals

**Goals:** A portable fail-closed pre/post preservation check, including failed runs.
**Non-Goals:** Owner configuration changes, new image/pipeline behavior, consolidation.

## Decisions

- Use a small reusable async guard around the entire acceptance action and cleanup.
  Capture an existing regular file's SHA-256 and permission bits before side effects;
  compare afterwards in a finally path. Missing files/symlinks fail before the action.
  Never silently restore or overwrite changes detected during acceptance.
- Keep the baseline in process memory, avoiding an optional environment/CLI bypass.
  Report both an action failure and a preservation failure when both occur.
- Artifact inspection retains every image/network check; it no longer pretends to
  establish preservation against a machine-specific hash.
- Retain passing current-file characterization. Demonstrate the portability defect
  against the actual existing artifact script in a disposable checkout-shaped
  directory containing the tracked Nginx bytes and the real isolated stack. No owner
  file is modified. New guard tests use actual temporary files, not backend mocks.

## Risks / Trade-offs

- A concurrent legitimate user edit causes failure → leave it intact and report it.
- CI may lack the file → fail closed before generating keys or starting containers.
- File checks do not protect data volumes → retain all existing isolation boundaries.

No database or runtime migration applies. Deployment remains disabled. Verification
requires source/engineering checks, unchanged release-image acceptance, independent
review and strict OpenSpec validation before archive.
