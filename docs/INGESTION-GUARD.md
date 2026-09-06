# Collection safety

- Production news collection uses the `ingestion_guard` table (service_role only, RLS enabled).
- One collection owns a UUID lease through processing and Daily generation. Concurrent starts return HTTP 409 before any search.
- The lease lasts 10 minutes and renews when processing/Daily starts. Daily completion releases it. Crashes eventually expire; uncertain chain handoffs do not immediately unlock.
- Each processing hop and Daily dispatch is claimed once per run. Failed claimed hops are not automatically retried.
- Per discovery invocation: at most 6 outgoing search Responses requests and 2 formatting fallback requests. AsyncLocalStorage isolates concurrent request budgets.
- These are request limits, NOT a currency ceiling or a limit on provider-internal search tool calls. Each formatting request is separately capped at 12 seconds; cancellation does not guarantee the provider stops billing.
- Diagnostics, standalone article processing, company backfill and scheduled curation are not covered by this collection budget/lease. Daily's subsequent scheduled curation runs separately.
- Existing chains from pre-guard deployments lack a run ID and will be rejected; start a new run after deployment if needed.
- Tests: `node scripts/check-ingestion-guard.mjs`, `node scripts/check-json-recovery.mjs`, `node scripts/check-llm-search.mjs`, `npm run check`.
- No paid collection was executed during implementation. End-to-end live news validation is the next step.
