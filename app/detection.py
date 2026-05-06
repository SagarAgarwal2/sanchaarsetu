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
        self.last_snapshot = {}

    async def poll_api(self, url: str, interval_seconds: int = 60) -> None:
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
                        # In production: compare with last known state, emit deltas
                        pass
                except Exception:
                    pass
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
                current = await fetch_fn()
                prev = self.last_snapshot.get(dept_name, {})

                # Simple hash-based diff
                current_hash = json.dumps(current, sort_keys=True)
                prev_hash = json.dumps(prev, sort_keys=True)

                if current_hash != prev_hash:
                    # Emit change event
                    async with self.pg_pool.acquire() as conn:
                        await conn.execute(
                            "INSERT INTO change_events(department, event_type, payload) VALUES ($1, $2, $3)",
                            dept_name,
                            "snapshot_diff",
                            current_hash,
                        )
                    self.last_snapshot[dept_name] = current

            except Exception:
                pass
            await asyncio.sleep(interval_seconds)
