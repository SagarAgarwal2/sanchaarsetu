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

BASE_URL = "http://localhost:8000"


def test_sws_to_dept():
    """Test 1: SWS address update propagates to department."""
    print("\n=== Test 1: SWS → Department Address Update ===")
    payload = {
        "ubid": "UBID-TEST-001",
        "event_type": "address_update",
        "payload": {"address": "123 MG Road, Bengaluru 560001", "proprietor": "Raj Kumar"},
        "timestamp": time.time(),
    }
    resp = requests.post(f"{BASE_URL}/sws/webhook", json=payload, headers={"X-API-Key": "sws-secret-key"})
    print(f"Status: {resp.status_code}")
    print(f"Response: {json.dumps(resp.json(), indent=2)}")
    return resp.json().get("idempotency_key")


def test_idempotency(idemp_key):
    """Test 2: Sending duplicate is rejected (idempotency)."""
    print("\n=== Test 2: Idempotency Check (Duplicate) ===")
    payload = {
        "ubid": "UBID-TEST-001",
        "event_type": "address_update",
        "payload": {"address": "123 MG Road, Bengaluru 560001", "proprietor": "Raj Kumar"},
        "timestamp": time.time(),
    }
    resp = requests.post(f"{BASE_URL}/sws/webhook", json=payload, headers={"X-API-Key": "sws-secret-key"})
    print(f"Status: {resp.status_code}")
    print(f"Response: {json.dumps(resp.json(), indent=2)}")
    if resp.json().get("status") == "duplicate":
        print("✓ Duplicate correctly rejected (idempotency working)")
    else:
        print("✗ Expected duplicate to be rejected")


def test_signatory_update():
    """Test 3: High-stakes field (signatory) update."""
    print("\n=== Test 3: Signatory Update (High-Stakes) ===")
    payload = {
        "ubid": "UBID-TEST-002",
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
    payload = {
        "ubid": "UBID-TEST-003",
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

    # Simulate SWS update
    payload1 = {
        "ubid": "UBID-CONFLICT-001",
        "event_type": "address_update",
        "payload": {"address": "New SWS Address"},
        "timestamp": ts,
    }
    resp1 = requests.post(f"{BASE_URL}/sws/webhook", json=payload1, headers={"X-API-Key": "sws-secret-key"})
    print(f"SWS Update: {resp1.status_code} - {resp1.json()}")

    # Immediately follow with similar update (simulates dept update arriving)
    # In production, this would come from Kafka consumer detecting dept change
    payload2 = {
        "ubid": "UBID-CONFLICT-001",
        "event_type": "address_update",
        "payload": {"address": "New Dept Address"},
        "timestamp": ts + 0.1,  # Slightly later
    }
    resp2 = requests.post(f"{BASE_URL}/sws/webhook", json=payload2, headers={"X-API-Key": "sws-secret-key"})
    print(f"Dept Update: {resp2.status_code} - {resp2.json()}")


def test_batch_load():
    """Test 6: Batch load scenario — multiple UBIDs."""
    print("\n=== Test 6: Batch Load (Multiple UBIDs) ===")
    for i in range(5):
        payload = {
            "ubid": f"UBID-BATCH-{i:03d}",
            "event_type": "address_update",
            "payload": {"address": f"{100 + i} MG Road, Bengaluru"},
            "timestamp": time.time(),
        }
        resp = requests.post(f"{BASE_URL}/sws/webhook", json=payload, headers={"X-API-Key": "sws-secret-key"})
        status = "✓" if resp.status_code == 200 else "✗"
        print(f"  {status} UBID-BATCH-{i:03d}: {resp.status_code}")


def run_all_tests():
    """Run all demo scenarios."""
    print("\n" + "="*60)
    print("SanchaarSetu Demo - End-to-End Test Suite")
    print("="*60)

    try:
        idemp = test_sws_to_dept()
        time.sleep(1)

        test_idempotency(idemp)
        time.sleep(1)

        test_signatory_update()
        time.sleep(1)

        test_gstin_update()
        time.sleep(1)

        test_simultaneous_updates()
        time.sleep(1)

        test_batch_load()

        print("\n" + "="*60)
        print("All tests completed. Check Postgres audit table:")
        print("  docker-compose exec postgres psql -U postgres -d sanchaar -c 'SELECT * FROM audit ORDER BY id DESC LIMIT 20;'")
        print("="*60)

    except Exception as e:
        print(f"\n✗ Error: {e}")
        print("Make sure the API is running: docker-compose up")


if __name__ == "__main__":
    run_all_tests()
