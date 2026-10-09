# AI Usage Disclosure (`AI_USAGE.md`)

This document discloses the use of AI tools during the development of the ANDX Web2 Assessment, the specific architectural areas where they were utilized, and the engineering decisions that were changed or rejected.

---

## 1. AI Tools Used
- **Google Antigravity AI Coding Assistant** (Gemini-based reasoning engine)
- **xAI Grok-4.7 API** (Hosted classifier model for clip relevance evaluation)

---

## 2. Areas Where AI Tools Were Applied
1. **Repository Architecture & Scaffolding:**
   - Monorepo directory layout (`packages/contracts`, `packages/domain`, `packages/db`, `packages/gateway`, `packages/aggregator`, `packages/earnings`, `packages/api`, `packages/classifier`).
   - TypeScript 5.6 configuration and Vitest testing infrastructure.
2. **Streaming Ingestion & Schema Validation:**
   - Drafting regex validation patterns for the 10 structural rules from Section 4.1.
   - Fastify NDJSON stream pipeline parsing and buffer throttling.
3. **Mathematical Implementation:**
   - BigInt arithmetic implementation for pro-rata campaign budget splitting and remainder cent distribution (Section 4.5).
4. **Test Suite Generation:**
   - Accelerating the creation of unit and integration test fixtures (88 automated test cases across 18 test suites).
5. **AI Classifier Security:**
   - Prompt engineering templates and regex filters for adversarial injection defense.

---

## 3. Decisions Changed or Rejected

| Area | Initial AI Proposal | Engineering Decision / Rejection | Why |
|---|---|---|---|
| **Broker Durability** | Default Kafka producer settings (`acks: 1`) | **Rejected.** Enforced `acks: -1` (`all`) durability with idempotent producers | Rule 5.2.7 requires guaranteed durability before the gateway returns HTTP 202. |
| **Top-Clips Pagination** | Standard SQL `OFFSET / LIMIT` pagination | **Rejected.** Replaced with opaque base64url Keyset Pagination `(views_gained DESC, clip_id ASC)` | SQL `OFFSET` degrades to O(N) page scanning. Keyset pagination executes in $O(\log N)$ sub-5ms latency. |
| **Negative Cache on Misses** | Cache campaign lookup misses in memory to reduce database queries | **Rejected.** Campaign lookup misses are **never cached** across batches | Late campaigns registered via `campaigns-late.json` must take effect immediately (Rule 6.2). Negative caching would cause false `unknown_campaign` rejections. |
| **Financial Arithmetic** | JavaScript `Number` (IEEE 754 float) division for pro-rata calculation | **Rejected.** Replaced entirely with 64-bit `BigInt` math | Floating point numbers introduce rounding inaccuracies that violate the exact integer remainder distribution rule (Section 4.5). |
| **Kafka Offset Management** | `autoCommit: false` with no explicit offset tracking | **Changed.** Implemented explicit batch offset resolution strictly after database transactions commit | Prevented consumer group rebalance stalls and ensured idempotency and zero message loss across container restarts. |
| **Late Event Deduplication** | Simple integer counter increment | **Changed.** Created `aggregator.late_events` table with primary key `event_id` | Ensured duplicate late events injected by the generator or replay harness are deduplicated exactly once per Section 4.3. |

---

## 4. Verification & Code Ownership

Every line of TypeScript, SQL migration, Docker configuration, and Makefile target has been manually inspected, tested, and validated against the official `andx-gen` test harness. The author can fully explain and defend every architectural decision, transaction boundary, and index choice in the follow-up technical review.
