# SanchaarSetu

**Inter-departmental data propagation middleware for Karnataka government systems.**

SanchaarSetu (Sanskrit: _sanchaar_ = communication, _setu_ = bridge) sits between the central Single Window System (SWS) and 8 department IT systems. It detects data changes, transforms field schemas, resolves conflicts, and syncs records across all departments — with a full audit trail.

---

## The Problem

Karnataka's 40+ government departments each run separate legacy systems. When a business updates its registered address in the Labour department, the Tax department, Fire department, Municipal Corporation, and every other system still holds the old address. There is no central sync. SanchaarSetu is the middleware layer that fixes this.

---

## Architecture

```
Department System (DOL, CTD, BBMP, ...)
         │
         ▼
 Ingestion Engine ──── Tier 1: Webhook  (<1s)
                  ──── Tier 2: Polling  (1–15 min)
                  ──── Tier 3: Snapshot (nightly CDC)
         │
         ▼
   Kafka Queue  (at-least-once delivery, retry up to 5x → DLQ)
         │
         ▼
 Transform Engine  (AI field mapping via Sentence Transformers + pgvector)
         │
         ▼
 Conflict Detector (SWS-wins · Last-Write-Wins · Manual Review)
         │
         ▼
 Idempotent Write  (deduplication via UBID + event_type + timestamp key)
         │
         ▼
 Audit Store  (append-only, tamper-evident, CSV exportable)
```

---

## Department Systems

| Code | Department | Tier | Connection |
|------|-----------|------|------------|
| DFB | Directorate of Fire & Emergency Services | 1 | Webhook |
| SEA | Survey, Settlement & Land Records | 1 | Webhook |
| DOL | Department of Labour | 1 | Webhook |
| CTD | Commercial Taxes Department | 2 | Polling (5m) |
| BBMP | Bruhat Bengaluru Mahanagara Palike | 2 | Polling (10m) |
| KPCB | Karnataka Pollution Control Board | 2 | Polling (15m) |
| KFES | Karnataka Food & Civil Supplies | 3 | Snapshot |
| DIS | Department of Industries & Commerce | 3 | Snapshot |

---

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite
- **Styling:** Tailwind CSS
- **Icons:** Lucide React
- **Backend API:** FastAPI
- **Database:** PostgreSQL
- **Queue / Cache:** Kafka (Redpanda) + Redis

---

## Database Schema

| Table | Purpose |
|-------|---------|
| `departments` | 8 dept systems — status, tier, sync timestamps, record counts |
| `businesses` | Business registry, keyed by UBID |
| `propagation_events` | Append-only log of every sync attempt (never deleted) |
| `conflicts` | Field-level disagreements between SWS and dept systems |
| `schema_mappings` | AI-generated field name translations between schemas |
| `business_departments` | Which businesses are registered in which departments |

### Propagation Event Outcomes

| Outcome | Meaning |
|---------|---------|
| `success` | Written to destination successfully |
| `failure` | Destination unreachable, being retried |
| `conflict` | Field value mismatch — routed to Conflict Resolver |
| `duplicate` | Idempotency key already seen — correctly skipped |
| `pending` | In-flight, awaiting acknowledgement |
| `dlq` | 5 retries exhausted — Dead Letter Queue, needs manual intervention |

---

## Pages

### Dashboard
Live KPIs: total events, success rate, avg propagation latency, active conflicts, pending schema mappings, dept health. Shows last 12 events and a visual pipeline diagram.

### Live Event Feed
Full scrollable event table. Filter by outcome. Click any row to expand: conflict flag, resolution applied, retry count, idempotency key, payload hash, error message.

### Conflict Resolver
Operator queue for data disagreements. Three resolution policies:
- **SWS Wins** — SWS is authoritative, auto-resolvable
- **Last-Write Wins** — most recent timestamp wins
- **Manual Review** — human must decide (PAN, GSTIN, signatory fields)

Shows both conflicting values side by side. One-click batch resolution for SWS-wins conflicts.

### Schema Mappings
AI field translation registry. DOL calls it `emp_headcount`, SWS calls it `employee_count`. Sentence Transformers + pgvector cosine similarity produces a confidence score:
- ≥85% → auto-mapped
- 70–84% → pending human confirmation
- <70% → blocked

Operators can confirm, reject, re-review, or manually add mappings.

### Audit Trail
Immutable compliance log. No DELETE or UPDATE on this table. Every event permanently recorded. Filterable by outcome. Paginated (25/page). CSV export for regulatory compliance.

### Department Systems
Health management for all 8 dept systems. Change any department's status (Active / Degraded / Circuit Open / Offline) in real time. When circuit is open, Kafka holds events until recovery. Shows last sync time, records synced, connection type, poll interval.

---

## Simulator

The sidebar simulator generates realistic synthetic events into the live database:

- **Speed slider** — 0.5s to 5s between events
- **Start Simulation** — continuous event generation
- **Inject 8 Events** — burst of 8 events with 120ms gaps

Events are written directly through the FastAPI backend into PostgreSQL `propagation_events`. Conflicts also write to the `conflicts` table. The dashboard refreshes on every tick.

---

## Local Development

```bash
npm install
npm run dev
```

Requires a `.env` file with:

```
VITE_API_URL=http://localhost:8000
```

The frontend now talks to your FastAPI backend endpoints. The seed SQL is in `db/init.sql`.

---

## Key Design Decisions

**Idempotency keys** are `UBID:event_type:source:sequence` — guarantees exactly-once semantics at the destination even under Kafka's at-least-once delivery.

**Append-only audit log** — `propagation_events` has no DELETE RLS policy by design. Every retry, failure, and conflict is permanently visible.

**Conflict resolution policies are per-field** — address fields use `last_write_wins`, legal identifiers (PAN, GSTIN) always require `manual_review`, and SWS is authoritative for master data fields.

**Schema mappings are versioned** — any department schema change triggers re-validation of all mappings for that department before propagation resumes.

**Circuit breaker pattern** — when a department hits error thresholds, its status flips to `circuit_open`. Kafka queues events without dropping them. Normal operation resumes automatically when the department recovers.
