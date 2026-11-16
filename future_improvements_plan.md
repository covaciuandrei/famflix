# FamFlix future improvements plan

Created: October 28, 2026  
Status: Proposed roadmap; not implemented or a production-readiness certification.

## 1. Direction

Make FamFlix the easiest way for a household or group to decide what to watch, watch together, and keep the memories.

Keep the existing Next.js, TypeScript, and Supabase architecture unless measurements identify a reason to change it. Prioritize reliability, safe releases, data correctness, and repeat household use over adding infrastructure or features for their own sake.

This plan combines the application assessment with a proposed staging, database, and release strategy. It does not authorize deployments, paid services, database changes, or moving production data.

### Success measures

- Primary product metric: weekly groups logging a shared viewing with at least two participants, including guests where appropriate.
- Activation: time to first saved title, accepted invitation, and shared decision.
- Retention: first movie night to second movie night, plus week-1 and week-4 household retention.
- Reliability: successful core actions, latency, recovery capability, and unexpected errors.
- Efficiency: operating cost per weekly active household.

Time spent in the app is not necessarily success. Helping a group reach a satisfying decision faster is.

## 2. Current foundations and gaps

These observations describe the checked-in application, not independently verified production settings or test results.

### Preserve what already works

- Database-enforced membership and access boundaries, constraints, and SQL functions in [the database schema](supabase/db_init.sql).
- Server-only Supabase access and a restricted service-role escape hatch.
- Shared, database-backed [rate limits](src/lib/rate-limit.ts).
- [CI checks](.github/workflows/azure-static-web-apps.yml) for lint, types, unit tests, database tests, and browser tests before deployment.
- Throwaway test databases and populated database upgrade tests.
- Guest voting and guest-history linking, personal and family lists, planned nights, and in-app reminders.
- Account export/deletion, privacy controls, and existing text-based stats sharing.
- Visibility-aware polling, lightweight room responses, and per-instance TMDB caching.

### Address these gaps

| Area | Current observation | Desired outcome |
| --- | --- | --- |
| Runtime | [Application configuration](package.json) targets Node 22, with a local/CI patch pin in [.nvmrc](.nvmrc). A production runtime change still requires deployment verification. | Keep development, CI, build, and hosting on verified, supported Node 22 releases. |
| Hosting | [Infrastructure](infra/main.bicep) selects SWA Free; Microsoft documents hybrid Next.js hosting as preview. | An explicit framework-support, capacity, availability, and hosting decision. |
| Releases | The workflow deploys pushes to `main` after tests; it does not define a staging-to-production promotion gate. | An approved, traceable release flow through isolated staging. |
| Database changes | SQL deployment is [separate from application deployment](docs/DEPLOYMENT-GUIDE.md). | Versioned migrations, tracked application state, upgrade verification, and controlled execution. |
| Visibility | Console logging exists, but no integrated application telemetry or product analytics was found. | Actionable errors, metrics, alerts, and privacy-appropriate product measurement. |
| Larger datasets | [List and library queries](src/lib/data.ts) are unpaged; [stats reads](src/lib/stats-data.ts) have a 20,000-row cap. | Complete results with bounded queries, explicit limits, and representative tests. |
| External dependency load | [TMDB response caching](src/lib/tmdb.ts) is process-local. | Measured upstream usage and an appropriate multi-instance caching strategy when needed. |
| Recovery | Actual production backup configuration and restore capability were not checked. | Documented recovery targets and a successful isolated restore rehearsal. |

## 3. Priorities and dependencies

| Priority | Meaning | Work |
| --- | --- | --- |
| P0 | Foundation before a broad public rollout | Supported runtime/hosting decision, staging isolation, migration discipline, controlled production releases, monitoring, recovery, configuration validation, and privacy review. |
| P1 | Correctness and repeat use | Complete list/history reads, performance baselines, analytics, onboarding improvements, and one validated retention experiment. |
| P2 | Growth-driven capacity | Shared caching, adaptive polling or realtime, durable bulk work, and database optimization justified by measurements. |
| P3 | Expansion | Wider acquisition, advanced recommendations, monetization, and additional platforms after evidence of demand. |

Important dependencies:

- Hosting/runtime compatibility must be established before finalizing environment provisioning and deployment mechanics.
- Staging and migration tracking must exist before relying on staged database releases.
- Schema compatibility and recovery must be verified before approving production migrations.
- Analytics requires the privacy changes in section 8 before production collection.
- External reminders require durable delivery, preferences, and the relevant privacy updates.
- Bulk imports depend on complete paginated reads, deduplication, and safe background processing.
- Charging customers depends on commercial data licensing and appropriate legal terms.

Before starting each workstream, assign an owner, a measurable outcome, a cost budget, and a rollback or recovery approach. The phases below are an ordering guide, not delivery-date promises.

## 4. Environment strategy

Use short-lived feature branches, pull requests, and a protected integration branch. A separate long-lived branch for every environment is not required: environments should track tested commits, not diverging copies of the application.

### Target environments

| Environment | Application | Database and data | Deployment policy |
| --- | --- | --- | --- |
| Local development | Developer's Next.js server | Local Supabase and synthetic fixtures | Developer controlled. |
| CI tests | Temporary test build | Throwaway Postgres/Supabase databases | Every eligible PR and integration change; never production data. |
| PR preview, optional | Short-lived application preview | Isolated disposable data or a provider-supported database branch | Trusted changes only; remove resources and credentials after closure. |
| Staging | Persistent, production-like application | Dedicated Supabase project with realistic synthetic data | Deploy approved integration commits automatically after checks. |
| Production | Public application | Dedicated production Supabase project | Promote an approved, successfully staged commit through a controlled release gate. |

Start with persistent staging. Add per-PR databases only if their value justifies the provider support, cost, provisioning, and cleanup complexity.

### Isolation requirements

- [ ] Use separate environment secrets, deployment credentials, database URLs, and service-role keys.
- [ ] Define GitHub `staging` and `production` environments and restrict who can release.
- [ ] Never expose production deployment, database, or service-role credentials to untrusted PR execution.
- [ ] Keep privileged database keys server-only and out of logs, browser bundles, artifacts, and source maps.
- [ ] Configure environment-specific Supabase site URLs and explicit OAuth callback allowlists.
- [ ] Prefer separate Google OAuth clients for staging and production where practical; do not enable unrestricted preview callback wildcards.
- [ ] Prevent session, guest-token, and invitation reuse across environments.
- [ ] Gate staging access as appropriate and prevent staging/preview search indexing.
- [ ] Use synthetic data by default. Any production-data copy requires explicit approval and a verified anonymization process.
- [ ] Disable external notifications in previews; restrict staging deliveries to approved test recipients.
- [ ] Namespace or isolate queues, scheduled jobs, caches, feature flags, and telemetry by environment.
- [ ] Exclude staging, previews, and synthetic production checks from customer growth metrics.
- [ ] Apply resource budgets, expiration policies, and cleanup checks to temporary environments.

### Infrastructure and configuration

- [ ] Parameterize resource names, environment names, domains, tags, regions, and hosting tiers instead of reusing hard-coded production identifiers.
- [ ] Keep reproducible infrastructure in code and record any provider settings that still require a managed configuration checklist.
- [ ] Keep secret values outside infrastructure parameter files; prefer short-lived deployment identities where the chosen deployment tooling supports them.
- [ ] Validate required production configuration explicitly. Missing credentials must not quietly leave critical protections disabled.
- [ ] Inventory configuration needed to recreate the app: DNS, TLS, OAuth, Supabase settings, runtime variables, jobs, monitoring, and notification providers.

## 5. Release and deployment workflow

### Desired release path

```text
Feature branch / pull request
  -> lint, types, unit, database, browser, and build checks
  -> isolated PR preview when useful
  -> merge tested commit into protected main
  -> apply compatible staging migrations and deploy staging
  -> staging smoke tests, upgrade checks, and acceptance
  -> approve a specific staged commit for production
  -> apply compatible production migrations and deploy
  -> production smoke checks and release observation
  -> continue, disable a feature, roll back the app, or invoke recovery
```

### Pull request gate

- [ ] Retain the existing functional and database checks, including access-control and populated upgrade coverage.
- [ ] Require passing checks and an appropriate review before merging.
- [ ] Verify a production-capable build, not only a development server.
- [ ] Review schema compatibility, configuration additions, data handling, and release notes with each relevant change.
- [ ] Add dependency-update and secret-scanning automation with actionable results, without treating automated scans as a security certification.
- [ ] Require focused accessibility, performance, or failure-path checks when the change affects those behaviors.

### Staging deployment

- [ ] Deploy the exact integration commit and record its SHA, build identifier, configuration version, and migration versions.
- [ ] Apply migrations using one controlled runner, with concurrency protection.
- [ ] Use backward-compatible schema expansion before deploying dependent application code.
- [ ] Run smoke tests for authentication, lists, guest participation, voting, watched logging, and database compatibility.
- [ ] Exercise export/deletion and privacy boundaries with disposable accounts for relevant changes.
- [ ] Verify real Google sign-in with an approved test account when authentication changes; never introduce a production authentication bypass for testing.
- [ ] Test rollback compatibility while the previous application version can still run against the expanded schema.
- [ ] Keep staging sufficiently similar to production to make results meaningful, while documenting deliberate size or feature differences.

### Production promotion

- [ ] Select a commit that successfully passed staging; do not deploy an unverified moving branch tip.
- [ ] Use a restricted approval gate, such as protected GitHub environments where available. Confirm that repository-plan capabilities support the intended controls.
- [ ] Serialize production releases and database migrations so overlapping releases cannot race.
- [ ] Confirm backup/recovery readiness and migration compatibility before schema changes.
- [ ] Deploy a versioned artifact where supported and retain the previous known-good artifact.
- [ ] Use health-based traffic switching or deployment slots only if the selected host supports them; verify behavior rather than assuming zero downtime.
- [ ] Run bounded post-deployment checks with dedicated synthetic accounts and a test household, not real customer data.
- [ ] Record the release, migration versions, operator, approval, smoke-test result, and rollback reference.
- [ ] Observe core-action failures, latency, and resource usage during a defined release window.
- [ ] Use staged feature enablement and environment-scoped kill switches for risky discovery, import, or notification changes.

### Next.js build-time configuration constraint

Prefer immutable artifacts and traceable promotion, but do not assume one browser bundle can be moved unchanged between different Supabase projects.

Next.js inlines `NEXT_PUBLIC_*` values during the build. With the current configuration approach, staging and production may need separate builds from the same approved commit and lockfile. Record and verify each build's environment configuration. Reusing an identical artifact requires a deliberately supported runtime-configuration design first.

Do not run PR or staging test suites against production just because an artifact contains production configuration. Read the version-bundled Next.js documentation before implementing framework-specific changes.

### Rollback policy

- Application rollback and database rollback are separate operations.
- Prefer rolling back the application while retaining compatible additive database changes.
- Do not automatically reverse destructive migrations or assume that a reverse SQL script can restore lost data.
- Document when to disable a feature, stop a worker, roll back an artifact, apply a forward fix, or invoke database recovery.
- Define rollback triggers and ownership before a risky release, not during the incident.

## 6. Database migrations, data lifecycle, and recovery

### Establish one migration authority

- [ ] Introduce a versioned migration chain and migration history using the selected database deployment tooling.
- [ ] Inventory the actual production schema and already-applied upgrades before creating the baseline.
- [ ] Only mark a baseline or migration applied after verifying the corresponding schema and data state.
- [ ] Do not run [the empty-database initializer](supabase/db_init.sql) against an existing production database.
- [ ] Make migrations the source of truth. Any retained bootstrap snapshot must be generated from or checked against that chain, not maintained as an independent competing schema.
- [ ] Adapt CI to test the full migration chain and upgrades from supported prior releases.
- [ ] Preserve the current tests for both Supabase privilege-default regimes and explicit grants.
- [ ] Detect schema drift and reconcile emergency SQL changes into reviewed migrations.
- [ ] Restrict migration credentials to the controlled runner; normal application code must not need schema-management permissions.

### Safe schema and data changes

- [ ] Use expand-and-contract changes: add compatible structures, deploy/backfill, switch readers and writers, then remove old structures in a later approved release.
- [ ] Verify RLS, function privileges, constraints, and indexes for every new database surface.
- [ ] Test clean installation and populated upgrades, including duplicated data, revoked access, deleted accounts, guests, and existing watch history.
- [ ] Define lock/statement timeouts and assess table-locking impact before large changes.
- [ ] Handle nontransactional operations explicitly; do not assume every migration can run inside one transaction.
- [ ] Use resumable, observable, idempotent jobs for large backfills instead of holding a deployment open indefinitely.
- [ ] Test compatibility with both the new and previous application versions during the release window.
- [ ] Keep synthetic seed data reproducible and clearly separate from migration logic.

### Recovery requirements

- [ ] Verify the actual Supabase plan, backup retention, restore process, and point-in-time recovery entitlement.
- [ ] Define recovery point objective: acceptable data loss.
- [ ] Define recovery time objective: acceptable time to restore service.
- [ ] Select backup/PITR arrangements that meet those objectives and the approved budget.
- [ ] Consider protected off-site backup copies where appropriate; verify coverage rather than assuming a database backup contains every external service setting or stored object.
- [ ] Perform an isolated restore rehearsal and verify account relationships, histories, permissions, exports, deletion behavior, and application compatibility.
- [ ] Record measured recovery time and any manual configuration needed after restore.
- [ ] Define how deletion requests are handled if recovery restores previously deleted personal data.
- [ ] Repeat recovery rehearsals after major database changes and on a scheduled cadence.

PITR is a recovery mechanism, not a routine deployment rollback: it can undo legitimate writes and require downtime.

### Retention and cleanup

- [ ] Document retention for temporary counters, expired links, abandoned jobs, logs, analytics, and backups.
- [ ] Use scheduled, monitored cleanup for temporary data where needed; do not depend solely on the same user returning.
- [ ] Preserve intentional watch history unless an approved product/privacy policy says otherwise.
- [ ] Test cleanup against valid invitations, guest claims, active nights, and account deletion obligations.

## 7. Monitoring, reliability, and quality

### Initial observability stack

| Layer | Initial recommendation | Scope |
| --- | --- | --- |
| Errors and selected performance traces | Sentry | Browser errors, server failures, Server Actions, route handlers, release impact. |
| External availability | One service such as Better Stack or UptimeRobot | Independent availability checks and alert delivery. |
| Infrastructure | Azure and Supabase metrics | CPU, connections, storage, slow queries, quotas, and platform incidents. |
| Structured application logs | Existing hosting log destination with a consistent schema | Request/action IDs, environment, release, duration, and normalized errors. |
| User experience | Field Web Vitals and focused browser checks | Real mobile loading, responsiveness, layout stability, and accessibility. |

Do not start with several overlapping tracing/error SDKs. Consider broader OpenTelemetry instrumentation when cross-service diagnostics justify it.

### Instrument the user outcome

- [ ] Measure adding a title, submitting a vote, logging a viewing, joining a group/night, and loading saved lists.
- [ ] Count unexpected Server Action failures even when the HTTP response is successful.
- [ ] Separate expected validation, expired links, and normal rate limits from genuine application faults.
- [ ] Surface database failures explicitly rather than making an unavailable dataset look empty.
- [ ] Track TMDB timeouts, rate-limit responses, request volume, and cache effectiveness.
- [ ] Upload source maps privately, associate telemetry with releases, and test that a staging error reaches its intended owner.
- [ ] Redact tokens, guest URLs, credentials, emails, names, notes, and unnecessary watch-preference data.
- [ ] Keep metric labels low-cardinality; do not create a metric series for every user or household.
- [ ] Set sampling, retention, access controls, and telemetry spending limits.

### Health checks and alerts

- [ ] Distinguish basic liveness from bounded readiness checks.
- [ ] Do not make a TMDB outage automatically mean the saved-watchlist application is dead.
- [ ] Keep public health responses minimal; protect detailed diagnostics and avoid creating an expensive public query endpoint.
- [ ] Alert on sustained core-action failures, significant latency regressions, database capacity, failed jobs, missing backups, and spending anomalies.
- [ ] Route alerts to a named owner and test the delivery path.
- [ ] Add an independent status page when the operational need justifies it.

Proposed starting objectives, subject to baseline measurement and hosting choice:

- 99.9% successful valid core list/vote/watch operations over a month.
- p95 below one second for saved-list and lightweight room-state responses under the agreed workload.
- Mobile p75 Web Vitals in the "good" range: LCP at most 2.5 seconds, INP at most 200 ms, and CLS at most 0.1.

These are targets to validate and refine, not claims about current performance or contractual guarantees.

### Quality beyond happy paths

- [ ] Exercise provider timeouts, unavailable databases, interrupted voting, retries, expired sessions, and partial failures.
- [ ] Preserve keyboard access, dialog focus, screen-reader labels, reduced-motion behavior, contrast, and usable touch targets.
- [ ] Cover representative mobile browsers and devices, not only a fast desktop.
- [ ] Keep tests focused and deterministic; use controlled upstream failures rather than relying on a real provider to fail.

## 8. Product analytics and privacy

The current [privacy policy](src/app/privacy/page.tsx) says FamFlix does not use analytics or tracking cookies. It also describes in-app-only reminders. Analytics and external notifications are intentional changes to that promise.

### Before enabling collection

- [ ] Choose a tool and region, with PostHog as an initial option rather than a mandatory dependency.
- [ ] Review lawful basis/consent requirements, provider agreements, data residency, retention, access, and deletion handling.
- [ ] Update user-facing privacy information before enabling production collection.
- [ ] Disable broad autocapture and session replay initially, especially around guest links and private forms.
- [ ] Prevent full URLs, guest tokens, emails, notes, ratings, and raw viewing histories from entering analytics by default.
- [ ] Remember that pseudonymous user/group IDs are not necessarily anonymous data.
- [ ] Separate environment datasets or clearly exclude noncustomer traffic.
- [ ] Ensure a telemetry outage cannot break a successful watchlist action.

### Minimal event contract

Start with successful outcomes:

```text
signup_completed
title_added
family_created
invite_shared
member_joined
movie_night_started
movie_night_completed
shared_watch_logged
```

Add guest participation, account conversion, reminder delivery, or imports only when needed to answer a defined product question.

- [ ] Define event names, versions, minimal properties, environment, timestamp, and deduplication identifiers.
- [ ] Prefer authoritative server outcomes for important writes instead of counting button clicks.
- [ ] Keep essential collection privacy-appropriate and avoid unnecessary payload detail.
- [ ] Support applicable export/deletion requests across added providers.
- [ ] Build activation and household-cohort dashboards before experimenting with acquisition.
- [ ] Track time to first value, invite acceptance, guest conversion, second-night conversion, and week-1/week-4 retention.
- [ ] Track cost per weekly active household alongside product metrics.

## 9. Scalability and resilience

### Complete and efficient data reads

- [ ] Add bounded pagination to list and library-index loading without silently losing rows at API limits.
- [ ] Move filtering/sorting to the database where pagination requires it; keep counts and filters correct across the entire dataset, not just the loaded page.
- [ ] Use stable cursor ordering and tie-breakers.
- [ ] Fetch only needed fields and defer expensive detail/history loads.
- [ ] Replace silent hard caps with complete aggregation/pagination or a clearly communicated product limit.
- [ ] Test lists with at least 1,001 entries and histories beyond the current 20,000-row reader cap.
- [ ] Use measured SQL plans and RLS-aware tests to choose composite/partial indexes.
- [ ] Move expensive stats aggregation closer to the database when profiling supports it.
- [ ] Preserve personal/family visibility boundaries in aggregates and caches.

### TMDB and caching

- [ ] Measure per-instance hit rate, duplicate cross-instance calls, upstream latency, and total request volume.
- [ ] Preserve existing bounded caching and request deduplication.
- [ ] Reuse durable public metadata where suitable and add a shared response cache when multiple instances or measured costs justify it.
- [ ] Never put user-specific lists, private notes, votes, or guest state into an unscoped shared cache.
- [ ] Consider stale public metadata during temporary upstream failures.
- [ ] Respect upstream limits and retry guidance; use bounded retries, jitter, and controlled concurrency to avoid retry storms.
- [ ] Add an upstream-wide budget/circuit breaker when warranted, rather than relying only on per-user limits.
- [ ] Alert on rate-limit-counter failures and explicitly decide fail-open/fail-closed behavior by risk.

### Movie-night concurrency

Rooms currently poll every six seconds while visible. A scenario with 1,000 visible room clients implies roughly 167 state requests per second, before navigation checks, voting, and authentication overhead. This is a workload example, not a verified capacity claim.

- [ ] Profile room-state RPCs, authentication calls, response sizes, and aggregate database work.
- [ ] Run staged concurrency tests and identify the first limiting resource.
- [ ] Add backoff/jitter and tune polling when it improves measured cost or experience.
- [ ] Introduce authorized realtime channels only if polling becomes a demonstrated bottleneck.
- [ ] Preserve room/group isolation, guest restrictions, vote privacy, reconnection behavior, and result ordering in any realtime design.

### Durable jobs

For external reminders, imports, large exports, and backfills:

- [ ] Use a durable queue/scheduler and an outbox where work must follow a committed database change.
- [ ] Make jobs idempotent, retryable, observable, cancelable where appropriate, and safe across deployments.
- [ ] Provide bounded retries, failure visibility, and a controlled reprocessing path.
- [ ] Namespace jobs by environment and prevent staging from delivering production notifications.
- [ ] Respect notification preferences, opt-outs, time zones, daylight-saving changes, and canceled plans.
- [ ] Validate any temporary download-link access, expiration, and revocation requirements.

### Capacity testing and cost control

- [ ] Define concurrent households, room viewers, list sizes, voting bursts, and import volumes rather than guessing from registered-user counts.
- [ ] Use isolated data and controlled upstream responses for large load tests; do not flood production or TMDB.
- [ ] Record p50/p95/p99 latency, error rate, database usage, cache hit rate, upstream calls, and cost for each workload.
- [ ] Establish a tested capacity envelope and repeat relevant tests before meaningful traffic increases.
- [ ] Maintain budgets for production, staging, previews, telemetry, database growth, and background processing.
- [ ] Review direct database connection/pooling needs if future workers add direct Postgres connections; do not assume the current HTTP Supabase client requires a new application-side pool.

## 10. Product and growth experiments

Treat these as hypotheses. Choose one meaningful experiment at a time and define the expected outcome before implementation.

| Opportunity | Starting point | Proposed improvement | Measure |
| --- | --- | --- | --- |
| Streaming availability | Discovery and title details exist. | Country/subscription-aware "where can we watch this?" information, respecting provider licenses and attribution. | Time to a playable shared pick and completed nights. |
| Faster first value | A seven-area [welcome tour](src/components/welcome-tour.tsx) exists. | Guide one useful action first; keep the fuller tour available as help. | First saved title, first invitation, first shared decision. |
| Returning for planned nights | Plans, RSVPs, and in-app reminders exist. | Opt-in calendar, email, or push reminders with durable delivery. | Reminder-to-return and planned-to-completed night conversion. |
| Guest acquisition loop | Guest voting and account linking exist. | Improve invitations and invite guests to keep their group/history after experiencing value. | Invite acceptance, guest conversion, and subsequent household retention. |
| History imports | Data export exists. | Supported CSV/API imports with mapping, deduplication, preview, progress, and correction paths. | Import completion and retained active households. |
| Shareable recaps | Text stats sharing exists. | Opt-in visual family/year recap cards without exposing private identities or history by default. | Consented sharing and activated referrals. |
| Better group recommendations | Moods, suggestions, and voting exist. | Combine availability, existing preferences, and useful explanations for a short set of compromise picks. | Faster decisions and better post-watch feedback. |

### Validate the audience before broad acquisition

- [ ] Start with 20-50 real households/groups that already try to have a weekly movie night.
- [ ] Observe onboarding and understand why a first night does or does not become a second.
- [ ] Offer an accessible feedback/support route; do not confuse the existing family-rating UI with a product-support channel.
- [ ] Improve the largest activation or retention drop-off before buying traffic.
- [ ] Test focused communities, referrals, and useful public marketing pages without exposing private family or guest content to search engines.
- [ ] Expand only after multiple cohorts demonstrate repeat use.

### Monetization

- [ ] Validate willingness to pay before adding a billing system.
- [ ] Consider an optional household plan rather than per-invited-person pricing.
- [ ] Keep core invitations and guest voting frictionless; they are part of acquisition.
- [ ] Resolve TMDB and any streaming-availability commercial licensing before charging.
- [ ] Define entitlements, cancellations, refunds, webhook idempotency, and subscription recovery before introducing payments.
- [ ] Avoid making private family behavior an advertising product.

## 11. Operations, trust, and maintenance

- [ ] Define support ownership, incident severity, response expectations, and a communication channel.
- [ ] Write short runbooks for failed deployments, application rollback, database restore, authentication outages, TMDB outages, runaway spending, and credential rotation.
- [ ] Create only the administrative tools actually needed: least-privilege access, audited sensitive actions, and no routine browsing of private notes.
- [ ] Preserve existing database protections and add independent security review before a broad public rollout or major trust-boundary change.
- [ ] Evaluate edge-level abuse protection and upstream-wide budgets alongside existing per-user database limits.
- [ ] Protect operator accounts with appropriate MFA/access controls and document key rotation.
- [ ] Automate dependency-update proposals and test them through staging, including runtime/Next.js deprecations.
- [ ] Extend export, deletion, retention, and privacy documentation whenever new data stores/providers are added.
- [ ] Review the age/guardian-consent model and relevant privacy obligations before broadly targeting families with children.
- [ ] Review commercial data agreements, attribution, product terms, and branding before monetization or major marketing investment.

## 12. Suggested delivery phases

### Phase A: Safe foundation, approximately the first 30 days

1. Decide and verify the supported runtime and hosting path.
2. Provision isolated persistent staging and separate environment configuration.
3. Baseline the actual production schema and introduce tracked migrations.
4. Add staging deployment, protected production promotion, and release metadata.
5. Add application error reporting, independent uptime checks, and essential alerts.
6. Verify backups, choose recovery objectives, and complete an isolated restore exercise.
7. Establish the privacy-approved minimal analytics funnel.

Exit gate: a representative application and additive schema change can pass through staging to production, be observed, and have a rehearsed rollback/recovery path.

### Phase B: Correctness and measured capacity, approximately days 31-60

1. Fix unpaged reads and silent history caps, preserving complete filters and stats.
2. Establish realistic load/failure baselines and address the measured bottlenecks.
3. Improve error states, query payloads, and real mobile experience.
4. Recruit the initial household cohort and measure activation and second-night conversion.
5. Improve the largest observed onboarding drop-off.

Exit gate: large-list/history behavior is verified, an initial capacity envelope is recorded, and real household retention can be measured.

### Phase C: Retention-led growth, approximately days 61-90

1. Choose one high-value experiment, likely streaming availability or external reminders.
2. Add durable jobs if the selected experiment needs them.
3. Optimize the existing guest/invitation loop and test privacy-safe recap sharing.
4. Expand acquisition cautiously while watching reliability, retention, support load, and cost.
5. Explore paid household demand only after licensing and legal prerequisites are clear.

Exit gate: the selected experiment has a measured result and repeat household use supports the next acquisition investment.

### Later, only when justified

Shared caching, realtime, larger database capacity, read replicas, regional expansion, or service extraction should follow measured constraints. A native application, public social network, microservices, Kubernetes, vector database, or broad AI feature set is not a prerequisite for the next stage.

## 13. Production release checklist

- [ ] The approved commit passed CI and staging acceptance.
- [ ] The exact application build and environment configuration are recorded.
- [ ] Database migration state is known, compatible, and protected against concurrent execution.
- [ ] Required secrets, OAuth callbacks, domains, jobs, and provider settings are verified.
- [ ] Backups and the relevant recovery path are current and tested.
- [ ] A known-good application rollback artifact and clear rollback triggers exist.
- [ ] Privacy, licensing, and notification requirements for this change are satisfied.
- [ ] Appropriate reviewers/operators approved the release.
- [ ] Production smoke checks use isolated synthetic identities/data.
- [ ] Alerts, monitoring, support ownership, and a release observation window are in place.
- [ ] Temporary credentials/resources and test-created data have an explicit cleanup path.
- [ ] User-facing changes and operational release notes are recorded.

## 14. Decisions to resolve before implementation

| Decision | Needed input |
| --- | --- |
| Hosting/runtime | Supported Next.js features and Node versions, availability needs, deployment controls, and cost. |
| Environment design | Staging budget, Supabase project/branch support, preview value, and cleanup ownership. |
| Release controls | Repository protection capabilities, approvers, supported artifact promotion, and deployment concurrency. |
| Recovery | Acceptable data loss/downtime, backup retention, restore verification, and PITR budget. |
| Analytics | Product questions, privacy/consent approach, provider region, retention, and deletion support. |
| Capacity | Current traffic and realistic target concurrency/workload, not just a user-count ambition. |
| Product experiment | The largest observed activation/retention problem and a measurable improvement hypothesis. |
| Monetization | Evidence of willingness to pay, licensing, terms, and the intended household entitlement model. |

## References

Provider support, limits, and commercial terms change. Recheck these before implementation or purchasing services.

- [Application overview and architecture](README.md)
- [Current feature guide](docs/FEATURES.md)
- [Deployment guide](docs/DEPLOYMENT-GUIDE.md)
- [Current CI/CD workflow](.github/workflows/azure-static-web-apps.yml)
- [Database initialization and upgrade test runner](supabase/tests/run.sh)
- [Node.js release support status](https://nodejs.org/en/about/previous-releases)
- [Azure Static Web Apps Next.js support](https://learn.microsoft.com/en-us/azure/static-web-apps/nextjs)
- [Supabase backup and recovery documentation](https://supabase.com/docs/guides/platform/backups)
- [Next.js self-hosting and environment configuration](https://nextjs.org/docs/app/guides/self-hosting)
- [Web Vitals guidance](https://web.dev/articles/vitals)
- [TMDB API licensing and attribution FAQ](https://developer.themoviedb.org/docs/faq)
