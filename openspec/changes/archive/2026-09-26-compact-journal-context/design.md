## Context

The account has working section/workflow selection but three static explanatory paragraphs still precede its initialized editor. Existing review screenshots show excessive mobile scrolling. Controllers, journal pins, exact values and recovery already have real browser/PG coverage.

## Goals / Non-Goals

Goals: reduce initial explanation, retain exact accessible context and preserve every editor/guard. Non-goals: change field validation or accounting, alter editor focus, introduce a component library, replace result tables or update preview/production.

## Decisions

- Use native details/summary within the initialized journal branch, closed initially, with the label «Параметры и правила учёта». No custom toggle state, timers, portal or editor reparenting is needed.
- Retain existing complete prose and live journal values in the disclosure. Outside it show «Учёт операций в USD. Без рыночной оценки.» Keep the same initialization warning before the uninitialized workflow.
- Leave errors, receipts, conflicts and original-request retry in their current shared position outside both disclosure and account sections. The disclosure contains informational text only.
- Reuse scoped CSS with visible focus and a44px minimum summary target. No animation or truncation. Preserve the native open state across ordinary journal renders/section/workflow selection; actual account remount starts closed.
- Extend current WORKFLOW-UI/WORKSPACE-UI browser journeys; keep118 characterization tests. No new component abstraction or unit tests that merely mirror static markup.

## Risks / Trade-offs

- Hidden information might include an action/recovery need → only the three existing static explanatory blocks move; all actionable states stay visible.
- React composition might reset drafts/disclosure → preserve editor positions/keys/controllers; assert original exact drafts, nodes and File in real browser.
- Long timestamps/counts might overflow → allow wrapping and verify360/768/1440px compact and expanded screenshots.
- Historical tests might assume visible metadata → inventory exact locators; adjust entry actions only and retain financial oracles.

## Migration Plan

No data/schema/backend/API/auth/provider/dependency/pipeline change. Build the existing frontend image, verify against unchanged backend/PG in the disposable test project. Source/image rollback is presentation-only. Preserve owner Nginx and durable preview; no deployment.

## Open Questions

None for this bounded step. Full form/results redesign, correction/void focus and other review followups remain on the frontend backlog.
