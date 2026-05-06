/*
  # Add direction and resolution_reason fields

  1. Changes
    - `propagation_events`: Add `direction` column ('sws_to_dept' | 'dept_to_sws') derived from source/dest systems.
      Backfill existing rows based on whether source_system = 'SWS'.
    - `conflicts`: Add `resolution_reason` text column for plain-language explanation of how/why a conflict was resolved.

  2. Notes
    - direction is NOT NULL with default 'dept_to_sws' for safety
    - resolution_reason is nullable — only populated on resolution
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'propagation_events' AND column_name = 'direction'
  ) THEN
    ALTER TABLE propagation_events
      ADD COLUMN direction text NOT NULL DEFAULT 'dept_to_sws'
        CHECK (direction IN ('sws_to_dept', 'dept_to_sws'));

    -- Backfill: if source_system = 'SWS' → sws_to_dept, otherwise dept_to_sws
    UPDATE propagation_events
      SET direction = CASE
        WHEN source_system = 'SWS' THEN 'sws_to_dept'
        ELSE 'dept_to_sws'
      END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conflicts' AND column_name = 'resolution_reason'
  ) THEN
    ALTER TABLE conflicts ADD COLUMN resolution_reason text;
  END IF;
END $$;
