-- Run once against jigtools schema after pulling this change.
-- 1. Add Process / Machine to the jig/tool master list
ALTER TABLE jigtools.jig_tools ADD COLUMN IF NOT EXISTS process VARCHAR(50);
ALTER TABLE jigtools.jig_tools ADD COLUMN IF NOT EXISTS machine VARCHAR(50);

-- 2. Widen lot_number to fit longer OEM-style codes used in bulk import
ALTER TABLE jigtools.jig_tool_lots ALTER COLUMN lot_number TYPE VARCHAR(50);

-- 3. Drop replenish/defect tracking (no longer used — simplified to plain qty in/out)
ALTER TABLE jigtools.jig_tool_lots DROP COLUMN IF EXISTS replenish_limit;
ALTER TABLE jigtools.jig_tool_lots DROP COLUMN IF EXISTS total_damaged;
ALTER TABLE jigtools.jig_tool_lots DROP COLUMN IF EXISTS total_missing;

ALTER TABLE jigtools.return_records DROP COLUMN IF EXISTS good_qty;
ALTER TABLE jigtools.return_records DROP COLUMN IF EXISTS damaged_qty;
ALTER TABLE jigtools.return_records DROP COLUMN IF EXISTS missing_qty;
ALTER TABLE jigtools.return_records DROP COLUMN IF EXISTS resolved;
ALTER TABLE jigtools.return_records DROP COLUMN IF EXISTS resolved_at;
ALTER TABLE jigtools.return_records DROP COLUMN IF EXISTS resolved_good_qty;
ALTER TABLE jigtools.return_records DROP COLUMN IF EXISTS resolved_damaged_qty;
ALTER TABLE jigtools.return_records DROP COLUMN IF EXISTS resolved_by;
