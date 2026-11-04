-- What a routine actually does, so Richie can see and steer it: its steps, its checks and its definition of done, what
-- each check gave on a run, the changes Richie asks for, and a history of what changed in the routine.
-- Run once in the Supabase SQL editor (after 0006). Safe to run on the live app: it only adds.

alter table recurring add column if not exists steps text[] not null default '{}';
alter table recurring add column if not exists checks text[] not null default '{}';
alter table recurring add column if not exists definition_of_done text check (char_length(definition_of_done) <= 2000);

/** What each check gave on this run: [{ "check": "…", "ok": true, "note": "…" }]. */
alter table routine_runs add column if not exists check_results jsonb not null default '[]';

/** A change Richie asks for on a routine; its owner carries it out and answers. */
create table if not exists routine_requests (
    id uuid primary key default gen_random_uuid(),
    recurring_id uuid not null references recurring (id) on delete cascade,
    body text not null check (char_length(body) between 1 and 2000),
    status text not null default 'open' check (status in ('open', 'done', 'declined')),
    reply text check (char_length(reply) <= 2000),
    resolved_by uuid references agents (id) on delete set null,
    resolved_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists routine_requests_recent on routine_requests (recurring_id, created_at desc);
create index if not exists routine_requests_open on routine_requests (created_at) where status = 'open';
alter table routine_requests enable row level security;

/** What changed in a routine's steps, checks, definition of done or description: who, when, before and after. */
create table if not exists routine_changes (
    id uuid primary key default gen_random_uuid(),
    recurring_id uuid not null references recurring (id) on delete cascade,
    field text not null,
    before jsonb,
    after jsonb,
    agent_id uuid references agents (id) on delete set null,
    created_at timestamptz not null default now()
);
create index if not exists routine_changes_recent on routine_changes (recurring_id, created_at desc);
alter table routine_changes enable row level security;
