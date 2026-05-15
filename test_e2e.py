#!/usr/bin/env python3
"""
End-to-end demo of SanchaarSetu:
1. Send address update from SWS → department
2. Verify idempotency (duplicate rejection)
3. Simulate conflict (simultaneous updates)
4. Inspect audit trail
"""

import requests
import json
import time
import asyncio
import uuid

BASE_URL = "http://localhost:8000"


def test_sws_to_dept():
    """Test 1: SWS address update propagates to department."""
    print("\n=== Test 1: SWS → Department Address Update ===")
    ubid = f"UBID-TEST-001-{uuid.uuid4().hex[:8]}"
    ts = time.time()
    payload = {
        "ubid": ubid,
        "event_type": "address_update",
        "payload": {"address": "123 MG Road, Bengaluru 560001", "proprietor": "Raj Kumar"},
        "timestamp": ts,
    }
    resp = requests.post(f"{BASE_URL}/sws/webhook", json=payload, headers={"X-API-Key": "sws-secret-key"})
    print(f"Status: {resp.status_code}")
    print(f"Response: {json.dumps(resp.json(), indent=2)}")
    data = resp.json()
    return ubid, ts, (data.get("base_idempotency_key") or data.get("idempotency_key"))


def test_idempotency(ubid: str, ts: float):
    """Test 2: Sending duplicate is rejected (idempotency)."""
    print("\n=== Test 2: Idempotency Check (Duplicate) ===")
    payload = {
        "ubid": ubid,
        "event_type": "address_update",
        "payload": {"address": "123 MG Road, Bengaluru 560001", "proprietor": "Raj Kumar"},
        "timestamp": ts,
    }
    resp = requests.post(f"{BASE_URL}/sws/webhook", json=payload, headers={"X-API-Key": "sws-secret-key"})
    print(f"Status: {resp.status_code}")
    print(f"Response: {json.dumps(resp.json(), indent=2)}")
    data = resp.json()
    if data.get("status") == "duplicate":
        print("✓ Duplicate correctly rejected (idempotency working)")
        return
    # New broadcast shape: treat all-duplicates as idempotent
    if data.get("broadcast") and data.get("accepted") == 0 and (data.get("duplicates", 0) > 0):
        print("✓ Duplicate correctly suppressed across broadcast targets")
        return
    print("✗ Expected duplicate suppression")


def test_signatory_update():
    """Test 3: High-stakes field (signatory) update."""
    print("\n=== Test 3: Signatory Update (High-Stakes) ===")
    ubid = f"UBID-TEST-002-{uuid.uuid4().hex[:8]}"
    payload = {
        "ubid": ubid,
        "event_type": "signatory_update",
        "payload": {"signatory_name": "Priya Sharma", "signatory_pan": "ABCDE1234X"},
        "timestamp": time.time(),
    }
    resp = requests.post(f"{BASE_URL}/sws/webhook", json=payload, headers={"X-API-Key": "sws-secret-key"})
    print(f"Status: {resp.status_code}")
    print(f"Response: {json.dumps(resp.json(), indent=2)}")


def test_gstin_update():
    """Test 4: GST registration update."""
    print("\n=== Test 4: GSTIN Update ===")
    ubid = f"UBID-TEST-003-{uuid.uuid4().hex[:8]}"
    payload = {
        "ubid": ubid,
        "event_type": "gstin_update",
        "payload": {"gstin": "18AABCU9603R1Z0", "registration_date": "2024-01-15"},
        "timestamp": time.time(),
    }
    resp = requests.post(f"{BASE_URL}/sws/webhook", json=payload, headers={"X-API-Key": "sws-secret-key"})
    print(f"Status: {resp.status_code}")
    print(f"Response: {json.dumps(resp.json(), indent=2)}")


def test_simultaneous_updates():
    """Test 5: Conflict scenario — two sources update same UBID simultaneously."""
    print("\n=== Test 5: Simultaneous Conflict (SWS + Department) ===")
    ts = time.time()
    ubid = f"UBID-CONFLICT-001-{uuid.uuid4().hex[:8]}"

    # Simulate SWS update
    payload1 = {
        "ubid": ubid,
        "event_type": "address_update",
        "payload": {"address": "New SWS Address"},
        "timestamp": ts,
    }
    resp1 = requests.post(f"{BASE_URL}/sws/webhook", json=payload1, headers={"X-API-Key": "sws-secret-key"})
    print(f"SWS Update: {resp1.status_code} - {resp1.json()}")

    # Immediately follow with a Dept → SWS webhook (simulates dept update arriving)
    # Dept path uses department domain slug (matches RBAC keys).
    payload2 = {
        "ubid": ubid,
        "event_type": "address_update",
        "payload": {"registered_address": "New Dept Address"},
        "timestamp": ts + 0.1,  # Slightly later
    }
    resp2 = requests.post(
        f"{BASE_URL}/dept/factories/webhook",
        json=payload2,
        headers={"X-API-Key": "factories-secret-key"},
    )
    print(f"Dept Update: {resp2.status_code} - {resp2.json()}")
    return ubid


def test_conflict_resolution(ubid: str):
    """Test 5b: Resolve the generated conflict and verify requeue."""
    print("\n=== Test 5b: Conflict Resolution + Requeue ===")

    # Give the consumer time to process and create a conflict row.
    time.sleep(2)

    resp = requests.get(f"{BASE_URL}/conflicts", params={"q": ubid, "status": "all", "limit": 5, "offset": 0})
    print(f"Conflicts query: {resp.status_code}")
    data = resp.json() if resp.ok else {}
    total = data.get("total", 0)
    rows = data.get("data", [])
    print(f"Conflicts found: {total}")

    if not rows:
        print("(No conflict row found yet; skipping resolve step)")
        return

    c = rows[0]
    conflict_id = c.get("id")
    winning = c.get("sws_value") or c.get("dept_value")
    if not conflict_id or winning is None:
        print("(Conflict row missing id/winning candidate; skipping)")
        return

    patch = {
        "winning_value": winning,
        "resolved_by": "e2e-test",
        "resolution_reason": "E2E auto-resolve to demonstrate requeue",
    }
    resp2 = requests.patch(f"{BASE_URL}/conflicts/{conflict_id}", json=patch)
    print(f"Resolve: {resp2.status_code}")
    if resp2.ok:
        print(f"Resolve response: {json.dumps(resp2.json(), indent=2)}")
    else:
        print(resp2.text)
        return

    # Wait for the requeued propagation event to be processed.
    time.sleep(2)

    pe = requests.get(f"{BASE_URL}/propagation-events", params={"q": ubid, "limit": 10, "offset": 0}, headers={"X-API-Key": "sws-secret-key"})
    print(f"Propagation-events query: {pe.status_code}")
    if pe.ok:
        print(json.dumps(pe.json(), indent=2))


def test_batch_load():
    """Test 6: Batch load scenario — multiple UBIDs."""
    print("\n=== Test 6: Batch Load (Multiple UBIDs) ===")
    for i in range(5):
        time.sleep(0.3)
        payload = {
            "ubid": f"UBID-BATCH-{int(time.time())}-{i:03d}",
            "event_type": "address_update",
            "payload": {"address": f"{100 + i} MG Road, Bengaluru"},
            "timestamp": time.time(),
        }
        resp = requests.post(f"{BASE_URL}/sws/webhook", json=payload, headers={"X-API-Key": "sws-secret-key"})
        status = "✓" if resp.status_code == 200 else "✗"
        print(f"  {status} UBID-BATCH-{i:03d}: {resp.status_code}")


def test_change_detection_ingest():
    """Test 7: Tier-2/3 change event is ingested and published into pipeline."""
    print("\n=== Test 7: Change Detection → Kafka Ingest ===")
    payload = {
        "department": "factories",
        "ubid": "UBID-CHANGE-001",
        "event_type": "address_update",
        "payload": {"registered_address": "Detected change from polling"},
    }
    resp = requests.post(f"{BASE_URL}/simulate/change-detected", json=payload)
    print(f"Status: {resp.status_code}")
    print(f"Response: {json.dumps(resp.json(), indent=2)}")


def test_dlq_replay():
    """Test 8: DLQ message listing and replay."""
    print("\n=== Test 8: DLQ Inbox & Replay ===")
    
    # Wait a moment for DLQ consumer to process any pending messages
    time.sleep(2)
    
    # Query DLQ inbox
    resp = requests.get(f"{BASE_URL}/dlq", headers={"X-API-Key": "sws-secret-key"})
    print(f"DLQ List Status: {resp.status_code}")
    dlq_data = resp.json()
    print(f"DLQ messages found: {dlq_data.get('total', 0)}")
    
    if dlq_data.get("total", 0) > 0 and dlq_data.get("data"):
        first_dlq = dlq_data["data"][0]
        dlq_msg_id = first_dlq.get("id")
        ubid = first_dlq.get("ubid")
        print(f"  Sample: {ubid} (ID: {dlq_msg_id})")
        
        # Try to replay it
        if dlq_msg_id:
            replay_resp = requests.post(
                f"{BASE_URL}/dlq/{dlq_msg_id}/replay",
                headers={"X-API-Key": "sws-secret-key"}
            )
            print(f"Replay Status: {replay_resp.status_code}")
            print(f"Replay Response: {json.dumps(replay_resp.json(), indent=2)}")
            time.sleep(1)
            
            # Verify replayed message is now back in propagation_events as pending
            verify_resp = requests.get(
                f"{BASE_URL}/propagation-events?outcome=pending&limit=1",
                headers={"X-API-Key": "sws-secret-key"}
            )
            if verify_resp.status_code == 200:
                verify_data = verify_resp.json()
                if verify_data.get("total", 0) > 0:
                    print(f"✓ Replayed event found in pending propagation_events")
                else:
                    print(f"(pending events may not appear immediately)")
    else:
        print("  (No DLQ messages in inbox; this is expected if all deliveries succeeded)")


def run_all_tests():
    """Run all demo scenarios."""
    print("\n" + "="*60)
    print("SanchaarSetu Demo - End-to-End Test Suite")
    print("="*60)

    try:
        ubid1, ts1, _ = test_sws_to_dept()
        time.sleep(1)

        test_idempotency(ubid1, ts1)
        time.sleep(1)

        test_signatory_update()
        time.sleep(1)

        test_gstin_update()
        time.sleep(1)

        conflict_ubid = test_simultaneous_updates()
        test_conflict_resolution(conflict_ubid)
        time.sleep(1)

        test_batch_load()
        time.sleep(1)

        test_change_detection_ingest()
        time.sleep(1)

        test_dlq_replay()

        print("\n" + "="*60)
        print("All tests completed. Check Postgres audit table:")
        print("  docker-compose exec postgres psql -U postgres -d sanchaar -c 'SELECT * FROM audit ORDER BY id DESC LIMIT 20;'")
        print("="*60)

    except Exception as e:
        print(f"\n✗ Error: {e}")
        print("Make sure the API is running: docker-compose up")


if __name__ == "__main__":
    run_all_tests()
