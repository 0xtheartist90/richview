-- The statuses Richie works with: New, Planned, In progress, Review, Changes requested, Blocked, Approved (done).
-- 'idea' becomes 'new' (existing cards follow), 'blocked' is added. 'rejected' stays in the type for old rows but the
-- app no longer shows or sets it.
-- Run once in the Supabase SQL editor.

alter type task_status rename value 'idea' to 'new';
alter type task_status add value if not exists 'blocked' after 'changes_requested';
