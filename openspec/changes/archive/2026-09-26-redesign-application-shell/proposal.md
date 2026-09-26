## Why

The owner rejected the current interface after using the preview. An ungrouped,
crowded navigation and legacy dashboard entry obscure the working accounting flows;
the first redesign slice establishes a usable responsive shell without replacing
financial behavior or owner data.

## What Changes

- Replace the current horizontal/mobile navigation with a restrained responsive
  layout, explicit active destination, keyboard skip link and labelled mobile menu.
- Open manual accounts after full authentication and at the private root. Preserve
  the old dashboard under `/legacy-overview` with an honest scope notice; group its
  legacy asset/wallet links below current accounting destinations.
- Restyle password/MFA/recovery presentation with the same visual rules; retain
  real authentication, errors, theme preferences and logout semantics.
- Preserve account/editor routes, data, exact amounts, independent drafts and
  ambiguous-command recovery. This is the first slice of the complete redesign.

## Capabilities

### New Capabilities

- `application-shell`: Responsive Russian navigation, honest accounting entry,
  accessible controls and consistent login presentation.

### Modified Capabilities

None. Existing authentication/accounting/private-route requirements remain unchanged.

## Impact

Frontend App/Layout/styles/login presentation, route-focused tests and one selected
real HTTPS browser journey. Keep React Router, theme/auth contexts and equivalent
native controls already installed. No dependency, backend, schema or deployment change.
Data impact: none; legacy storage/APIs remain intact. Follow the screen inventory in
docs/frontend-screen-audit.md and the overall docs/frontend-redesign-plan.md.

Depends on the existing functional accounting/authentication baseline. Swap runtime
checks pass at4decf5a, but its independent review and archive remain pending; this
separate frontend work does not waive those gates. Root keeps Docker/migrations/locks
centralized and preserves the owner's Nginx edit and preview volume.

Non-goals: completing all FUI tasks, restructuring operation editors, new portfolio
metrics, chart periods/library migration, provider health, AI, production deployment,
removing legacy data or asserting that the owner has approved the new design.
