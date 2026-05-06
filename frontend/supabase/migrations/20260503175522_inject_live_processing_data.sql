/*
  # Inject live processing data

  Seeds the system with realistic in-progress data:
  - 60 recent propagation events across all outcomes
  - 6 open/pending conflicts requiring resolution
  - Schema mappings in various states
  - Updated department sync timestamps and record counts
*/

DO $$
DECLARE
  dept_dfb uuid; dept_sea uuid; dept_dol uuid; dept_kfes uuid;
  dept_bbmp uuid; dept_ctd uuid; dept_kpcb uuid; dept_dis uuid;
  ubids text[] := ARRAY[
    'UBID-KA-2024-001847','UBID-KA-2024-002341','UBID-KA-2024-003892',
    'UBID-KA-2024-005123','UBID-KA-2024-006789','UBID-KA-2024-008234',
    'UBID-KA-2024-009012','UBID-KA-2024-010345'
  ];
  outcomes text[] := ARRAY['success','success','success','success','success','success','success',
                            'failure','failure','conflict','conflict','duplicate','pending','dlq'];
  etypes text[] := ARRAY['address_update','signatory_update','license_renewal','gstin_update',
                         'compliance_status','noc_issued','registration_new','owner_update',
                         'employee_count_update','pan_update','trade_license_update','fire_noc_renewal'];
  sources text[] := ARRAY['SWS','SWS','SWS','DFB','SEA','DOL','CTD','BBMP'];
  dests   text[] := ARRAY['DFB','SEA','DOL','SWS','SWS','SWS','SWS','SWS'];
  i int; outcome_val text; src text; dst text; ubid_val text;
BEGIN
  SELECT id INTO dept_dfb FROM departments WHERE code='DFB';
  SELECT id INTO dept_sea FROM departments WHERE code='SEA';
  SELECT id INTO dept_dol FROM departments WHERE code='DOL';
  SELECT id INTO dept_kfes FROM departments WHERE code='KFES';
  SELECT id INTO dept_bbmp FROM departments WHERE code='BBMP';
  SELECT id INTO dept_ctd FROM departments WHERE code='CTD';
  SELECT id INTO dept_kpcb FROM departments WHERE code='KPCB';
  SELECT id INTO dept_dis FROM departments WHERE code='DIS';

  -- Inject 60 events spread across the last 2 hours
  FOR i IN 1..60 LOOP
    outcome_val := outcomes[1 + (i % array_length(outcomes,1))];
    src := sources[1 + (i % array_length(sources,1))];
    dst := dests[1 + (i % array_length(dests,1))];
    ubid_val := ubids[1 + (i % array_length(ubids,1))];

    INSERT INTO propagation_events (
      ubid, event_type, source_system, destination_system,
      payload_hash, idempotency_key, outcome, conflict_flag,
      resolution_applied, retry_count, error_message, propagation_ms,
      created_at
    ) VALUES (
      ubid_val,
      etypes[1 + (i % array_length(etypes,1))],
      src, dst,
      'sha256:' || md5(i::text || ubid_val),
      ubid_val || ':' || etypes[1 + (i % array_length(etypes,1))] || ':live:' || i::text,
      outcome_val,
      outcome_val = 'conflict',
      CASE WHEN outcome_val = 'conflict' THEN
        CASE WHEN i % 3 = 0 THEN 'sws_wins' WHEN i % 3 = 1 THEN 'manual_review' ELSE 'last_write_wins' END
      ELSE NULL END,
      CASE WHEN outcome_val = 'failure' THEN (1 + i % 4)
           WHEN outcome_val = 'dlq' THEN 5 ELSE 0 END,
      CASE WHEN outcome_val = 'failure' THEN 'Connection timeout to ' || dst || ' API after 30s'
           WHEN outcome_val = 'dlq' THEN 'Max retries exceeded. Department API unreachable.' ELSE NULL END,
      CASE WHEN outcome_val IN ('success','duplicate') THEN (80 + (i * 37) % 1920) ELSE NULL END,
      now() - ((60 - i) * interval '2 minutes')
    );
  END LOOP;

  -- Insert 6 realistic open conflicts
  INSERT INTO conflicts (ubid, field_name, sws_value, dept_value, source_department_id, resolution_policy, status) VALUES
  ('UBID-KA-2024-001847', 'registered_address',
   '14, Industrial Area, Peenya, Bangalore - 560058',
   '14 Industrial Area Peenya BLR 560058',
   dept_dfb, 'sws_wins', 'open'),
  ('UBID-KA-2024-002341', 'signatory_name',
   'Ramesh Kumar Jain',
   'R.K. Jain',
   dept_sea, 'manual_review', 'pending_review'),
  ('UBID-KA-2024-003892', 'gstin',
   '29AABCV1234F1Z5',
   '29AABCV1234F1Z5-OLD',
   dept_ctd, 'manual_review', 'pending_review'),
  ('UBID-KA-2024-005123', 'pan_number',
   'AABCV1234F',
   'AABCV1234F-UNVERIFIED',
   dept_dol, 'manual_review', 'open'),
  ('UBID-KA-2024-006789', 'employee_count',
   '247',
   '193',
   dept_bbmp, 'last_write_wins', 'open'),
  ('UBID-KA-2024-009012', 'trade_name',
   'Mysuru Silk Exports Ltd',
   'Mysuru Silk Exports',
   dept_kfes, 'sws_wins', 'open');

  -- Update department sync timestamps + record counts to show active processing
  UPDATE departments SET last_sync_at = now() - interval '3 minutes',  records_synced = records_synced + 47  WHERE code = 'DFB';
  UPDATE departments SET last_sync_at = now() - interval '8 minutes',  records_synced = records_synced + 31  WHERE code = 'SEA';
  UPDATE departments SET last_sync_at = now() - interval '1 minute',   records_synced = records_synced + 62  WHERE code = 'DOL';
  UPDATE departments SET last_sync_at = now() - interval '12 minutes', records_synced = records_synced + 18  WHERE code = 'KFES';
  UPDATE departments SET last_sync_at = now() - interval '2 minutes',  records_synced = records_synced + 89  WHERE code = 'BBMP';
  UPDATE departments SET last_sync_at = now() - interval '5 minutes',  records_synced = records_synced + 24  WHERE code = 'CTD';
  UPDATE departments SET last_sync_at = now() - interval '47 minutes', records_synced = records_synced + 11  WHERE code = 'KPCB';
  UPDATE departments SET last_sync_at = now() - interval '2 hours',    records_synced = records_synced + 5   WHERE code = 'DIS';

  -- Set DIS to degraded and KPCB to show recent activity
  UPDATE departments SET status = 'degraded' WHERE code = 'DIS';

END $$;
