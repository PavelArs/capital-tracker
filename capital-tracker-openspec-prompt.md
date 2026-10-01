# Capital Tracker — Brownfield Refactor with OpenSpec, Agentic ATDD and GitHub Actions

You are the lead engineer working inside my existing Capital Tracker repository. Refactor and simplify it into a private, single-owner, self-hosted cryptocurrency portfolio application.

Use OpenSpec for specification-driven development and acceptance-test-driven development (ATDD) for implementation. Deliver working vertical slices, executable acceptance tests, and a reproducible deployment pipeline—not just a plan or a UI prototype.

## 1. Product goals and fixed constraints

I want to understand what I own, its current value, my actual profit or loss, and my annualized investment return. I currently record cryptocurrency purchases and sales in Excel. Preserve that investment history through import and reconciliation with blockchain observations.

The application must provide configurable assets and wallets, current balances, transactions, historical charts, performance for arbitrary periods, and concise, personalized AI insights when I explicitly request them.

Hard constraints:

- Refactor the existing application; do not automatically start a replacement repository or preserve unnecessary legacy features.
- One owner, no public registration, no sharing, no multi-tenant features.
- Normal browser access through an HTTPS domain and application authentication. A VPN must not be required.
- Read-only toward blockchains and exchanges. Never store seed phrases or spending keys, sign transactions, place orders, or execute AI recommendations.
- External market-data, blockchain, news, and LLM integrations must use genuinely free access/free tiers. No paid fallback, automatic upgrade, mandatory trial, or silent billing.
- Persist historical data in PostgreSQL. Opening dashboards or changing chart periods must not repeatedly query external providers.
- Russian UI and user-facing AI output; English code, specifications, and engineering documentation.
- Keep implementation and operations practical for one backend engineer/tester.

## 2. Technical direction

Prefer TypeScript throughout: the existing NestJS backend, TypeORM, PostgreSQL, and a React + Vite frontend. Use Mantine and Apache ECharts where new UI/components are needed, but reuse equivalent working components when that avoids unnecessary churn.

Keep a modular monolith. Separate domain accounting, blockchain adapters, market data, authentication, reporting, and AI through clear modules/interfaces. Do not introduce Go, Next.js, microservices, Kafka, Kubernetes, or Redis without a demonstrated need and a documented decision.

Inspect and retain the repository's working package manager and supported runtime. Do not switch package managers solely for preference. Use compatible supported dependency versions, strict TypeScript, a committed lockfile, and reproducible installation. Do not install floating `latest` versions in CI.

Use explicit database migrations in development, tests, and production. Production must have TypeORM `synchronize: false`.

Deploy with Docker Compose behind Nginx/HTTPS. The previous project used separate backend/frontend images, Yandex Container Registry, and `/opt/capital-tracker`. Treat these as inspection hints, not verified current repository state. Preserve useful deployment configuration; do not switch registries or create new paid infrastructure without a reason.

## 3. Start with a brownfield audit

Before changing product code:

1. Read repository instructions, OpenSpec configuration, source, tests, schema/migrations, Dockerfiles, Compose files, and GitHub workflows. Check Git status and preserve unrelated/uncommitted work.
2. Run the available baseline checks. Distinguish pre-existing failures from newly introduced ones.
3. Create a concise keep/simplify/remove inventory tied to this brief. Identify data that would be affected by removals.
4. Add characterization tests for important existing behavior being retained. Do not freeze accidental bugs or unwanted features into permanent requirements.
5. Identify migration risks, security gaps, and external-provider feasibility before promising complete coverage.

Remove legacy functionality through explicit scoped changes, including obsolete routes, tests, dependencies, configuration, and documentation. Do not drop user data merely because its UI is removed. Destructive schema changes require an export/backup, migration plan, and explicit owner approval.

These requirements supersede earlier MVP exclusions: transaction history, per-asset history, and performance calculations are now in scope.

## 4. OpenSpec is the durable specification workflow

Inspect the installed OpenSpec version, `--help`, available profiles, and generated agent integrations. Initialize it only when needed. Pin the version used by CI. Do not overwrite existing project instructions or assume every slash command exists in every agent integration.

Use the supported spec-driven workflow. Canonical command names include `/opsx:explore`, `/opsx:propose`, `/opsx:apply`, and `/opsx:archive`. Use `/opsx:verify` when the expanded/custom profile provides it; configure that profile or perform and document equivalent verification. Agent slash commands are not shell commands; use the invocation syntax generated for the actual coding tool.

Maintain:

- `openspec/config.yaml`: project context and per-artifact rules for accounting, ATDD, security, and deployment.
- `openspec/specs/`: the current implemented product contract, not a collection of future promises.
- `openspec/changes/<change-id>/`: proposal, requirement/scenario deltas, design, and executable task checklist, following the selected schema.
- `AGENTS.md`: repository commands, agent boundaries, test rules, and completion criteria. Merge with existing instructions.

Use small changes with clear dependencies. For every behavior change, define stable requirement/scenario IDs, observable Given/When/Then examples, error cases, and the relevant security/data-integrity invariants. Follow OpenSpec's actual requirement and delta syntax; do not invent an incompatible format.

Each change must link requirements to acceptance tests, implementation, and verification evidence. Use test titles/annotations and a small manifest where needed; avoid duplicating specifications in multiple documents.

Required development loop:

`inspect -> specify -> review scenarios -> demonstrate RED -> implement GREEN -> refactor -> independently review -> verify -> archive`

Use the installed CLI's supported strict, noninteractive validation in local checks and CI; for example, verify support for `openspec validate --all --strict --no-interactive` before wiring it in.

Specification validation is not a substitute for running tests. A successful agent verification report is not proof that the code is secure or correct. Add actual CI gates. Do not archive incomplete work or mark unexecuted tests as passed, even when a tool only warns about unfinished tasks.

Update specifications when a justified design discovery changes the contract; do not silently change the contract to make incorrect code appear compliant. Ordinary reversible work within this brief may proceed without repeated confirmation. Ask before destructive data changes, new costs, disclosure of private data, or actual production exposure.

## 5. Agentic engineering workflow

These are development roles, not product features. Do not build an agent-orchestration service into the application.

Use separate agents/contexts when supported. Otherwise execute distinct phases honestly without claiming an independent agent ran.

- Coordinator/specification role: chooses the next small change, resolves dependencies, writes/reviews scenarios, and manages scope.
- Acceptance/QA role: designs independent expected outcomes and writes failing acceptance tests before feature implementation.
- Implementation role: makes the smallest complete change that satisfies the specification and tests.
- Review/security role: reviews the diff against requirements, challenges test oracles, probes abuse cases, and requests regression tests for findings.
- Release role: verifies artifacts, migrations, CI gates, deployment, recovery, and operational documentation.

Each delegated task must state its change ID, inputs, allowed files, dependencies, acceptance criteria, expected outputs, and verification commands. Handoffs must include actual files changed, tests run/results, unresolved findings, and the next ready task.

Parallelize only independent work. Use separate branches/worktrees where available. Assign a single owner to shared migrations, dependency/lockfile changes, and deployment files. No concurrent edits to shared files and no unreviewed agent merges.

On resuming work, read repository instructions, active OpenSpec artifacts, Git diff, and the latest verification results. Do not rely on conversation memory as the sole project state.

The implementer must not weaken assertions, disable security checks, skip failing tests, or alter expected financial results just to get a green run. Review findings must be resolved or explicitly documented as blockers. Report blockers without inventing credentials, provider capabilities, command output, or successful deployments.

## 6. ATDD and E2E testing contract

For new behavior and bug fixes, write executable acceptance tests first and run them. Record the expected failing assertion: an unrelated dependency-installation, compilation, or test-environment failure does not demonstrate RED.

Then implement the behavior, rerun to GREEN, refactor, and run relevant regressions. For pure refactors, existing passing characterization/acceptance tests are the correct baseline; do not deliberately break working behavior to manufacture a RED result.

Use Playwright Test for browser E2E and relevant HTTP acceptance/security tests. Reuse the existing unit-test framework rather than introducing overlapping runners. Given/When/Then scenarios may map directly to Playwright; Cucumber is not required.

The critical E2E path must be real:

`browser -> production-like HTTPS reverse proxy -> application -> PostgreSQL`

Use actual migrations, validation, sessions, authorization, accounting, and persistence. Do not mock your own backend responses or bypass authentication to make critical E2E tests pass. For non-authentication suites, reusable authenticated state is allowed only after a real login in an isolated test environment.

Mock external blockchain, pricing, news, and LLM services at the server's outbound HTTP boundary using controlled fixtures/stub servers. This must exercise the actual adapters. Include provider-error, pagination, timeout, malformed-data, and rate-limit fixtures.

Use synthetic portfolios and credentials, isolated/resettable databases, deterministic clocks where needed, fixed price data, and independent test oracles. Test credentials, TOTP secrets, and fixtures must never enter production images/configuration. No production seed/reset/debug endpoint may exist.

Use stable role/label/test-ID locators and web-first assertions. Avoid arbitrary sleeps and execution-order dependencies. Run Chromium on every PR; include important authentication flows in another browser engine before releases. Do not let retries silently turn flaky tests into release evidence.

Collect Playwright reports and failure traces for synthetic data only. Never upload production browser state, portfolio screenshots, real cookies, or private exports as CI artifacts.

Keep arithmetic edge cases in unit/property tests and integration tests; do not force every decimal permutation through the browser. Every critical user journey and security boundary still needs an executable acceptance test.

### Mandatory acceptance examples

Assign stable IDs and expand these into concrete specifications and tests:

1. Unauthenticated direct access to every private API, report, export, and nested URL returns no portfolio data. A frontend redirect alone does not pass.
2. A correct password without successful second-factor verification cannot access private APIs. Invalid/replayed second factors, fixation attempts, expired/revoked sessions, and reused recovery codes are rejected.
3. Logout, password recovery/change, and session revocation prevent reuse of the relevant old sessions. Authentication throttling cannot be bypassed by spoofing proxy headers.
4. State-changing requests without valid CSRF protection fail; hostile labels, imports, token metadata, news, and AI output cannot execute script.
5. Starting value $1,000 plus an external $1,000 contribution, with unchanged prices, produces $2,000 value and $0 investment profit.
6. A transfer between two owned wallets is not an external cash flow or investment gain. Its fee is counted once as a cost.
7. A crypto-to-stablecoin sale within tracked accounts changes holdings/cost basis but is not a withdrawal from the portfolio.
8. With zero fees, buying 1 TOKEN at $100 and 1 at $200, then selling 1.5 at $300, produces FIFO realized profit $250 and remaining cost basis $100.
9. An external contribution of $1,000 on 2025-01-01 and terminal value $1,100 on 2026-01-01 produces XIRR of approximately 10%, within a specified numerical tolerance.
10. Reimporting the same CSV or replaying synchronization pages creates no duplicate accounting entries. Distinct legitimate same-day/same-amount trades are preserved.
11. Connecting a previously owned wallet does not create an artificial gain. Imported trades and observed transfers are reconciled without double counting.
12. Editing an old transaction rebuilds affected derived history reproducibly; missing acquisition cost does not become zero cost.
13. Provider failure or unknown price preserves the last known data with a stale/incomplete indication instead of replacing it with zero.
14. Reopening a stored chart and changing its period cause zero provider requests. An explicit backfill requests only missing ranges and respects quotas.
15. A same-symbol token on a different chain/contract is not silently treated as the verified asset. Legacy TRON USDC and unsupported shielded Zcash are identified honestly.
16. Pending/failed/reorganized blockchain events cannot become permanent duplicate settled entries. Adapter coverage limitations are visible.
17. AI analysis requires authentication and an explicit click, transmits only the approved data subset, cites supplied sources, and handles quota exhaustion without spending money.
18. The release images pass clean-install and existing-database migration tests. Backup restore and application rollback are tested on isolated data; failed deployment gates prevent promotion.

## 7. Networks, assets, and synchronization

Initial scope:

- Bitcoin: BTC.
- Ethereum: ETH, USDT, USDC; configurable supported ERC-20 contracts.
- TRON: TRX, USDT, and explicitly identified legacy USDC where actually held; configurable supported TRC-20 contracts.
- Solana: SOL balances and transactions; model owner/token-account relationships correctly for any configured SPL assets.
- Stellar: XLM balances and transactions.
- Zcash: ZEC, with transparent-address monitoring as the initial automated scope.

Separate blockchain network, token identity, price-provider asset ID, wallet group, address, and accounting account. Adding a ticker to a watchlist must not pretend to implement a new blockchain adapter. Identify tokens using network plus contract/mint, not symbol alone.

Verify official contract identifiers before shipping presets. Circle discontinued TRON USDC support; preserve historical/legacy monitoring with an explicit warning, not a misleading currently supported preset. Do not assume identical liquidity/redemption behavior or blindly assign a $1 value.

Shielded Zcash balances/history cannot be obtained from a public address alone. For the initial version, provide clearly labeled manual/imported shielded holdings rather than a fictional explorer integration. Do not claim a transparent receiver represents an entire unified wallet. Any future viewing-key integration requires a separate privacy-reviewed design; never send viewing keys to public APIs or an LLM.

For Bitcoin, distinguish one address from a full HD wallet. Never claim complete wallet coverage when change addresses are missing. For Stellar, distinguish total balance from reserved/spendable amounts. Document analogous locked/staked or otherwise unobserved holdings rather than silently omitting them from a purported complete total.

Implement adapters with incremental cursors, pagination, chain-specific event identity, confirmations/finality, replay safety, and bounded reorg recovery. Track native transfers, configured token transfers, fees, and relevant failed/pending states. Ethereum RPC access alone must not be assumed to provide complete address transaction history.

Use database uniqueness constraints and transactions, not only in-memory deduplication. Handle multiple relevant events per transaction without charging the same wallet's network fee multiple times. Treat ambiguous observed transfers as requiring classification/reconciliation.

Show last successful sync, block/cursor coverage, errors, and whether history is complete. Preserve last known values on failure. Poll initially every 15 minutes, with configurable intervals and a rate-limited manual refresh. Prevent overlapping jobs and resume safely after restarts using PostgreSQL-backed coordination/state.

## 8. Free providers and database-first market history

Before choosing providers, produce a small verified capability matrix: official documentation, free-tier availability, API-key requirements, quotas, allowed retention, current prices, historical depth/granularity, balance/history coverage, and failure behavior. Date the verification and calculate expected request usage for the configured portfolio.

Candidate technologies include CoinGecko, Esplora-compatible Bitcoin services, Ethereum RPC/indexers, TronGrid, Solana RPC providers, and Stellar APIs. They are candidates, not promises of complete/free functionality. Investigate a viable Zcash transparent-address source separately. Do not invent endpoints, rotate identities to evade limits, or require full nodes to hide free-provider limitations.

Use adapters so a provider can be replaced without changing accounting. Free keys may be owner-configured server-side. Respect per-minute, daily, and monthly quotas, `Retry-After`, documented terms, and caching rules. Batch price requests and back off with bounded retries/jitter. Stop gracefully at free limits; never enable a paid fallback.

Persist price observations with asset identity, quote currency, timestamp, source, granularity, and quality/provenance. Maintain indexed unique keys and history-coverage ranges. Retain historical data according to provider permissions; do not choose a provider whose terms contradict required storage.

Dashboards and charts read the database. Background jobs collect new prices, and explicit history/backfill jobs fill missing intervals only. Preserve already stored history even when an external provider's accessible window moves forward.

Local storage does not create missing past prices. Expose gaps, unavailable depth, and estimated/manual values explicitly. Do not fabricate intraday accuracy from daily data, interpolate silently, or synthesize exchange candles from portfolio snapshots.

Use USD as the accounting base and provide EUR/RUB display with documented conversion. Historical calculations require appropriate historical FX rates, not today's exchange rate. Keep the core application usable when an optional provider is absent.

## 9. Accounting, import, and performance

Separate raw provider/import observations, normalized economic operations, current observed balances, and reproducible derived valuations. Current balances do not establish acquisition cost or investment performance.

Support purchases, sales, swaps, external contributions/withdrawals, transfers between owned accounts, fees, explicitly categorized income/rewards, and opening balances. Define external-flow classifications and reward treatment before implementation. Unknown classification or acquisition cost must remain visible, not be silently guessed.

Provide manual accounts for exchange/off-chain holdings without requiring exchange API integration. Avoid double counting the same funds through both a manual account and an attached address. A shared exchange deposit address must not be treated as wholly owned by me.

Import CSV exported from Excel with column mapping, preview, validation, row errors, time-zone/decimal handling, batch provenance, and safe rollback of an import batch. Preserve legitimate duplicate-looking trades while preventing repeated batch imports. Store the original input privately and link imported operations to observed blockchain events where justified. Ambiguous matches require review.

Use exact decimal arithmetic or integer base units for money/quantities and PostgreSQL exact numeric types with documented precision. Return precise amounts as API strings. Do not use JavaScript floating-point amounts in accounting; conversion for chart rendering must happen only at a display boundary.

Use FIFO initially, preserve lot provenance across owned transfers, and document fee allocation. Do not call the output a tax-compliance report.

Calculate separately:

- Current portfolio value and allocation.
- External contributions and withdrawals.
- Period profit: ending value minus starting value minus external contributions plus external withdrawals.
- Realized and unrealized gains, fees, and data-completeness status.
- XIRR using actual dated external flows, negative opening value for a selected period, and positive terminal value. Internal trades are not investor cash flows.
- TWR using flow-boundary valuations where available. Label an approximation honestly or return insufficient data when exact calculation is unsupported.

Handle absent/multiple XIRR solutions, numerical tolerance, zero/negative balances, partial disposals, rounding, missing costs, and short periods. Label annualized short-period returns as annualization, not a forecast.

Store observed balances and price history. Reconstruct historical holdings from operations and opening states, not by multiplying today's holdings by old prices. Distinguish observed snapshots from reconstructed estimates. Recalculate affected derived history when old operations change. Store UTC timestamps and define display-time-zone/date boundaries consistently.

Provide Russian-language Dashboard, Assets/Wallets, Operations/Import, History/Performance, AI Analysis, and Settings/Integration Health screens. Include charts for capital, external net flows, performance, and allocation; 1D/1W/1M/1Y/all/custom periods; zoom/tooltips; per-asset detail; loading, empty, stale, incomplete, and error states; desktop/mobile layouts.

### Owner frontend direction — 2026-09-26

After reviewing the local preview, the owner rejected the current visual design and
usability and requested a complete frontend redesign. Build a modern, restrained,
responsive interface focused on functionality and user experience, without ornamental
effects or unnecessary animations. An early-2000s aesthetic is an allowed influence.
Redesign navigation and workflows as well as styling; the existing frontend is not the
target UX. Preserve working accounting/authentication and user data, delivering the
redesign in incremental verified OpenSpec changes. The owner will review the frontend
again after it has been redesigned. Track the required work and acceptance criteria in
[docs/frontend-redesign-plan.md](docs/frontend-redesign-plan.md).

## 10. Authentication, privacy, and security verification

A public domain must expose only the login surface, necessary static assets, and a minimal non-sensitive liveness response. Deny private access by default at the backend. Protect reports, exports, background-job triggers, settings, AI analysis, and any alternative API routes—not just navigation.

Use a versioned OWASP ASVS baseline, initially stable ASVS 5.0.0 unless a newer stable revision is verified during implementation. Map all applicable Level 2 requirements to implementation, automated tests/manual review evidence, or justified not-applicable decisions. Do not claim certification or protection against every possible vulnerability.

Required controls:

- CLI-only owner bootstrap/recovery, no default credentials, public registration, email-reset dependency, or permanently exposed setup route.
- Argon2id password hashing with reviewed parameters and input limits; no custom password cryptography.
- Password plus mandatory TOTP for public production access, using maintained libraries. Protect enrollment and recovery; hash single-use recovery codes, encrypt TOTP secrets with a server-held key, and prevent replay.
- Opaque cryptographically random server-side sessions, with protected/hashed stored session tokens, Secure/HttpOnly cookies, explicit SameSite policy, rotation, idle/absolute expiry, and revocation. Never store auth tokens in localStorage.
- No full session privileges before second-factor completion. Require recent authentication for sensitive authentication/security changes.
- Server-side CSRF protection, restrictive CORS/origin handling, generic authentication errors, bounded per-account/IP throttling, and safe recovery from lockout. Trust forwarded headers only from the actual reverse proxy.
- Parameterized queries, strict validation/allowlisted mutable fields, output encoding, safe Markdown rendering, and protection against injection, XSS, mass assignment, unsafe redirects, and CSV formula injection.
- SSRF protection for provider/news/LLM fetching: server-managed endpoint allowlists, validated destinations and redirects, and blocking unexpected local/link-local/metadata targets. Never fetch arbitrary URLs supplied by a model or browser input.
- HTTPS, security headers and an appropriate CSP, clickjacking protection, private-response cache controls, request/body/upload limits, bounded outbound requests, and no secrets or sensitive data in error messages.
- No public PostgreSQL, internal backend/debug/admin port, metrics with private labels, source-map secrets, uploaded CSV directory, or backup directory. No default permissive development configuration in production.
- Server-only API credentials, no secrets in frontend bundles/images/Git/logs. Redact sensitive audit data. No third-party analytics, arbitrary external images, or unnecessary telemetry.
- Least-privilege application/database/container permissions; separate migration privilege where practical. Do not mount the Docker socket into application containers. Document host patching, SSH hardening, and credential rotation.

Document a threat model covering anonymous attackers, stolen/revoked sessions, malicious provider/import/news content, dependency compromises, CI compromise, and backups. Clearly state that server/owner-device compromise is not solved by application login.

Implement targeted negative API/E2E tests, static analysis, dependency/image vulnerability scanning, secret scanning, and authenticated plus unauthenticated OWASP ZAP checks. Verify that authenticated DAST actually reaches private routes rather than only scanning the login page. Scanner success does not replace logical authorization tests or code review.

Active scans run only against explicitly owned isolated test/staging targets containing synthetic data. Never run destructive scans against production by default or against third-party providers.

Block releases for unresolved critical/high findings and for any demonstrated authentication bypass or private-data disclosure regardless of scanner severity. Triage other findings with documented ownership and expiry of any accepted exception. Provide an evidence-based security report with tested commit, tool/rule versions, scope, findings, and remaining limitations—not “all vulnerabilities checked.”

## 11. On-demand AI portfolio insights

Implement a button-triggered analysis, not autonomous trading or continuous background generation.

Allow configurable investment horizon, risk tolerance, target allocations, reserve needs, and suggestion style. Do not invent my risk profile. Keep advice concise: consider buying/reducing/holding/rebalancing or doing nothing, with portfolio-specific reasons, risks, counterarguments, and conditions for reconsideration.

The backend computes all financial metrics. Give the LLM a minimal approved summary plus retrieved market/news context with source identifiers, publication times, and event times where available. Validate structured output and allow citations only to sources actually supplied/retrieved.

External AI is optional and free-tier only. Verify the provider's data-use/retention terms and show what will be transmitted before the owner opts in. Do not assume a free service is private. Exclude addresses, TXIDs, keys, cookies, and raw operation history by default; use allocation percentages instead of exact wealth where sufficient.

News and model output are untrusted data. The LLM must have no arbitrary code execution, unrestricted browsing, access to secrets, database write capability, or trading tools. Do not render unsanitized HTML or automatically follow model-generated URLs.

Store analysis history privately with model/configuration, data freshness, and source provenance. Handle malformed output, insufficient evidence, outages, and exhausted quotas honestly. No fabricated news, guaranteed returns, pseudo-statistical confidence, or paid fallback. Core portfolio functionality must work without AI.

## 12. GitHub Actions CI/CD

Inspect and improve existing workflows instead of adding an unrelated deployment system. Provide reusable repository scripts invoked both locally and in CI.

### CI gates

Run on pull requests and relevant pushes, including changes to specs, tests, migrations, dependencies, Docker, and workflows:

1. Reproducible install, formatting/linting, type checking, and supported OpenSpec validation.
2. Unit/property and integration tests with a real PostgreSQL instance.
3. Migration checks from an empty database and from a representative sanitized previous schema/data snapshot.
4. Production image build, dependency/image/secret scanning, and static security checks.
5. Playwright acceptance tests against the release-candidate images with a production-like HTTPS proxy and synthetic external services.
6. Authenticated/unauthenticated security checks and a single aggregate required result that fails when any required job fails, is cancelled, or is unexpectedly skipped.

Keep live provider smoke/contract checks separate, bounded, and explicitly triggered or scheduled only when enabled. Deterministic merge gates must not depend on market conditions, real wallets, paid services, or third-party uptime. Free quota exhaustion must not disable offline acceptance tests.

Build once per release candidate, test/scan those actual images, publish the same outputs, and deploy immutable digests associated with the tested commit. Do not rebuild different artifacts after tests or deploy a mutable `latest` tag.

### Pipeline security

Pin external actions to verified full commit SHAs, restrict GITHUB_TOKEN permissions per job, and separate untrusted PR validation from publishing/deployment privileges. Do not execute untrusted PR code with secrets through `pull_request_target` or an unsafe privileged follow-up workflow. Validate any cross-workflow artifact/run provenance.

Never execute untrusted PR jobs on the production host. Prefer GitHub-hosted runners within available free quotas. A trusted private connectivity runner, if necessary, must be isolated from production data and unavailable to untrusted contributions.

Store deployment credentials in appropriate GitHub secrets and runtime secrets on the server. Do not put secrets in Docker build arguments or copied Compose files. Use an SSH deploy key dedicated to deployment and verified host keys; never disable host-key checking. Limit the deploy account's capabilities, recognizing that unrestricted Docker access is effectively host-administrative access.

Do not assume private-repository required reviewers, environment protections, security products, or unlimited Actions minutes are free. Check plan availability. Provide a no-additional-paid-service path using appropriate workflow guards, repository secrets, and `workflow_dispatch` where needed. Document the residual trust in repository administrators.

### Production release

Only trusted main-branch commits that passed required gates may be promoted. Support controlled `workflow_dispatch`; routine automatic main-branch deployment may be enabled after the owner explicitly enables the first production rollout. Do not deploy to the real server merely because this prompt asks you to create a pipeline.

Serialize production deployments and use a server-side deployment lock. Do not cancel a deployment midway through a migration. Ensure an older queued release cannot overwrite a newer successful release unintentionally.

Implement a release procedure that:

- Validates configuration and selects the exact tested image digests.
- Takes an encrypted pre-migration database backup and records its location/checksum; keeps encryption keys separate.
- Runs migrations once as a dedicated release step, with proper failure handling and application/schema compatibility.
- Updates Compose services without exposing internal ports.
- Checks readiness and performs minimal non-destructive production smoke checks, including anonymous access denial.
- Records the deployed commit, image digests, migration version, and health result.
- Restores the previous application images on failure only when schema compatibility permits; otherwise stops safely and provides a recovery procedure.

Use expand/contract migrations where needed. Do not claim image rollback reverses database migrations. Do not automatically restore an old database over newer user writes. Test backup restoration in isolation and document data-loss boundaries, recovery steps, and intentional downtime.

Do not use the owner's reusable password/TOTP secret in routine CI smoke tests. Comprehensive authenticated tests belong in isolated release/staging environments; any production authenticated smoke mechanism requires a separate documented security design with no authentication bypass.

Preserve required previous images for rollback. Do not prune volumes or the last known-good release. Provide backup rotation, manual rollback/restore commands, startup/restart instructions, and a secrets inventory containing names—not values. Missing server credentials must block deployment honestly, not testing or preparation of the pipeline.

## 13. Delivery sequence and definition of done

Work in small independently verifiable changes, approximately in this order:

1. Repository audit, simplification plan, OpenSpec/AGENTS setup, baseline tests, and CI skeleton.
2. Secure single-owner authentication, threat model, and negative acceptance tests.
3. Accounting/import and deterministic profit/XIRR tests.
4. Database-first prices, historical coverage, and portfolio charts.
5. Blockchain adapters and reconciliation, delivered network by network with explicit coverage.
6. Optional on-demand AI analysis with privacy and free-tier constraints.
7. Final release hardening, migration/recovery exercises, and deployment readiness.

Introduce CI and security from the beginning; do not postpone them until the final phase. Stage limited releases only with honest capability labels. Do not call a network supported when it has only a price quote or an unimplemented adapter stub.

A change is done only when its specification, acceptance examples, implementation, migrations, relevant tests, security review, and operational documentation agree. Record actual commands and results, not invented output. Mark unexecuted checks and unavailable integrations explicitly. Keep incomplete changes active rather than archiving them as complete.

Deliver working code, OpenSpec artifacts, tests, `.env.example`, Compose/Docker files, GitHub workflows, a concise README, provider coverage/limits, the security verification matrix, and deployment/backup/recovery instructions. Consolidate documents where practical instead of producing ceremonial duplication.

### First action

Inspect the actual repository and report its current state, baseline results, keep/simplify/remove decisions, and provider/security uncertainties. Create the first small OpenSpec change and its acceptance-test plan before modifying product behavior. Implement incrementally using the loop above; do not generate the entire application in one unreviewable change.

## Reference starting points

These are official documentation starting points, verified while preparing this brief on 2026-09-21. Recheck compatibility, capabilities, pricing, and stable versions when implementing.

- OpenSpec project and workflow: `https://github.com/Fission-AI/OpenSpec`
- OpenSpec commands: `https://github.com/Fission-AI/OpenSpec/blob/main/docs/commands.md`
- OpenSpec CLI: `https://github.com/Fission-AI/OpenSpec/blob/main/docs/cli.md`
- OpenSpec project configuration: `https://github.com/Fission-AI/OpenSpec/blob/main/docs/customization.md`
- OWASP ASVS stable baseline: `https://github.com/OWASP/ASVS`
- Authentication guidance: `https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html`
- Session guidance: `https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html`
- Playwright testing practices: `https://playwright.dev/docs/best-practices`
- Authenticated ZAP automation: `https://www.zaproxy.org/docs/desktop/addons/automation-framework/authentication/`
- GitHub Actions security: `https://docs.github.com/en/actions/reference/security/secure-use`
- GitHub deployment feature availability: `https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments`
- TRON USDC discontinuation: `https://www.circle.com/blog/circle-is-discontinuing-support-for-usdc-on-the-tron-blockchain`
- Zcash transparent/shielded visibility: `https://z.cash/learn/what-is-the-difference-between-shielded-and-transparent-zcash/`
- CoinGecko historical-data limits: `https://docs.coingecko.com/demo/reference/coins-id-market-chart-range`
- Solana public RPC limitations: `https://solana.com/docs/references/clusters`
