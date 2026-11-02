-- Routines as a cockpit: a time of day in the schedule (one or more), intervals of minutes or hours, and a run
-- history of their own. Agents report each run (ok or failed); RichView knows from the schedule when one is due,
-- and only a failed or late run becomes a card on Review.
-- Run once in the Supabase SQL editor (after 0005). Safe to run on the live app: it only adds.

-- Every N minutes (every_minutes), around the clock: "every 10 min", "every 4 hours".
alter type recur_every add value if not exists 'intraday';

/** Times of day (HH:MM, in the routine's timezone) it runs; empty = some time that day. */
alter table recurring add column if not exists times text[] not null default '{}';
alter table recurring add column if not exists every_minutes int check (every_minutes between 5 and 1440);
/** How long after a due time a run may still come before it counts as late (default: 60 min, or the interval). */
alter table recurring add column if not exists grace_minutes int check (grace_minutes between 0 and 1440);

do $$ begin
    create type run_status as enum ('ok', 'failed', 'missed');
exception when duplicate_object then null; end $$;

/** One run of a routine: reported by its agent (ok, failed), or noted by RichView when one didn't come (missed). */
create table if not exists routine_runs (
    id uuid primary key default gen_random_uuid(),
    recurring_id uuid not null references recurring (id) on delete cascade,
    status run_status not null,
    /** The due time it answers, when known. */
    due_at timestamptz,
    ran_at timestamptz not null default now(),
    note text check (char_length(note) <= 5000),
    agent_id uuid references agents (id) on delete set null,
    /** The Review card it raised (failed or missed). */
    task_id uuid references tasks (id) on delete set null,
    created_at timestamptz not null default now()
);
create index if not exists routine_runs_recent on routine_runs (recurring_id, ran_at desc);
-- A missed due time is noted once.
create unique index if not exists routine_runs_missed_once on routine_runs (recurring_id, due_at) where status = 'missed';
alter table routine_runs enable row level security;
