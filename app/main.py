import asyncio
import hashlib
import json
import sqlite3
import time
from difflib import SequenceMatcher

from fastapi import FastAPI, Request, BackgroundTasks
from pydantic import BaseModel
import httpx


DB_PATH = "./sanchaarsetu_demo.db"


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS idempotency (
        key TEXT PRIMARY KEY,
        created_at INTEGER
    )
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ubid TEXT,
        event_type TEXT,
        source TEXT,
        destination TEXT,
        payload_hash TEXT,
        idempotency_key TEXT,
        outcome TEXT,
        created_at INTEGER
    )
    """)
    conn.commit()
    conn.close()


app = FastAPI(title="SanchaarSetu Demo")
queue: asyncio.Queue = asyncio.Queue()


class SWSWebhook(BaseModel):
    ubid: str
    event_type: str
    payload: dict
    timestamp: float = None


def make_idempotency_key(ubid: str, event_type: str, ts: float, window_seconds: int = 60) -> str:
    window = int(ts // window_seconds)
    raw = f"{ubid}:{event_type}:{window}"
    return hashlib.sha256(raw.encode()).hexdigest()


def payload_hash(payload: dict) -> str:
    s = json.dumps(payload, sort_keys=True)
    return hashlib.sha256(s.encode()).hexdigest()


def db_check_and_insert_idempotency(key: str) -> bool:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM idempotency WHERE key=?", (key,))
    row = cur.fetchone()
    if row:
        conn.close()
        return False
    cur.execute("INSERT INTO idempotency(key, created_at) VALUES (?, ?)", (key, int(time.time())))
    conn.commit()
    conn.close()
    return True


def write_audit(ubid, event_type, source, destination, p_hash, idemp_key, outcome):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO audit(ubid,event_type,source,destination,payload_hash,idempotency_key,outcome,created_at) VALUES (?,?,?,?,?,?,?,?)",
        (ubid, event_type, source, destination, p_hash, idemp_key, outcome, int(time.time())),
    )
    conn.commit()
    conn.close()


def semantic_map_field(src_field: str, target_fields: list[str]) -> str:
    best = None
    best_score = 0.0
    for t in target_fields:
        score = SequenceMatcher(None, src_field.lower(), t.lower()).ratio()
        if score > best_score:
            best_score = score
            best = t
    return best if best_score > 0.4 else None


async def deliver_to_department(message: dict):
    # message contains: ubid, event_type, payload, idempotency_key, dept
    ubid = message["ubid"]
    event_type = message["event_type"]
    payload = message["payload"]
    idemp = message["idempotency_key"]
    dept = message.get("dept", "mock-dept")

    # Simple transform: map field names to department schema
    dept_schema = ["registered_address", "proprietor", "gstin", "signatory"]
    transformed = {}
    for k, v in payload.items():
        mapped = semantic_map_field(k, dept_schema)
        transformed[mapped or k] = v

    p_hash = payload_hash(transformed)

    url = f"http://127.0.0.1:8000/dept/{dept}/update"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, json={"ubid": ubid, "payload": transformed, "idempotency": idemp})
            if r.status_code == 200:
                write_audit(ubid, event_type, "SWS", dept, p_hash, idemp, "delivered")
            else:
                write_audit(ubid, event_type, "SWS", dept, p_hash, idemp, f"failed:{r.status_code}")
    except Exception as e:
        write_audit(ubid, event_type, "SWS", dept, p_hash, idemp, f"error:{str(e)}")


@app.on_event("startup")
async def startup_event():
    init_db()
    app.state.consumer_task = asyncio.create_task(consumer_loop())


@app.on_event("shutdown")
async def shutdown_event():
    task = app.state.consumer_task
    if task:
        task.cancel()


async def consumer_loop():
    while True:
        message = await queue.get()
        await deliver_to_department(message)
        queue.task_done()


@app.post("/sws/webhook")
async def sws_webhook(event: SWSWebhook):
    ts = event.timestamp or time.time()
    idemp = make_idempotency_key(event.ubid, event.event_type, ts)
    ok = db_check_and_insert_idempotency(idemp)
    if not ok:
        return {"status": "duplicate", "idempotency_key": idemp}
    message = {
        "ubid": event.ubid,
        "event_type": event.event_type,
        "payload": event.payload,
        "idempotency_key": idemp,
        "dept": "mock-dept",
    }
    await queue.put(message)
    return {"status": "accepted", "idempotency_key": idemp}


@app.post("/dept/{dept}/update")
async def dept_update(dept: str, req: Request):
    body = await req.json()
    ubid = body.get("ubid")
    payload = body.get("payload")
    idemp = body.get("idempotency")
    # Simulate department processing and return success
    write_audit(ubid, "dept_write", dept, "SanchaarSetu", payload_hash(payload), idemp, "accepted")
    return {"status": "ok", "dept": dept}
