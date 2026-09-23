-- Run once against jigtools schema after pulling this change.
-- Records who physically returns a jig/tool (captured when the return is
-- submitted), separate from the technician who originally borrowed it.
ALTER TABLE jigtools.borrow_records
  ADD COLUMN IF NOT EXISTS return_technician_id VARCHAR(20)
  REFERENCES jigtools.technicians(technician_id);
