# SanchaarSetu: Risks & Trade-Offs Analysis

This document outlines the architectural trade-offs made during the design of SanchaarSetu, explicit scalability limits, a comprehensive risk register, and strategies for disaster recovery.

## 1. Architectural Trade-Offs

### 1.1 Time-Windowed Idempotency vs. Full Deduplication
**The Decision**: Idempotency keys are generated using `hash(UBID + event_type + timestamp_window)`. Duplicate requests falling within the same time window (e.g., 60 seconds) are ignored.
* **Why we did it**: Full deduplication requires maintaining a global, permanent state of every event ever processed, which introduces massive storage bloat and lookup latency over time.
* **Trade-off**: A valid, intentional update of the same field within the 60-second window will be dropped as a duplicate. This assumes business events (like a company address change) do not happen in rapid sub-minute succession. 

### 1.2 The 60-Second Conflict Window
**The Decision**: Conflicts are evaluated by looking for diverging updates to the same `UBID` and `event_type` originating from different systems within a 60-second tumbling window.
* **Why we did it**: In an eventually consistent system without distributed locking, simultaneous updates create split-brain scenarios. A 60-second window is long enough to catch race conditions without delaying legitimate sequential workflows.
* **Trade-off**: If two departments update the same record 65 seconds apart, it is treated as two separate, sequential updates (last-write-wins) rather than a conflict requiring manual operator review.

### 1.3 Asynchronous Kafka Delivery vs. Synchronous API Calls
**The Decision**: SWS webhooks immediately return `202 Accepted` and offload the actual delivery to a Kafka producer/consumer loop.
* **Why we did it**: To prevent cascading failures. If 5 out of 40 department systems are down, a synchronous API would block and fail the entire SWS request. Asynchronous queues isolate failures and allow exponential backoff per department.
* **Trade-off**: The user interface in the source system cannot immediately tell the user if the update successfully reached all 40 departments. Status must be monitored via the SanchaarSetu dashboard.

### 1.4 LLM Semantic Mapping vs. Hardcoded Schemas
**The Decision**: We use `SentenceTransformers` to dynamically map field names (e.g., `factory_address` to `address`) with an 85% confidence threshold, falling back to manual review.
* **Why we did it**: With 40+ departments, maintaining rigid 1:1 schema mappings requires constant code changes every time a department alters its API.
* **Trade-off**: AI introduces non-determinism. An unexpected semantic match could corrupt data if the confidence threshold is met incorrectly. To mitigate this, PII is scrubbed before inference, and mappings are locked in after the first successful inference to ensure stability.

---

## 2. Scalability Limits & Cost Analysis

### 2.1 Scalability Constraints
* **10 Million UBIDs**: The current Postgres schema partitions by UBID hash, which scales well horizontally. However, the Redis instance used for the idempotency cache (time-windowed) will face memory pressure at very high throughputs. At 1,000 events/sec, Redis will store ~60,000 keys simultaneously (based on the 60s TTL).
* **Kafka Consumer Bottleneck**: A single consumer processing semantic mapping takes ~100-200ms per event. To handle state-wide scale, the Kafka topic must be heavily partitioned (e.g., 64 partitions) to allow concurrent consumer groups.

### 2.2 Cost Projections (Production)
* **Kafka (MSK or Confluent)**: ~$300-$500/month for a highly available, multi-AZ cluster.
* **PostgreSQL (Aurora/RDS)**: ~$200/month for a high-IOPS instance capable of handling the append-only audit trail.
* **AI Compute (SentenceTransformers)**: Because the model (`all-MiniLM-L6-v2`) runs locally within the Python process, there are no external API costs (e.g., OpenAI). However, it requires CPU-optimized compute instances (e.g., AWS C6i), costing ~$150/month.

---

## 3. Disaster Recovery (DR) & Outage Scenarios

### Recovery Time Objective (RTO): 1 Hour
### Recovery Point Objective (RPO): Near-Zero (Event Level)

### Scenario A: Kafka Broker Goes Down for 1 Hour
* **Impact**: SWS Webhooks will fail to publish. The system will throw `503 Service Unavailable` to source systems.
* **Mitigation**: Source systems must implement their own local outbox pattern to retry sending to SanchaarSetu. Once Kafka recovers, the backlog will be processed. No inflight data is lost because producers require `acks=all`.

### Scenario B: Department API is Offline for 24 Hours
* **Impact**: The Kafka consumer will attempt delivery, fail, and use exponential backoff (2s, 4s, 8s, 16s). After the maximum retries, the message goes to the Dead Letter Queue (DLQ).
* **Mitigation**: The DLQ messages are persisted to the `dlq_messages` Postgres table. Once the department system comes back online, an operator clicks "Replay DLQ" in the Dashboard, pushing the events back onto the main Kafka topic for delivery.

### Scenario C: Redis Cache is Flushed/Crashes
* **Impact**: The idempotency mechanism temporarily fails. If source systems retry events during this window, duplicates could enter the Kafka queue.
* **Mitigation**: A secondary idempotency check occurs at the database level (`ON CONFLICT DO NOTHING` for certain tables) to catch duplicates that slip past Redis.

---

## 4. Alternative Approaches Considered & Rejected

1. **Big-Bang Master Data Management (MDM)**
   * *Approach*: Force all 40 departments to deprecate their local databases and read/write directly from a single centralized SWS database.
   * *Why Rejected*: Politically and technically unfeasible. Departments have legacy vendor contracts and custom workflows. Non-invasive middleware (SanchaarSetu) was chosen to respect existing boundaries.
   
2. **Debezium / Pure CDC Ingestion**
   * *Approach*: Read directly from the Write-Ahead Logs (WAL) of department databases instead of using webhooks.
   * *Why Rejected*: Requires deep DBA access to 40 distinct databases (Oracle, MySQL, Postgres), which poses severe security and bureaucratic roadblocks. API/Webhook integration is much easier to negotiate with department IT teams.

---

## 5. Explicit Risk Register

| Risk ID | Risk Description | Severity | Likelihood | Mitigation Strategy |
|---------|------------------|----------|------------|---------------------|
| **R01** | Operator mistakenly approves wrong conflict resolution, corrupting both systems. | High | Medium | All manual resolutions are logged in the `audit` table with the operator ID. Changes can be tracked and reversed manually via an administrator. |
| **R02** | Department system silently drops an update but returns `200 OK`. | Critical | Low | Outside SanchaarSetu's control. Future roadmap includes a "Reconciliation Job" that periodically compares SWS state vs Dept state to flag silent discrepancies. |
| **R03** | PII leakage into AI models via unexpected fields not caught by Regex scrubber. | High | Low | The system runs a local, open-source model. Even if PII slips through the regex, it is not sent to a third-party API (like OpenAI), ensuring data residency compliance. |
| **R04** | DLQ fills up unnoticed, resulting in permanently stalled propagations. | Medium | Medium | DLQ metrics are exposed on the Dashboard. Alerts should be configured (via Prometheus/Grafana) to page operators if DLQ size > 100. |
