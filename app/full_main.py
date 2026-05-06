import asyncio
import json
import os
import hashlib
import time
import random
import uuid
from typing import Any

import httpx
import redis.asyncio as redis
import asyncpg
from aiokafka import AIOKafkaProducer, AIOKafkaConsumer
from fastapi import FastAPI, Request, HTTPException, Security, Depends
from fastapi.security import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.transform import transform_payload
from app.conflicts import ConflictResolver, ConflictPolicy
from app.detection import ChangeDetector


KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
POSTGRES_DSN = os.getenv("POSTGRES_DSN", "postgres://postgres:postgres@localhost:5432/sanchaar")
TOPIC = "sanchaar-events"


class SWSWebhook(BaseModel):
    ubid: str
    event_type: str
    payload: dict
    timestamp: float | None = None


class ConflictResolveBody(BaseModel):
    winning_value: str | None = None
    resolved_by: str | None = None
    resolution_reason: str | None = None


class MappingCreateBody(BaseModel):
    department_id: str
    sws_field: str
    dept_field: str
    confidence_score: float = 0.0


class MappingUpdateBody(BaseModel):
    status: str | None = None
    reviewed_by: str | None = None
    reviewed_at: str | None = None
    confidence_score: float | None = None


class DepartmentUpdateBody(BaseModel):
    status: str


class SimulateBody(BaseModel):
    count: int = 8


class ReplayEventBody(BaseModel):
    ubid: str
    event_type: str
    source_system: str
    destination_system: str
    payload_hash: str | None = None
    direction: str = 'sws_to_dept'


app = FastAPI(title="SanchaarSetu Full Demo")

# Allow simple frontend development (restrict in prod)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.state.kafka_producer: AIOKafkaProducer | None = None
app.state.kafka_consumer: AIOKafkaConsumer | None = None
app.state.redis: redis.Redis | None = None
app.state.pg_pool: asyncpg.pool.Pool | None = None
app.state.consumer_task: asyncio.Task | None = None
app.state.conflict_resolver: ConflictResolver | None = None
app.state.change_detector: ChangeDetector | None = None


# ------------------------
# Utility Functions
# ------------------------

def make_idempotency_key(ubid: str, event_type: str, ts: float, window_seconds: int = 60) -> str:
    window = int(ts // window_seconds)
    raw = f"{ubid}:{event_type}:{window}"
    return hashlib.sha256(raw.encode()).hexdigest()


def make_unique_idempotency_key(ubid: str, event_type: str) -> str:
    raw = f"{ubid}:{event_type}:{uuid.uuid4().hex}"
    return hashlib.sha256(raw.encode()).hexdigest()


def payload_hash(payload: dict) -> str:
    s = json.dumps(payload, sort_keys=True)
    return hashlib.sha256(s.encode()).hexdigest()


# ------------------------
# Database Functions
# ------------------------

async def write_audit(pg_pool, ubid, event_type, source, destination, p_hash, idemp_key, outcome):
    async with pg_pool.acquire() as conn:
        try:
            row = await conn.fetchrow("SELECT chained_hash FROM audit ORDER BY id DESC LIMIT 1")
            prev_hash = row["chained_hash"] if row and "chained_hash" in row.keys() else "GENESIS_HASH"
        except Exception:
            # Fallback if DB hasn't been migrated yet during live reload
            prev_hash = "GENESIS_HASH"
            
        chain_data = f"{prev_hash}{ubid}{event_type}{source}{destination}{p_hash}{idemp_key}{outcome}"
        chained_hash = hashlib.sha256(chain_data.encode()).hexdigest()

        try:
            await conn.execute(
                """
                INSERT INTO audit(
                    ubid,event_type,source_system,destination_system,
                    payload_hash,idempotency_key,outcome, previous_hash, chained_hash
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                """,
                ubid, event_type, source, destination,
                p_hash, idemp_key, outcome, prev_hash, chained_hash
            )
        except Exception:
            # Fallback for old schema without hash columns
            await conn.execute(
                """
                INSERT INTO audit(
                    ubid,event_type,source_system,destination_system,
                    payload_hash,idempotency_key,outcome
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7)
                """,
                ubid, event_type, source, destination,
                p_hash, idemp_key, outcome
            )


async def fetch_rows(pg_pool, sql: str, *args):
    async with pg_pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)
        return [dict(r) for r in rows]


async def fetch_row(pg_pool, sql: str, *args):
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(sql, *args)
        return dict(row) if row else None


async def count_rows(pg_pool, table: str, where_sql: str = "", *args):
    sql = f"SELECT COUNT(*) AS count FROM {table} {where_sql}"
    row = await fetch_row(pg_pool, sql, *args)
    return int(row["count"]) if row else 0


# ------------------------
# Delivery Logic
# ------------------------

async def deliver_to_department(pg_pool, message: dict):
    ubid = message["ubid"]
    event_type = message["event_type"]
    payload = message["payload"]
    idemp = message["idempotency_key"]
    dept = message.get("dept", "mock-dept")

    dept_schema = [
        "registered_address", "proprietor", "gstin",
        "signatory", "signatory_pan", "signatory_name",
        "registration_date"
    ]

    try:
        transformed = await transform_payload(pg_pool, dept, payload, dept_schema)
    except Exception:
        transformed = payload

    p_hash = payload_hash(transformed)
    success = False

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"http://127.0.0.1:8000/dept/{dept}/update",
                json={"ubid": ubid, "payload": transformed, "idempotency": idemp}
            )

            if r.status_code == 200:
                outcome = "delivered"
                success = True
            else:
                outcome = f"failed:{r.status_code}"

    except Exception as e:
        outcome = f"error:{str(e)}"

    await write_audit(pg_pool, ubid, event_type, "SWS", dept, p_hash, idemp, outcome)
    return outcome, p_hash, success


# ------------------------
# Kafka Consumer
# ------------------------

DLQ_TOPIC = "sanchaar-dlq"

async def kafka_consumer_loop():
    consumer = app.state.kafka_consumer
    producer = app.state.kafka_producer
    pg_pool = app.state.pg_pool
    conflict_resolver = app.state.conflict_resolver

    async for msg in consumer:
        try:
            payload = json.loads(msg.value.decode())

            ubid = payload.get("ubid")
            source = payload.get("source", "SWS")
            event_payload = payload.get("payload", {})
            ts = payload.get("timestamp", time.time())
            retry_count = payload.get("retry_count", 0)

            conflict = await conflict_resolver.detect_conflict(
                ubid, source, event_payload, ts
            )

            if conflict:
                resolution = await conflict_resolver.resolve_conflict(
                    conflict, ConflictPolicy.SWS_WINS
                )
                print(f"[CONFLICT RESOLVED] {ubid}: {resolution['reason']}")

            outcome, p_hash, success = await deliver_to_department(pg_pool, payload)

            if not success:
                max_retries = 4
                if retry_count < max_retries:
                    retry_count += 1
                    payload["retry_count"] = retry_count
                    backoff_time = 2 ** retry_count  # 2, 4, 8, 16 seconds
                    print(f"[{ubid}] Delivery failed. Retrying in {backoff_time}s (Attempt {retry_count}/{max_retries})")
                    
                    await asyncio.sleep(backoff_time)
                    await producer.send_and_wait(TOPIC, json.dumps(payload).encode())
                else:
                    print(f"[{ubid}] Max retries reached. Moving to DLQ.")
                    await producer.send_and_wait(DLQ_TOPIC, json.dumps(payload).encode())
                    await write_audit(pg_pool, ubid, payload.get("event_type"), "SWS", payload.get("dept", "mock-dept"), p_hash, payload.get("idempotency_key"), "dlq")

        except Exception as e:
            print(f"Consumer error: {e}")


# ------------------------
# Startup / Shutdown
# ------------------------

@app.on_event("startup")
async def startup():
    app.state.redis = redis.from_url(REDIS_URL)
    
    for attempt in range(10):
        try:
            app.state.pg_pool = await asyncpg.create_pool(
                dsn=POSTGRES_DSN,
                min_size=1,
                max_size=5
            )
            print("✅ PostgreSQL connected.")
            break
        except Exception as e:
            print(f"⏳ Postgres not ready (attempt {attempt + 1}/10): {e}")
            if attempt == 9:
                raise
            await asyncio.sleep(2 ** attempt)

    app.state.kafka_producer = AIOKafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP
    )
    await app.state.kafka_producer.start()

    app.state.kafka_consumer = AIOKafkaConsumer(
        TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP,
        group_id="sanchaar-group"
    )
    await app.state.kafka_consumer.start()

    app.state.conflict_resolver = ConflictResolver(app.state.pg_pool)
    app.state.change_detector = ChangeDetector(app.state.pg_pool)

    app.state.consumer_task = asyncio.create_task(kafka_consumer_loop())


@app.on_event("shutdown")
async def shutdown():
    if app.state.consumer_task:
        app.state.consumer_task.cancel()

    if app.state.kafka_consumer:
        await app.state.kafka_consumer.stop()

    if app.state.kafka_producer:
        await app.state.kafka_producer.stop()

    if app.state.pg_pool:
        await app.state.pg_pool.close()

    if app.state.redis:
        await app.state.redis.close()


# ------------------------
# RBAC, Rate Limiting & Schema Validation
# ------------------------

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=True)

API_KEYS = {
    "sws-secret-key": "SWS",
    "factories-secret-key": "factories",
    "labour-secret-key": "labour",
    "ctd-secret-key": "ctd"
}

DEPARTMENT_SCHEMAS = {
    "SWS": {"address", "proprietor", "gstin", "signatory", "signatory_pan", "signatory_name", "registration_date"},
    "factories": {"registered_address", "proprietor", "gstin", "signatory", "signatory_pan", "signatory_name", "registration_date", "factory_license"},
    "labour": {"registered_address", "proprietor", "gstin", "signatory", "signatory_pan", "signatory_name", "registration_date", "labour_code"},
    "ctd": {"registered_address", "proprietor", "gstin", "signatory", "signatory_pan", "signatory_name", "registration_date", "tax_tier"}
}

async def verify_rbac(req: Request, api_key: str = Security(api_key_header)):
    source_system = API_KEYS.get(api_key)
    if not source_system:
        raise HTTPException(status_code=403, detail="Invalid API Key")
    
    if req.url.path.startswith("/sws/") and source_system != "SWS":
        raise HTTPException(status_code=403, detail="Not authorized for SWS endpoints")
    if req.url.path.startswith("/dept/"):
        dept_path = req.url.path.split("/")[2]
        if source_system != dept_path and source_system != "SWS":
            raise HTTPException(status_code=403, detail="Not authorized for this department")
    return source_system

async def rate_limit(req: Request, source_system: str = Depends(verify_rbac)):
    r = app.state.redis
    if not r:
        return source_system
    
    key = f"rate_limit:{source_system}:{int(time.time())}"
    count = await r.incr(key)
    if count == 1:
        await r.expire(key, 2)
    
    if count > 5:
        if count > 20:
            print(f"ANOMALY DETECTED: {source_system} is flooding the system. Halting queue.")
        raise HTTPException(status_code=429, detail="Rate limit exceeded. System paused.")
    
    return source_system

def validate_schema(payload: dict, expected_fields: set[str]):
    incoming_fields = set(payload.keys())
    unexpected = incoming_fields - expected_fields
    if unexpected:
        raise HTTPException(status_code=400, detail=f"Schema validation failed. Unexpected fields: {unexpected}")

# ------------------------
# API Routes
# ------------------------

@app.post("/sws/webhook")
async def sws_webhook(event: SWSWebhook, source: str = Depends(rate_limit)):
    validate_schema(event.payload, DEPARTMENT_SCHEMAS.get("SWS", set()))
    ts = event.timestamp or time.time()
    idemp = make_idempotency_key(event.ubid, event.event_type, ts)

    r = app.state.redis
    ok = await r.set(idemp, "1", ex=3600, nx=True)

    if not ok:
        return {"status": "duplicate", "idempotency_key": idemp}

    message = {
        "ubid": event.ubid,
        "event_type": event.event_type,
        "payload": event.payload,
        "idempotency_key": idemp,
        "timestamp": ts,
        "source": "SWS",
        "dept": "mock-dept",
    }

    await app.state.kafka_producer.send_and_wait(
        TOPIC, json.dumps(message).encode()
    )

    await write_audit(
        app.state.pg_pool,
        event.ubid,
        event.event_type,
        "SWS",
        "kafka",
        payload_hash(event.payload),
        idemp,
        "queued",
    )

    return {"status": "accepted", "idempotency_key": idemp}


@app.post("/dept/{dept}/update")
async def dept_update(dept: str, req: Request, source: str = Depends(rate_limit)):
    body: dict[str, Any] = await req.json()
    payload = body.get("payload", {})
    validate_schema(payload, DEPARTMENT_SCHEMAS.get(dept, set()))

    await write_audit(
        app.state.pg_pool,
        body.get("ubid"),
        "dept_write",
        dept,
        "SanchaarSetu",
        payload_hash(body.get("payload")),
        body.get("idempotency"),
        "accepted",
    )

    return {"status": "ok", "dept": dept}


@app.get("/health")
async def health():
    return {"status": "ok"}


# --- Admin / Frontend-friendly endpoints ---
@app.get("/audit")
async def get_audit(limit: int = 100, offset: int = 0):
    pg = app.state.pg_pool
    rows = await pg.fetch(
        "SELECT * FROM audit ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        limit,
        offset,
    )
    return [dict(r) for r in rows]


@app.get("/departments")
async def list_departments():
    return await fetch_rows(app.state.pg_pool, "SELECT * FROM departments ORDER BY ingestion_tier, name")


@app.patch("/departments/{dept_id}")
async def update_department(dept_id: str, body: DepartmentUpdateBody):
    row = await fetch_row(
        app.state.pg_pool,
        "UPDATE departments SET status = $1 WHERE id = $2 RETURNING *",
        body.status,
        dept_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="department not found")
    return row


@app.get("/businesses")
async def list_businesses():
    return await fetch_rows(app.state.pg_pool, "SELECT * FROM businesses ORDER BY created_at DESC")


@app.get("/propagation-events")
async def list_propagation_events(limit: int = 25, offset: int = 0, outcome: str | None = None, q: str | None = None):
    clauses = []
    args: list[Any] = []
    if outcome and outcome != "all":
        clauses.append(f"outcome = ${len(args) + 1}")
        args.append(outcome)
    if q:
        idx = len(args)
        clauses.append(
            f"(ubid ILIKE ${idx + 1} OR event_type ILIKE ${idx + 1} OR source_system ILIKE ${idx + 1} OR destination_system ILIKE ${idx + 1})"
        )
        args.append(f"%{q}%")
    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = await fetch_rows(
        app.state.pg_pool,
        f"SELECT * FROM propagation_events {where_sql} ORDER BY created_at DESC LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}",
        *args,
        limit,
        offset,
    )
    total = await count_rows(app.state.pg_pool, "propagation_events", where_sql, *args)
    return {"data": rows, "total": total}


@app.post("/simulate/event")
async def simulate_event_backend():
    ubids = [
        "UBID-KA-2024-001847", "UBID-KA-2024-002341", "UBID-KA-2024-003892",
        "UBID-KA-2024-005123", "UBID-KA-2024-006789", "UBID-KA-2024-008234",
        "UBID-KA-2024-009012", "UBID-KA-2024-010345",
    ]
    event_types = ["address_update", "signatory_update", "license_renewal", "gstin_update", "compliance_status", "registration_new"]
    departments = await fetch_rows(app.state.pg_pool, "SELECT id, code FROM departments ORDER BY code")
    if not departments:
        return {"status": "no_departments"}
    dept = random.choice(departments)
    outcome = random.choice(["success", "failure", "duplicate", "pending", "dlq", "conflict", "success", "success"])
    direction = random.choice(["sws_to_dept", "dept_to_sws"])
    ubid = random.choice(ubids)
    event_type = random.choice(event_types)
    idemp = make_unique_idempotency_key(ubid, event_type)
    row = await fetch_row(
        app.state.pg_pool,
        """
        INSERT INTO propagation_events(
          ubid,event_type,source_system,destination_system,payload_hash,idempotency_key,
          outcome,direction,conflict_flag,resolution_applied,retry_count,error_message,propagation_ms
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING *
        """,
        ubid,
        event_type,
        "SWS" if direction == "sws_to_dept" else dept["code"],
        dept["code"] if direction == "sws_to_dept" else "SWS",
        payload_hash({"ubid": ubid, "event_type": event_type}),
        idemp,
        outcome,
        direction,
        outcome == "conflict",
        "sws_wins" if outcome == "conflict" else None,
        0 if outcome in ("success", "pending") else random.randint(1, 5),
        "Simulated backend event" if outcome in ("failure", "dlq") else None,
        random.randint(80, 2500) if outcome in ("success", "duplicate") else None,
    )
    if outcome == "conflict":
        await app.state.pg_pool.execute(
            """
            INSERT INTO conflicts(ubid, field_name, sws_value, dept_value, source_department_id, resolution_policy, status, winning_value, resolved_by, resolved_at, propagation_event_id, resolution_reason)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,$11)
            """,
            ubid,
            random.choice(["registered_address", "signatory_name", "gstin", "pan_number"]),
            "SWS value",
            "Dept value",
            dept["id"],
            random.choice(["sws_wins", "last_write_wins", "manual_review"]),
            random.choice(["open", "pending_review"]),
            None,
            None,
            row["id"],
            "Simulated conflict from backend",
        )
    if outcome == "success":
        await app.state.pg_pool.execute(
            "UPDATE departments SET records_synced = records_synced + 1, last_sync_at = now() WHERE id = $1",
            dept["id"],
        )
    return row


@app.post("/simulate/burst")
async def simulate_burst_backend(body: SimulateBody):
    rows = []
    for _ in range(max(1, min(body.count, 20))):
        rows.append(await simulate_event_backend())
    return {"count": len(rows), "rows": rows}


@app.post("/propagation-events/replay")
async def replay_propagation_event(body: ReplayEventBody):
    idemp = make_unique_idempotency_key(body.ubid, body.event_type)
    row = await fetch_row(
        app.state.pg_pool,
        """
        INSERT INTO propagation_events(
            ubid,event_type,source_system,destination_system,payload_hash,idempotency_key,
            outcome,direction,conflict_flag,resolution_applied,retry_count,error_message,propagation_ms
        ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,false,NULL,0,NULL,NULL)
        RETURNING *
        """,
        body.ubid,
        body.event_type,
        body.source_system,
        body.destination_system,
        body.payload_hash,
        idemp,
        body.direction,
    )
    return row


@app.get("/conflicts")
async def list_conflicts(status: str | None = None, q: str | None = None, limit: int = 100, offset: int = 0):
    clauses = []
    args: list[Any] = []
    if status and status != "all":
        clauses.append(f"status = ${len(args) + 1}")
        args.append(status)
    if q:
        clauses.append(f"(ubid ILIKE ${len(args) + 1} OR field_name ILIKE ${len(args) + 1})")
        args.append(f"%{q}%")
    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = await fetch_rows(
        app.state.pg_pool,
        f"SELECT * FROM conflicts {where_sql} ORDER BY created_at DESC LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}",
        *args,
        limit,
        offset,
    )
    total = await count_rows(app.state.pg_pool, "conflicts", where_sql, *args)
    return {"data": rows, "total": total}


@app.patch("/conflicts/{conflict_id}")
async def update_conflict(conflict_id: str, body: ConflictResolveBody):
    row = await fetch_row(
        app.state.pg_pool,
        """
        UPDATE conflicts
        SET status = 'resolved', winning_value = COALESCE($1, winning_value), resolved_by = $2,
            resolved_at = now(), resolution_reason = $3
        WHERE id = $4
        RETURNING *
        """,
        body.winning_value,
        body.resolved_by,
        body.resolution_reason,
        conflict_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="conflict not found")
    return row


@app.get("/schema-mappings")
async def list_schema_mappings(status: str | None = None, department_id: str | None = None, q: str | None = None, limit: int = 100, offset: int = 0):
    clauses = []
    args: list[Any] = []
    if status and status != "all":
        clauses.append(f"status = ${len(args) + 1}")
        args.append(status)
    if department_id and department_id != "all":
        clauses.append(f"department_id = ${len(args) + 1}")
        args.append(department_id)
    if q:
        clauses.append(f"(sws_field ILIKE ${len(args) + 1} OR dept_field ILIKE ${len(args) + 1})")
        args.append(f"%{q}%")
    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = await fetch_rows(
        app.state.pg_pool,
        f"SELECT * FROM schema_mappings {where_sql} ORDER BY confidence_score DESC, created_at DESC LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}",
        *args,
        limit,
        offset,
    )
    total = await count_rows(app.state.pg_pool, "schema_mappings", where_sql, *args)
    return {"data": rows, "total": total}


@app.post("/schema-mappings")
async def create_schema_mapping(body: MappingCreateBody):
    status = "auto_mapped" if body.confidence_score >= 0.85 else "pending_review"
    row = await fetch_row(
        app.state.pg_pool,
        """
        INSERT INTO schema_mappings(department_id, sws_field, dept_field, confidence_score, status, version)
        VALUES ($1,$2,$3,$4,$5,1)
        RETURNING *
        """,
        body.department_id,
        body.sws_field,
        body.dept_field,
        body.confidence_score,
        status,
    )
    return row


@app.patch("/schema-mappings/{mapping_id}")
async def update_schema_mapping(mapping_id: str, body: MappingUpdateBody):
    row = await fetch_row(
        app.state.pg_pool,
        """
        UPDATE schema_mappings
        SET status = COALESCE($1, status), reviewed_by = $2, reviewed_at = COALESCE($3::timestamptz, reviewed_at), confidence_score = COALESCE($4, confidence_score)
        WHERE id = $5
        RETURNING *
        """,
        body.status,
        body.reviewed_by,
        body.reviewed_at,
        body.confidence_score,
        mapping_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="mapping not found")
    return row


@app.get("/dashboard/stats")
async def dashboard_stats():
    pg = app.state.pg_pool
    events = await fetch_rows(pg, "SELECT outcome, direction, propagation_ms FROM propagation_events ORDER BY created_at DESC")
    departments = await fetch_rows(pg, "SELECT * FROM departments ORDER BY ingestion_tier, name")
    recent = await fetch_rows(pg, "SELECT * FROM propagation_events ORDER BY created_at DESC LIMIT 12")
    return {
        "events": events,
        "recentEvents": recent,
        "departments": departments,
        "totalEvents": len(events),
        "activeConflicts": await count_rows(pg, "conflicts", "WHERE status IN ('open', 'pending_review')"),
        "pendingMappings": await count_rows(pg, "schema_mappings", "WHERE status = 'pending_review'"),
        "totalBusinesses": await count_rows(pg, "businesses"),
        "activeDepts": len([d for d in departments if d.get("status") == "active"]),
        "avgPropMs": round(sum([e["propagation_ms"] for e in events if e.get("propagation_ms") is not None]) / max(1, len([e for e in events if e.get("propagation_ms") is not None]))),
        "swsToDept": len([e for e in events if e.get("direction") == "sws_to_dept"]),
        "deptToSws": len([e for e in events if e.get("direction") == "dept_to_sws"]),
    }


@app.get("/conflict-log")
async def get_conflict_log(limit: int = 100, offset: int = 0):
    pg = app.state.pg_pool
    rows = await pg.fetch(
        "SELECT * FROM conflict_log ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        limit,
        offset,
    )
    return [dict(r) for r in rows]


@app.post("/conflicts/resolve")
async def api_resolve_conflict(body: dict):
    conflict = body.get("conflict")
    policy_str = body.get("policy", "sws_wins")
    if not conflict:
        raise HTTPException(status_code=400, detail="missing conflict in body")
    try:
        policy = ConflictPolicy(policy_str)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid policy")

    res = await app.state.conflict_resolver.resolve_conflict(conflict, policy)
    return res


@app.get("/mappings")
async def get_mappings(limit: int = 100, offset: int = 0):
    pg = app.state.pg_pool
    rows = await pg.fetch(
        "SELECT * FROM mapping_registry ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        limit,
        offset,
    )
    return [dict(r) for r in rows]


@app.post("/mappings/{mapping_id}/approve")
async def approve_mapping(mapping_id: int):
    pg = app.state.pg_pool
    # mark as approved by setting confidence high (simple flow)
    await pg.execute("UPDATE mapping_registry SET confidence = $1 WHERE id = $2", 0.99, mapping_id)
    row = await pg.fetchrow("SELECT * FROM mapping_registry WHERE id = $1", mapping_id)
    return dict(row)


@app.post("/mappings/{mapping_id}/reject")
async def reject_mapping(mapping_id: int):
    pg = app.state.pg_pool
    # mark as rejected by setting confidence low
    await pg.execute("UPDATE mapping_registry SET confidence = $1 WHERE id = $2", 0.0, mapping_id)
    row = await pg.fetchrow("SELECT * FROM mapping_registry WHERE id = $1", mapping_id)
    return dict(row)