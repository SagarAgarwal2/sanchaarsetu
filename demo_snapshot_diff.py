import asyncio
from app.detection import ChangeDetector

class MockPgPool:
    """Mock database pool to intercept inserts and print them for the demo."""
    class MockConnection:
        async def execute(self, query, dept_name, event_type, payload):
            print(f"  -> 📥 DATABASE INSERT: change_events")
            print(f"  -> 🏢 Department: {dept_name}")
            print(f"  -> 📦 Emitted Delta Payload: {payload}\n")
            
    def acquire(self):
        class ContextManager:
            async def __aenter__(self): return MockPgPool.MockConnection()
            async def __aexit__(self, exc_type, exc_val, exc_tb): pass
        return ContextManager()

async def main():
    print("="*50)
    print("=== 🔍 SanchaarSetu Change Detection Demo ===")
    print("="*50)
    
    detector = ChangeDetector(pg_pool=MockPgPool())
    dept = "factories"
    
    print("\n[Step 1] Initial Snapshot Fetched (No prior state)")
    print("Fetching 2 businesses from legacy Factories DB...")
    snapshot_1 = [
        {"ubid": "UBID-111", "registered_address": "123 Old Road", "proprietor": "Raj"},
        {"ubid": "UBID-222", "registered_address": "456 Market St", "proprietor": "Priya"}
    ]
    
    # Both are new to the system, so both will be emitted as "changes"
    await detector._process_snapshot(dept, snapshot_1)
    
    print("\n" + "-"*50)
    print("\n[Step 2] Second Snapshot Fetched (Time passes...)")
    print("Raj updates his address, but Priya stays exactly the same.")
    
    snapshot_2 = [
        # Raj's address changed
        {"ubid": "UBID-111", "registered_address": "999 New Road", "proprietor": "Raj"},
        # Priya is untouched
        {"ubid": "UBID-222", "registered_address": "456 Market St", "proprietor": "Priya"}
    ]
    
    # The detector should intelligently diff this and ONLY emit the changed field for Raj
    await detector._process_snapshot(dept, snapshot_2)
    
    print("="*50)

if __name__ == "__main__":
    asyncio.run(main())
