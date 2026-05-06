import asyncpg
import json
import time
from enum import Enum
from typing import Any


class ConflictPolicy(str, Enum):
    SWS_WINS = "sws_wins"  # SWS update is applied, dept update discarded
    LAST_WRITE_WINS = "last_write_wins"  # Later timestamp wins
    MANUAL_REVIEW = "manual_review"  # Both held for human decision


class ConflictResolver:
    """
    Detects and resolves conflicts in bidirectional updates.
    Monitors Kafka queue for simultaneous updates to the same UBID.
    """

    def __init__(self, pg_pool: asyncpg.pool.Pool, detection_window_seconds: int = 60):
        self.pg_pool = pg_pool
        self.detection_window = detection_window_seconds
        self.pending_updates = {}  # UBID -> list of (timestamp, source, payload)

    async def detect_conflict(
        self,
        ubid: str,
        source: str,
        payload: dict[str, Any],
        timestamp: float,
    ) -> dict[str, Any] | None:
        """
        Check if this update conflicts with a recent one on the same UBID.
        Returns conflict details if found, None otherwise.
        """
        if ubid not in self.pending_updates:
            self.pending_updates[ubid] = []

        pending = self.pending_updates[ubid]

        # Find conflicting updates within detection window
        conflicts = [u for u in pending if abs(u[0] - timestamp) <= self.detection_window]

        if conflicts:
            # Conflict detected
            other_timestamp, other_source, other_payload = conflicts[0]
            return {
                "ubid": ubid,
                "source1": source,
                "source2": other_source,
                "timestamp1": timestamp,
                "timestamp2": other_timestamp,
                "payload1": payload,
                "payload2": other_payload,
            }

        # Register this update
        pending.append((timestamp, source, payload))

        # Clean old updates outside window
        self.pending_updates[ubid] = [u for u in pending if abs(u[0] - timestamp) <= self.detection_window]

        return None

    async def resolve_conflict(
        self,
        conflict: dict[str, Any],
        policy: ConflictPolicy = ConflictPolicy.SWS_WINS,
    ) -> dict[str, Any]:
        """
        Resolve conflict using configured policy.
        Returns resolution details and the winning value.
        """
        ubid = conflict["ubid"]
        source1 = conflict["source1"]
        source2 = conflict["source2"]
        ts1 = conflict["timestamp1"]
        ts2 = conflict["timestamp2"]
        payload1 = conflict["payload1"]
        payload2 = conflict["payload2"]

        winner = None
        reason = ""

        if policy == ConflictPolicy.SWS_WINS:
            winner = payload1 if source1 == "SWS" else payload2
            reason = f"{source1 if source1 == 'SWS' else source2} (SWS) wins"

        elif policy == ConflictPolicy.LAST_WRITE_WINS:
            winner = payload1 if ts1 > ts2 else payload2
            reason = f"Last write at {max(ts1, ts2)} wins"

        elif policy == ConflictPolicy.MANUAL_REVIEW:
            # Both held; no automatic winner
            reason = "Manual review required"
            winner = None

        # Record resolution in audit
        async with self.pg_pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO conflict_log(ubid, source1, source2, policy, resolution, created_at) VALUES ($1, $2, $3, $4, $5, now())",
                ubid,
                source1,
                source2,
                policy.value,
                reason,
            )

        return {
            "ubid": ubid,
            "policy": policy.value,
            "reason": reason,
            "winning_payload": winner,
            "source1": source1,
            "source2": source2,
        }
