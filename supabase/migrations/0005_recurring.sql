-- Recurring work: a template per routine (the S1 checklist every day, the payout list on Saturday, ...). Every
-- morning a cron turns the templates that are due into ordinary tasks. By default no new task while the previous
-- one is still open (allow_overlap = false); that day is then marked as skipped.
-- Run once in the Supabase SQL editor (after 0004). Safe to run on the live app: it only adds.

do $$ begin
    create type recur_every as enum ('day', 'week', 'month', 'n_days');
exception when duplicate_object then null; end $$;

create table if not exists recurring (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects (id) on delete cascade,
    title text not null check (char_length(title) between 1 and 200),
    summary text check (char_length(summary) <= 300),
    description text,
    context text,
    priority task_priority not null default 'normal',
    domain text,
    impact task_impact,
    effort task_effort,
    /** Where each new task starts. */
    start_status task_status not null default 'planned',
    owner_id uuid not null references agents (id) on delete cascade,
    reviewer_id uuid references agents (id) on delete set null,
    created_by uuid references agents (id) on delete set null,

    /** day: every day. week: on `weekdays` (0 = Sunday … 6 = Saturday). month: on `month_day` (the month's last
        day when it has fewer). n_days: every `interval_days` days from `anchor_on`. */
    every recur_every not null,
    weekdays smallint[] not null default '{}',
    month_day smallint check (month_day between 1 and 31),
    interval_days smallint check (interval_days between 2 and 365),
    anchor_on date not null default current_date,
    /** The calendar the days are counted in. */
    timezone text not null default 'Asia/Bangkok',

    allow_overlap boolean not null default false,
    active boolean not null default true,
    last_run_on date,
    last_task_id uuid references tasks (id) on delete set null,
    last_skipped_on date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    check (start_status in ('new', 'planned', 'in_progress')),
    check (reviewer_id is null or reviewer_id <> owner_id),
    check ((every = 'week') = (cardinality(weekdays) > 0)),
    check ((every = 'month') = (month_day is not null)),
    check ((every = 'n_days') = (interval_days is not null))
);
create index if not exists recurring_project on recurring (project_id);
drop trigger if exists recurring_updated_at on recurring;
create trigger recurring_updated_at before update on recurring for each row execute function set_updated_at();
alter table recurring enable row level security;

/** The template a task was made from (a repeat icon on its card). */
alter table tasks add column if not exists recurring_id uuid references recurring (id) on delete set null;
