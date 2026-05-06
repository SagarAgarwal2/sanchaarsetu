#!/usr/bin/env python3
"""
Audit Trail Inspector: view all propagation events and resolutions from Postgres.
"""

import asyncpg
import asyncio
import sys

POSTGRES_DSN = "postgres://postgres:postgres@localhost:5432/sanchaar"


async def inspect_audit():
    """Display audit trail."""
    pool = await asyncpg.create_pool(dsn=POSTGRES_DSN)
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM audit ORDER BY id DESC LIMIT 50")
        print("\n=== Audit Trail ===")
        for row in rows:
            print(f"ID: {row['id']}, UBID: {row['ubid']}, Event: {row['event_type']}")
            print(f"  Source: {row['source_system']} → Dest: {row['destination_system']}")
            print(f"  Outcome: {row['outcome']}, Hash: {row['payload_hash'][:16]}...")
            print(f"  Timestamp: {row['created_at']}")
            print()

    await pool.close()


async def inspect_mappings():
    """Display learned field mappings."""
    pool = await asyncpg.create_pool(dsn=POSTGRES_DSN)
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM mapping_registry ORDER BY created_at DESC LIMIT 30")
        print("\n=== Field Mappings ===")
        for row in rows:
            print(f"Dept: {row['department']}")
            print(f"  {row['source_field']} → {row['target_field']} (confidence: {row['confidence']:.2f})")
            print()

    await pool.close()


async def inspect_conflicts():
    """Display conflict resolutions."""
    pool = await asyncpg.create_pool(dsn=POSTGRES_DSN)
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM conflict_log ORDER BY created_at DESC LIMIT 20")
        print("\n=== Conflict Resolutions ===")
        for row in rows:
            print(f"UBID: {row['ubid']}")
            print(f"  {row['source1']} vs {row['source2']}")
            print(f"  Policy: {row['policy']}, Resolution: {row['resolution']}")
            print(f"  Timestamp: {row['created_at']}")
            print()

    await pool.close()


async def main():
    try:
        if len(sys.argv) > 1:
            if sys.argv[1] == "audit":
                await inspect_audit()
            elif sys.argv[1] == "mappings":
                await inspect_mappings()
            elif sys.argv[1] == "conflicts":
                await inspect_conflicts()
            else:
                print("Usage: python inspect_db.py [audit|mappings|conflicts]")
        else:
            await inspect_audit()
            await inspect_mappings()
            await inspect_conflicts()
    except Exception as e:
        print(f"Error: {e}")
        print("Make sure Postgres is running: docker-compose up")


if __name__ == "__main__":
    asyncio.run(main())
