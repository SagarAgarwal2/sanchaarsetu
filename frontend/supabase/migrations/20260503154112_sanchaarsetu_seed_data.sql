/*
  # SanchaarSetu Seed Data

  Populates the database with realistic mock data for the demo:
  - 8 Karnataka department systems
  - 6 sample businesses with UBIDs
  - Sample propagation events, conflicts, and schema mappings
*/

-- Seed departments
INSERT INTO departments (name, code, domain, ingestion_tier, connection_type, status, poll_interval_minutes, last_sync_at, records_synced) VALUES
  ('Department of Factories & Boilers', 'DFB', 'factories', 1, 'webhook', 'active', NULL, now() - interval '2 minutes', 12847),
  ('Shop & Establishment Authority', 'SEA', 'shop_establishments', 1, 'webhook', 'active', NULL, now() - interval '5 minutes', 34291),
  ('Department of Labour', 'DOL', 'labour', 2, 'polling', 'active', 5, now() - interval '4 minutes', 8934),
  ('Karnataka Fire & Emergency Services', 'KFES', 'fire_safety', 2, 'polling', 'degraded', 10, now() - interval '18 minutes', 5612),
  ('BBMP (Commercial Properties)', 'BBMP', 'municipal', 3, 'snapshot', 'active', NULL, now() - interval '1 hour', 21043),
  ('Commercial Taxes Department', 'CTD', 'taxation', 1, 'webhook', 'active', NULL, now() - interval '1 minute', 67821),
  ('Karnataka Pollution Control Board', 'KPCB', 'environment', 2, 'polling', 'active', 15, now() - interval '12 minutes', 3291),
  ('Directorate of Industrial Safety', 'DIS', 'industrial_safety', 3, 'snapshot', 'offline', NULL, now() - interval '3 hours', 1847)
ON CONFLICT (code) DO NOTHING;

-- Seed businesses
INSERT INTO businesses (ubid, business_name, pan, gstin, registered_address, owner_name, status, sws_id) VALUES
  ('UBID-KA-2024-001847', 'M/s Bangalore Textiles Pvt Ltd', 'AABCB1234F', '29AABCB1234F1Z5', '14, Industrial Area, Peenya, Bangalore - 560058', 'Ramesh Kumar Jain', 'active', 'SWS-2024-78234'),
  ('UBID-KA-2024-002341', 'Sri Venkateshwara Engineering Works', 'BCDVE5678G', '29BCDVE5678G1Z2', '8/A, KIADB Industrial Estate, Bommasandra, Bangalore - 560099', 'Venkata Reddy', 'active', 'SWS-2024-81923'),
  ('UBID-KA-2024-003892', 'Kaveri Food Products LLP', 'AAECK7890H', '29AAECK7890H1Z8', '23, Rajajinagar Industrial Area, Bangalore - 560010', 'Meenakshi Sundaram', 'active', 'SWS-2024-90012'),
  ('UBID-KA-2024-005123', 'Karnataka Chemicals & Pharma Ltd', 'AAFKC2345J', '29AAFKC2345J1Z1', '45, Whitefield Industrial Zone, Bangalore - 560066', 'Dr. Suresh Patel', 'active', 'SWS-2024-95678'),
  ('UBID-KA-2024-006789', 'Green Valley Waste Management', 'AAGVW8901K', '29AAGVW8901K1Z4', '12, Electronic City Phase 2, Bangalore - 560100', 'Anitha Krishnamurthy', 'active', 'SWS-2024-98345'),
  ('UBID-KA-2024-008234', 'Deccan Auto Components', 'AAHDA4567L', NULL, '67, Tumkur Road Industrial Corridor, Bangalore - 560073', 'Mohammed Farooq', 'pending_ubid', 'SWS-2024-99012')
ON CONFLICT (ubid) DO NOTHING;

-- Seed propagation events
WITH dept_ids AS (
  SELECT id, code FROM departments
), biz_ids AS (
  SELECT ubid FROM businesses
)
INSERT INTO propagation_events (ubid, event_type, source_system, destination_system, payload_hash, idempotency_key, outcome, conflict_flag, resolution_applied, retry_count, propagation_ms)
SELECT * FROM (VALUES
  ('UBID-KA-2024-001847', 'address_update', 'SWS', 'DFB', 'sha256:a3f4b2c1d8e9f0a1', 'UBID-KA-2024-001847:address_update:1746230400', 'success', false, NULL, 0, 234),
  ('UBID-KA-2024-001847', 'address_update', 'SWS', 'SEA', 'sha256:a3f4b2c1d8e9f0a1', 'UBID-KA-2024-001847:address_update:1746230401', 'success', false, NULL, 0, 189),
  ('UBID-KA-2024-001847', 'address_update', 'SWS', 'DOL', 'sha256:a3f4b2c1d8e9f0a1', 'UBID-KA-2024-001847:address_update:1746230402', 'success', false, NULL, 0, 412),
  ('UBID-KA-2024-001847', 'address_update', 'SWS', 'KFES', 'sha256:a3f4b2c1d8e9f0a1', 'UBID-KA-2024-001847:address_update:1746230403', 'failure', false, NULL, 3, NULL),
  ('UBID-KA-2024-002341', 'signatory_update', 'SEA', 'SWS', 'sha256:b4c5d6e7f8a9b0c1', 'UBID-KA-2024-002341:signatory_update:1746231000', 'conflict', true, 'manual_review', 0, NULL),
  ('UBID-KA-2024-003892', 'license_renewal', 'SWS', 'DFB', 'sha256:c5d6e7f8a9b0c1d2', 'UBID-KA-2024-003892:license_renewal:1746231600', 'success', false, NULL, 0, 156),
  ('UBID-KA-2024-004111', 'gstin_update', 'CTD', 'SWS', 'sha256:d6e7f8a9b0c1d2e3', 'UBID-KA-2024-004111:gstin_update:1746232200', 'success', false, NULL, 0, 98),
  ('UBID-KA-2024-005123', 'compliance_status', 'KPCB', 'SWS', 'sha256:e7f8a9b0c1d2e3f4', 'UBID-KA-2024-005123:compliance_status:1746232800', 'success', false, NULL, 0, 723),
  ('UBID-KA-2024-006789', 'noc_issued', 'KFES', 'SWS', 'sha256:f8a9b0c1d2e3f4a5', 'UBID-KA-2024-006789:noc_issued:1746233400', 'duplicate', false, NULL, 0, NULL),
  ('UBID-KA-2024-001847', 'owner_update', 'SWS', 'CTD', 'sha256:a9b0c1d2e3f4a5b6', 'UBID-KA-2024-001847:owner_update:1746234000', 'success', false, NULL, 0, 301),
  ('UBID-KA-2024-002341', 'address_update', 'DFB', 'SWS', 'sha256:b0c1d2e3f4a5b6c7', 'UBID-KA-2024-002341:address_update:1746234600', 'conflict', true, 'sws_wins', 0, 445),
  ('UBID-KA-2024-008234', 'registration_new', 'SWS', 'SEA', 'sha256:c1d2e3f4a5b6c7d8', 'UBID-KA-2024-008234:registration_new:1746235200', 'pending', false, NULL, 0, NULL),
  ('UBID-KA-2024-003892', 'address_update', 'SWS', 'BBMP', 'sha256:d2e3f4a5b6c7d8e9', 'UBID-KA-2024-003892:address_update:1746235800', 'success', false, NULL, 0, 1823),
  ('UBID-KA-2024-004567', 'license_new', 'SWS', 'DIS', 'sha256:e3f4a5b6c7d8e9f0', 'UBID-KA-2024-004567:license_new:1746236400', 'failure', false, NULL, 4, NULL),
  ('UBID-KA-2024-005123', 'signatory_update', 'SWS', 'DFB', 'sha256:f4a5b6c7d8e9f0a1', 'UBID-KA-2024-005123:signatory_update:1746237000', 'success', false, NULL, 0, 267)
) AS v(ubid, event_type, source_system, destination_system, payload_hash, idempotency_key, outcome, conflict_flag, resolution_applied, retry_count, propagation_ms)
ON CONFLICT (idempotency_key) DO NOTHING;

-- Seed conflicts
INSERT INTO conflicts (ubid, field_name, sws_value, dept_value, resolution_policy, status, winning_value, resolved_by, resolved_at)
VALUES
  ('UBID-KA-2024-002341', 'signatory_name', 'Venkata Reddy', 'V. Reddy & Sons', 'manual_review', 'pending_review', NULL, NULL, NULL),
  ('UBID-KA-2024-002341', 'registered_address', '8/A KIADB Industrial Estate, Bommasandra', 'Plot 8A, KIADB Bommasandra, Bangalore 560099', 'sws_wins', 'resolved', '8/A KIADB Industrial Estate, Bommasandra', 'system:sws_wins_policy', now() - interval '1 hour'),
  ('UBID-KA-2024-004890', 'pan_number', 'AAHDA4567L', 'AAHDA4567M', 'manual_review', 'pending_review', NULL, NULL, NULL),
  ('UBID-KA-2024-006789', 'owner_phone', '9845012345', '9845012346', 'last_write_wins', 'resolved', '9845012346', 'system:last_write_wins_policy', now() - interval '30 minutes')
ON CONFLICT DO NOTHING;

-- Seed schema mappings for DFB
WITH dfb AS (SELECT id FROM departments WHERE code = 'DFB')
INSERT INTO schema_mappings (department_id, sws_field, dept_field, confidence_score, status, version, reviewed_by, reviewed_at)
SELECT dfb.id, sws_field, dept_field, confidence_score, status, 1, reviewed_by, reviewed_at
FROM dfb, (VALUES
  ('business_name', 'factory_name', 0.962, 'confirmed', 'admin', now() - interval '2 days'),
  ('owner_name', 'occupier_name', 0.891, 'confirmed', 'admin', now() - interval '2 days'),
  ('registered_address', 'factory_address', 0.934, 'confirmed', 'admin', now() - interval '2 days'),
  ('gstin', 'gst_number', 0.978, 'auto_mapped', NULL, NULL),
  ('pan', 'pan_card_no', 0.956, 'auto_mapped', NULL, NULL),
  ('employee_count', 'total_workers', 0.823, 'confirmed', 'admin', now() - interval '2 days'),
  ('license_expiry', 'certificate_validity', 0.712, 'pending_review', NULL, NULL)
) AS m(sws_field, dept_field, confidence_score, status, reviewed_by, reviewed_at)
ON CONFLICT DO NOTHING;

-- Seed schema mappings for DOL
WITH dol AS (SELECT id FROM departments WHERE code = 'DOL')
INSERT INTO schema_mappings (department_id, sws_field, dept_field, confidence_score, status, version, reviewed_by, reviewed_at)
SELECT dol.id, sws_field, dept_field, confidence_score, status, 1, reviewed_by, reviewed_at
FROM dol, (VALUES
  ('business_name', 'establishment_name', 0.887, 'confirmed', 'admin', now() - interval '1 day'),
  ('owner_name', 'employer_name', 0.901, 'confirmed', 'admin', now() - interval '1 day'),
  ('registered_address', 'employer_address', 0.923, 'confirmed', 'admin', now() - interval '1 day'),
  ('employee_count', 'workforce_strength', 0.798, 'pending_review', NULL, NULL),
  ('pan', 'proprietor_pan', 0.934, 'auto_mapped', NULL, NULL)
) AS m(sws_field, dept_field, confidence_score, status, reviewed_by, reviewed_at)
ON CONFLICT DO NOTHING;

-- Seed schema mappings for BBMP
WITH bbmp AS (SELECT id FROM departments WHERE code = 'BBMP')
INSERT INTO schema_mappings (department_id, sws_field, dept_field, confidence_score, status, version, reviewed_by, reviewed_at)
SELECT bbmp.id, sws_field, dept_field, confidence_score, status, 1, reviewed_by, reviewed_at
FROM bbmp, (VALUES
  ('business_name', 'trade_name', 0.756, 'pending_review', NULL, NULL),
  ('registered_address', 'property_address', 0.869, 'confirmed', 'admin', now() - interval '3 days'),
  ('owner_name', 'applicant_full_name', 0.634, 'pending_review', NULL, NULL),
  ('gstin', 'taxpayer_gstin', 0.991, 'auto_mapped', NULL, NULL)
) AS m(sws_field, dept_field, confidence_score, status, reviewed_by, reviewed_at)
ON CONFLICT DO NOTHING;
