# SanchaarSetu — PAN IIT Summit Pitch Pack (Speak + Demo + Q&A)

Audience: Domain mentors, Technical mentors, Government officials (IAS / pilot sponsors), Investor jury

## 0) 10-second positioning (memorize)
“SanchaarSetu is an AI-powered interoperability layer that keeps Karnataka’s Single Window System and 40+ department systems in sync—without changing legacy systems—using reliable event delivery, semantic schema mapping, conflict resolution, and a tamper-evident audit trail.”

## 1) 3–4 minute main speech (interactive + appealing)

### Opening (0:00–0:25)
Good morning. Quick question for the room:
If a business updates its registered address in one government portal today… how many other systems still keep the old address for weeks?

That “split-brain” data problem is the reason businesses submit the same corrections repeatedly, departments disagree on ground truth, and audits become painful.

### Problem (0:25–1:05)
Karnataka’s Single Window System is the central entry point, but each department still runs its own system and schema.
So a simple update—address, signatory, GSTIN—becomes:
- duplicate data entry,
- inconsistent compliance decisions,
- and high operational cost.

### Solution (1:05–2:15)
SanchaarSetu sits between SWS and department systems as a **non-invasive adapter**:
- Ingests change events (webhook / polling / CDC style feeds).
- Guarantees **at-least-once delivery** with **idempotency** so duplicates don’t corrupt state.
- Uses **AI semantic schema mapping** (SentenceTransformers + pgvector) to translate heterogeneous fields.
- Detects **conflicts** (simultaneous updates within a short window) and resolves via policy:
  - SWS-wins,
  - last-write-wins,
  - or manual review for high-stakes fields.
- Writes a **tamper-evident audit trail** using cryptographic hash chaining.

In short: “Update once. Propagate everywhere. Verify forever.”

### Why it matters (2:15–2:55)
For government:
- faster compliance processing,
- fewer disputes between departments,
- and defensible auditability.

For businesses:
- fewer repeated submissions,
- fewer delays,
- fewer contradictory notices.

### Interactive moment (2:55–3:20)
I’ll show a conflict live in 30 seconds and ask you to choose the policy.
If it’s a signatory name mismatch, should we:
A) SWS-wins (authoritative),
B) last-write-wins (freshest),
C) manual review (high-stakes)?

(You’ll pick, and I’ll apply it in the UI.)

### Close (3:20–3:50)
SanchaarSetu is designed to be deployable as a state-level platform: stateless processors backed by Kafka, Redis, and Postgres, so scaling is horizontal and onboarding new departments is accelerated by AI mapping.

## 2) 2–3 minute live demo script (step-by-step)

Goal: show “end-to-end” in a way that’s easy for non-technical judges.

### Setup (5 seconds)
Open the UI: `http://localhost:5173`

### Step 1 — Dashboard KPIs (20 seconds)
- Say: “This is the operator view—success rate, conflicts, pending mappings, latency.”
- Point to: Total events, Success rate, Active conflicts, Pending mappings.

### Step 2 — Inject events (20 seconds)
- Use the left-sidebar Simulator button: “Inject 8 Events”.
- Say: “We generate realistic propagation events across departments.”

### Step 3 — Event Feed: reliability + outcomes (20–30 seconds)
- Open “Live Event Feed”.
- Call out outcomes: `success`, `failure`, `duplicate`, `pending`, `conflict`.
- Say: “Failures retry with backoff; duplicates are safely deduped via idempotency.”

### Step 4 — Schema Mappings: AI translation (30–40 seconds)
- Open Schema Mappings.
- Point to confidence bars.
- Say:
  - “≥85% auto-mapped.”
  - “70–84% needs confirmation.”
  - “Below that is blocked / requires review.”
- Confirm or reject one mapping.

### Step 5 — Conflict Resolver: policy decision (40–60 seconds)
- Open Conflict Resolver.
- Show a conflict row (e.g., signatory / PAN / address).
- Ask audience: “SWS-wins, last-write-wins, or manual?”
- Apply resolution and show status changes.

### Step 6 — Audit Trail: tamper-evident compliance (20–30 seconds)
- Open Audit Trail.
- Say: “Every event is append-only and hash-chained. If someone tampers with history, the chain breaks.”

### Finish (5 seconds)
“One update, translated reliably, conflict-resolved, and audited in a tamper-evident way.”

## 3) Feature map (explainable to all judges)

### Reliability & operations
- **Idempotency (Redis SETNX)**: prevents duplicate processing under at-least-once delivery.
- **Queueing (Kafka/Redpanda)**: durable pipeline; supports retries and DLQ.
- **Exponential backoff + DLQ**: failures don’t stall the system; no silent loss.

### Intelligence (AI mapping)
- **Semantic schema mapping**: learns mappings from field meaning, not brittle hardcoding.
- **pgvector cache**: once a mapping is learned/approved, it’s reused.
- **Human-in-the-loop**: low confidence routes to operator confirmation.

### Data integrity
- **Conflict detection**: flags simultaneous updates on same UBID.
- **Policy-based resolution**: SWS-wins / LWW / manual review.
- **Tamper-evident audit log**: hash-chaining across audit entries.

### Government readiness
- **Non-invasive adapter pattern**: no code changes inside legacy departments.
- **Tiered ingestion strategy**: webhook for modern systems; polling/snapshot patterns for older ones.

## 4) Persona-specific angle (what each judge cares about)

### Domain mentors (sector experts)
- “This reduces duplication and compliance delays by making updates consistent across departments.”
- “Conflicts are handled explicitly—no silent overwrites.”
- “Manual review is reserved for high-stakes fields like GSTIN/PAN/signatory.”

### Technical mentors (AI/ML + systems)
- “AI is used where it’s strong: semantic matching of field names/meaning.”
- “We gate with confidence thresholds and keep a human-in-loop.”
- “The pipeline is event-driven: Kafka + Redis idempotency + stateless processors.”

### Government officials (feasibility + policy)
- “No rewrites of department systems.”
- “Auditability is built-in: tamper-evident logs support RTI, internal audits, and accountability.”
- “Deployment can start with 2–3 departments as a pilot and expand.”

### Investor jury (scale + moat)
- “Platform play: once integrated, every new department is cheaper due to reusable mapping + adapters.”
- “Clear expansion: more departments, more event volume, more workflows.”
- “Moat: reliability + governance-grade audit + human-in-loop mapping workflows.”

## 5) Probable questions (and crisp answers)

### A) Domain mentor questions
1) **How do you handle department-specific rules?**
- We keep business logic in department adapters/policies, while core transport + audit is shared. Policies (like conflict resolution) can be configured per department and per field.

2) **What about high-stakes fields (PAN/GSTIN/signatory)?**
- Those route to manual review by default (or stricter rules). The UI makes the decision explicit and auditable.

3) **How do you onboard a new department?**
- Choose the ingestion tier (webhook/polling/snapshot), connect an adapter, then mapping learns quickly using semantic similarity and operator confirmation.

### B) Technical mentor questions
1) **AI mapping accuracy: what prevents wrong mappings?**
- Confidence thresholds + human confirmation. We treat AI suggestions as “draft” until confirmed. Confirmed mappings are versioned and reusable.

2) **What happens when schemas change?**
- Mappings are versioned. New/changed fields re-enter the review queue so we don’t silently break transformations.

3) **How do you guarantee ordering and avoid duplicates?**
- Kafka provides ordered partitions (e.g., per UBID), and Redis provides idempotency keys so replays don’t duplicate writes.

4) **Security/PII?**
- Payloads are hashed in audit logs, and PII scrubbing is applied before storage/propagation where required. Access is controlled via RBAC in production setups.

### C) Government official questions
1) **Can this work without changing existing department systems?**
- Yes—SanchaarSetu is an adapter layer. Departments can integrate via webhook endpoints, scheduled polling, or CDC/snapshot patterns.

2) **How do we ensure accountability and prevent tampering?**
- Audit entries are append-only and hash-chained; tampering invalidates downstream hashes. This provides tamper-evidence.

3) **What’s the pilot plan?**
- Start with 2–3 departments (one Tier-1 webhook, one Tier-2 polling, one Tier-3 snapshot), validate conflict workflows, then scale horizontally.

### D) Investor jury questions
1) **What’s defensible here vs “just an ETL”?**
- Interop is not just transformation—it’s reliability, idempotency, conflict governance, auditability, and human-in-loop mapping workflows.

2) **How do you scale?**
- Stateless processors + Kafka partitioning + independent scaling of consumers. Postgres/Redis scale via standard patterns (read replicas, clustering).

3) **Where’s the ROI?**
- Reduced manual reconciliation, fewer compliance disputes, and faster approvals. For businesses: fewer repeat submissions and delays.

## 6) Backup plan if live demo fails (say this calmly)
- “Even if the UI glitches, the key proof is the event pipeline and the audit. The system is designed so every event is queued, deduped, policy-resolved, and hash-audited. I can demonstrate outcomes via the dashboard counters and the audit trail entries.”

## 7) One-liners you can use under pressure
- “Kafka gives reliability; Redis gives idempotency; Postgres gives audit; AI gives schema translation; policies give governance.”
- “We don’t overwrite conflicts—we surface them and decide explicitly.”
- “Legacy systems stay untouched; we add adapters, not rewrites.”

## 8) What NOT to claim (safe phrasing)
- If asked about Debezium/Temporal: say “supported by the architecture / pluggable,” unless you’ve deployed it.
- If asked about exact production latencies: say “in the demo environment we target near-real-time for webhook tiers; in production it depends on department connectivity and tier.”

---

## Appendix: Demo checklist
- `docker compose -p sanchaarsetu_demo2 up -d`
- UI: `http://localhost:5173`
- API: `http://localhost:8000`
- Have at least one conflict row ready to show.
