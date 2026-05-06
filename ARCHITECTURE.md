# SanchaarSetu Architecture & Design

## High-Level Design

SanchaarSetu is a bidirectional interoperability layer that keeps Karnataka's Single Window System (SWS) synchronized with 40+ department systems without modifying any existing systems.

```
         SWS                Department Systems
         ┌─────┐              ┌──────┐
         │ API │              │ Fac  │
         └──┬──┘              └──┬───┘
            │                    │
            │                    │
            ├──> [ SanchaarSetu ] <──┤
            │   ┌─────────────┐     │
            │   │  Webhook    │     │
            │   │  Transform  │     │
            │   │  Conflict   │     │
            │   │  Audit      │     │
            │   └─────────────┘     │
            │                        │
            └────────────┬───────────┘
                         │
                    ┌────▼─────┐
                    │  Kafka   │
                    │  Redis   │
                    │ Postgres │
                    └──────────┘
```

## Components

### 1. Webhook Listener (`/sws/webhook`)

**Purpose**: Accept SWS events in real-time

**Flow**:
1. FastAPI endpoint receives `POST /sws/webhook`
2. Extract UBID, event_type, payload
3. Generate idempotency key: `hash(UBID + event_type + time_window)`
4. Check Redis: if key exists → duplicate → return 409
5. If new: atomically set key in Redis
6. Produce event to Kafka topic
7. Write audit record to Postgres
8. Return 200 with idempotency_key

**Idempotency Strategy**:
```
Key = SHA256(UBID:event_type:timestamp_window)
     e.g., SHA256("UBID-001:address_update:16854392")

Redis SETNX: SET key "1" EX 3600 NX
- Succeeds on first write
- Fails if key already exists
- Expires after 1 hour
```

### 2. Kafka Message Queue

**Purpose**: Durable, ordered event propagation

**Topic**: `sanchaar-events`

**Message Format**:
```json
{
  "ubid": "UBID-001",
  "event_type": "address_update",
  "payload": {"address": "123 MG Road"},
  "idempotency_key": "abc123...",
  "timestamp": 1683979200.5,
  "source": "SWS",
  "dept": "factories"
}
```

**Guarantees & Resilience**:
- **At-least-once delivery**: Messages persisted to disk
- **Exponential Backoff**: Failed deliveries automatically retry without blocking the queue, utilizing increasing delays (2s, 4s, 8s, 16s).
- **Dead Letter Queue (DLQ)**: After 4 maximum retries, failed messages are gracefully routed to the `sanchaar-dlq` topic to ensure zero data loss while preventing queue stalling.
- **Ordered per UBID**: Partition by UBID hash

### 3. Transform Engine (`app/transform.py`)

**Purpose**: Automatically map fields between heterogeneous schemas

**Algorithm**:
1. For each source field (e.g., "registered_address")
2. Encode with SentenceTransformers: `embedding = model.encode(field)`
3. Compare against target schema fields using cosine similarity
4. Find best match: `argmax(similarity)`
5. If confidence > 0.75: store mapping, reuse forever
6. If confidence ≤ 0.75: hold in review queue
7. Store mapping in pgvector with version

**Example**:
```
Source field: "registered_address"
Target schema: ["address", "location", "place"]

Embeddings:
  registered_address  → [0.1, 0.2, ..., 0.9]
  address             → [0.1, 0.2, ..., 0.88]  ← best match
  location            → [0.3, 0.1, ..., 0.5]
  place               → [0.2, 0.2, ..., 0.4]

Result: registered_address → address (confidence: 0.88)
```

**Key Insights**:
- **No hardcoding**: Semantic similarity replaces brittle mappings
- **Learn once, reuse forever**: Caching in pgvector
- **Human-in-the-loop**: Low-confidence mappings require approval
- **Schema evolution**: Versioning tracks changes

### 4. Conflict Resolver (`app/conflicts.py`)

**Purpose**: Detect and resolve simultaneous updates

**Detection**:
- Monitor Kafka for updates with same UBID within 60-second window
- Flag any overlapping updates from different sources

**Resolution Policies**:

| Policy | Logic | Use Case |
|--------|-------|----------|
| **SWS-wins** | SWS payload applied, dept discarded | Default, SWS is authoritative |
| **Last-write-wins** | Later timestamp wins | Low-criticality fields (memo) |
| **Manual-review** | Both held; human decides | High-stakes (GSTIN, PAN, signatory) |

**Example Conflict**:
```
Time: 1000s → SWS updates signatory to "Alice"
Time: 1010s → Factories updates signatory to "Bob"
            → Conflict detected (delta = 10s < 60s)

Policy: SWS-wins → "Alice" applied, "Bob" logged
Audit: conflict_log(ubid, "SWS", "factories", "sws_wins", reason)
```

### 5. Change Detection & CDC (`app/detection.py`)

**Three-tier approach** for systems without webhooks:

| Tier | Method | Latency | Best For |
|------|--------|---------|----------|
| **1** | Webhook listener | <1s | Modern systems |
| **2** | Debezium (CDC) | <2s | Legacy DBs (Oracle/MySQL/Postgres) |
| **3** | API Polling / Diff | 15 min | Read-only legacy APIs |

**Tier 2 (Debezium Change Data Capture)**:
Instead of heavy database polling, SanchaarSetu utilizes **Debezium** to tail the Write-Ahead Logs (WAL) of legacy department databases. This allows real-time, non-invasive capturing of row-level changes (INSERT/UPDATE/DELETE) which are instantly streamed directly into the Kafka `sanchaar-events` topic.

**Tier 3 (Polling)**:
```python
async def poll_api(url, interval=60):
    while True:
        response = await client.get(url)
        current = response.json()
        # Compare with last state, emit deltas
        await asyncio.sleep(interval)
```



### 6. Audit Trail (`db/init.sql`)

**Immutable, append-only log** secured by **Cryptographic Hash-Chaining**.

**Schema**:
```sql
CREATE TABLE audit (
  id SERIAL PRIMARY KEY,
  ubid TEXT,                    -- Business identifier
  event_type TEXT,              -- address_update, signatory_update, etc.
  source_system TEXT,           -- SWS or department name
  destination_system TEXT,      -- Target system
  payload_hash TEXT,            -- SHA256 of payload (privacy)
  idempotency_key TEXT,         -- For dedup verification
  outcome TEXT,                 -- delivered/failed/error/conflict/dlq
  previous_hash TEXT,           -- Hash of the preceding log entry
  chained_hash TEXT,            -- Cryptographic hash of (previous_hash + current_data)
  created_at TIMESTAMP          -- UTC timestamp
);
```

**Example Records**:
```
id | ubid      | event_type        | source | dest    | outcome
1  | UBID-001  | address_update    | SWS    | factories| delivered
2  | UBID-001  | address_update    | SWS    | factories| duplicate
3  | UBID-002  | signatory_update  | factories | SWS   | delivered
```

**Guarantees**:
- **Tamper-Evident**: Because each `chained_hash` incorporates the `previous_hash`, secretly editing a past record instantly invalidates the entire subsequent chain (similar to a blockchain).
- No row can be deleted or updated (via database-level permissions).
- Complete, chronologically verifiable transaction history.

### 7. Mapping Registry (`mapping_registry` table)

**Stores learned field mappings** using pgvector

**Schema**:
```sql
CREATE TABLE mapping_registry (
  id SERIAL PRIMARY KEY,
  department TEXT,           -- e.g., "factories"
  source_field TEXT,         -- e.g., "registered_address"
  target_field TEXT,         -- e.g., "address"
  confidence FLOAT,          -- 0.0 - 1.0 similarity score
  version INTEGER,           -- Track schema evolution
  created_at TIMESTAMP
);
```

**Lifecycle**:
1. New department onboarded
2. Semantic matching discovers fields with confidence scores
3. Human reviewer approves/rejects ambiguous mappings
4. Approved mappings stored with version=1
5. Department updates schema → new fields get version=2
6. Version history enables rollback if needed

### 8. Workflow Orchestration (Temporal.io)

**Purpose**: Manage complex, multi-department update sagas and stateful retries.

While simple 1-to-1 propagations are handled natively by Kafka, SanchaarSetu integrates **Temporal.io** for complex sagas (e.g., a business address change that requires sequential approval from BBMP, then CTD, then Fire Safety). 

**Guarantees**:
- **Stateful Retries**: Temporal suspends the workflow indefinitely if a department system goes offline, automatically resuming execution months later if necessary without losing state.
- **Saga Pattern / Rollbacks**: If step 3 of a 5-department update fails, Temporal coordinates the compensating transactions to roll back the state in the first 2 departments, ensuring absolute global consistency.

## Data Flow: Address Change

```
┌─────────────────────────────────────────────────────────┐
│ 1. SWS sends webhook                                     │
│    POST /sws/webhook                                     │
│    {ubid: "U123", event_type: "addr_update", ...}       │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Check idempotency                                     │
│    idemp_key = hash("U123:addr_update:1683979200")      │
│    Redis: SET key "1" NX → success                       │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Produce to Kafka                                      │
│    Topic: sanchaar-events                               │
│    Msg: {ubid, event_type, payload, idemp_key, ...}    │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Write audit (queued)                                  │
│    INSERT audit (U123, addr_update, SWS, kafka, ...)   │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼ (consumer)
┌─────────────────────────────────────────────────────────┐
│ 5. Consume from Kafka                                    │
│    For each message, detect conflicts                    │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│ 6. Transform payload                                     │
│    {registered_address: "123 MG Rd"}                    │
│    → semantic match → {address: "123 MG Rd"}            │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│ 7. Deliver to department                                 │
│    POST /dept/factories/update                          │
│    {ubid: "U123", payload: {...}, idemp_key: ...}      │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼ (if success)
┌─────────────────────────────────────────────────────────┐
│ 8. Write audit (delivered)                               │
│    UPDATE audit SET outcome="delivered" ...             │
│    (Actually: INSERT new record for immutability)       │
└─────────────────────────────────────────────────────────┘
```

## Deployment Topology

### Local Development (SQLite)
```
FastAPI ← SQLite audit
         ↓
         In-memory queue
```

### Docker Compose (Full Stack)
```
FastAPI ← Redis (idempotency)
        ← Redpanda (Kafka)
        ← Postgres + pgvector (audit + mappings)
```

### Production (Cloud)
```
API Cluster (EKS/GKE)
    ├─ Kafka Cluster (AWS MSK / Confluent Cloud)
    ├─ Redis Cluster (ElastiCache / Redis Enterprise)
    ├─ Postgres (RDS / Cloud SQL)
    │   └─ pgvector extension
    └─ Monitoring (CloudWatch / DataDog)
```

## Performance Characteristics

### Latency
- **Webhook receipt to audit**: <100ms
- **Kafka message consume to delivery**: <500ms (typical)
- **Conflict detection**: <50ms (in-memory)
- **Transform (cached mapping)**: <10ms
- **Total SWS→Dept round-trip**: <1s (normal case)

### Throughput
- **Max webhooks/sec**: 10,000+ (limited by Kafka)
- **Concurrent transforms**: 1,000+ (model inference)
- **Concurrent deliveries**: 100+ (per department)

### Storage
- **Audit log growth**: ~1KB per event
- **Mappings**: ~100 bytes per field pair
- **Idempotency keys**: 64 bytes each, expire after 1 hour

## Security Considerations

1. **Role-Based Access Control (RBAC)**: Enforced via per-department API keys (`X-API-Key` headers) to guarantee strict cross-department data boundaries.
2. **Rate Limiting**: Redis-backed token buckets prevent malicious payload flooding and DDoS attempts per department.
3. **PII Scrubbing Engine**: A regex-based pre-processor explicitly intercepts and scrubs sensitive fields (PAN, Aadhaar, Phone, Email) replacing them with `[REDACTED]` flags *before* any text reaches the AI LLM inference.
4. **Cryptographic Audit Log**: Append-only log utilizing Hash-Chaining to prove 100% tamper-evidence and prevent internal state manipulation.
5. **Strict Schema Validation**: Pydantic-level schema validation instantly rejects unexpected or malformed payload fields from entering the mapping pipeline.
6. **Network & Encryption**: Configured for TLS 1.3 in transit and mTLS for trusted department endpoints.

## Known Limitations & Mitigations

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| Cannot modify SWS/depts | Integration only via APIs | Pure adapter pattern |
| Eventual consistency | Temporary divergence | Bounded delivery window, audit trail |
| Schema changes | Mapping breaks | Versioned registry + alerts |
| Kafka downtime | Propagation pauses | Multi-broker cluster, auto-recovery |
| UBID not assigned | Update stuck | Staging queue, retry when UBID arrives |
| AI mapping error | Wrong field mapped | Confidence threshold + human review |

## Future Enhancements

- **GraphQL API**: Flexible query layer over audit trail
- **ML-based conflict prediction**: Anticipate conflicts before they occur
- **Multi-region replication**: Geo-distributed audit redundancy
- **eBPF monitoring**: Kernel-level observability of state changes
