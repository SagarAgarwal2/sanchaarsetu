/*
  # Allow anon access for operator dashboard

  This is an internal operator tool with no public auth.
  All tables need to be readable and writable by the anon role
  so the simulator and dashboard work without login.

  Changes:
  - Add anon SELECT/INSERT/UPDATE policies to all tables
*/

CREATE POLICY "Anon users can view departments"
  ON departments FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can update departments"
  ON departments FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Anon users can view businesses"
  ON businesses FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can insert businesses"
  ON businesses FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon users can view propagation_events"
  ON propagation_events FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can insert propagation_events"
  ON propagation_events FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon users can view conflicts"
  ON conflicts FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can insert conflicts"
  ON conflicts FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon users can update conflicts"
  ON conflicts FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Anon users can view schema_mappings"
  ON schema_mappings FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can insert schema_mappings"
  ON schema_mappings FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon users can update schema_mappings"
  ON schema_mappings FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Anon users can view business_departments"
  ON business_departments FOR SELECT TO anon USING (true);
