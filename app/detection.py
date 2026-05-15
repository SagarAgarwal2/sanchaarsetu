import json
import asyncio
from typing import Any, Callable
import asyncpg
import httpx


class ChangeDetector:
    """
    Detects changes in department systems via:
    - Tier 1: Webhook listener (push)
    - Tier 2: Scheduled API polling (pull)
    - Tier 3: Snapshot diff (full sync)
    """

    def __init__(self, pg_pool: asyncpg.pool.Pool):
        self.pg_pool = pg_pool
        # Stores the last known state per department.
        # Format: { "dept_name": { "UBID-1": { ...record... }, "UBID-2": { ... } } }
        self.last_snapshot = {}

    async def poll_api(self, url: str, dept_name: str, interval_seconds: int = 60) -> None:
        """
        Periodically poll a department's API for changes.
        Simulates Tier 2 ingestion.
        """
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                try:
                    response = await client.get(url)
                    if response.status_code == 200:
                        data = response.json()
                        await self._process_snapshot(dept_name, data)
                except Exception as e:
                    print(f"Error polling {url}: {e}")
                await asyncio.sleep(interval_seconds)

    async def snapshot_diff(
        self,
        fetch_fn: Callable[[], Any],
        dept_name: str,
        interval_seconds: int = 300,
    ) -> None:
        """
        Periodically fetch full snapshot and compute diff.
        Simulates Tier 3 ingestion for database-only systems.
        """
        while True:
            try:
                current_data = await fetch_fn()
                await self._process_snapshot(dept_name, current_data)
            except Exception as e:
                print(f"Error snapshotting {dept_name}: {e}")
            await asyncio.sleep(interval_seconds)

    async def _process_snapshot(self, dept_name: str, current_data: Any) -> None:
        """
        Computes the delta between the last known snapshot and the newly fetched data.
        Emits individual change events for any modified or new records.
        """
        if not isinstance(current_data, list):
            # If the API doesn't return a list, we wrap it to standardize processing.
            if isinstance(current_data, dict) and "ubid" in current_data:
                current_data = [current_data]
            else:
                return

        prev_data = self.last_snapshot.get(dept_name, {})
        current_map = {record.get("ubid"): record for record in current_data if isinstance(record, dict) and record.get("ubid")}
        
        changes_emitted = 0
        
        async with self.pg_pool.acquire() as conn:
            for ubid, current_record in current_map.items():
                prev_record = prev_data.get(ubid)
                
                # Check if the record is entirely new or if its content has changed
                if prev_record is None or json.dumps(current_record, sort_keys=True) != json.dumps(prev_record, sort_keys=True):
                    
                    # We compute the delta by identifying which specific fields actually changed
                    delta_payload = {}
                    if prev_record is None:
                        delta_payload = current_record
                    else:
                        for key, value in current_record.items():
                            if prev_record.get(key) != value:
                                delta_payload[key] = value

                    # Even if we just send the changed fields, we always include the UBID
                    delta_payload["ubid"] = ubid

                    payload_to_emit = {
                        "ubid": ubid,
                        "event_type": "dept_update",
                        "payload": delta_payload
                    }
                    
                    await conn.execute(
                        "INSERT INTO change_events(department, event_type, payload) VALUES ($1, $2, $3)",
                        dept_name,
                        "snapshot_diff",
                        json.dumps(payload_to_emit),
                    )
                    changes_emitted += 1
                    
        if changes_emitted > 0:
            print(f"[ChangeDetector] Detected and emitted {changes_emitted} record changes for {dept_name}.")
            
        # Update the in-memory state so we don't emit the same changes next polling cycle
        self.last_snapshot[dept_name] = current_map
