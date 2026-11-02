-- RichView: projects, agents, tasks, comments and the decision feed agents read back.
-- Run once in the Supabase SQL editor (or `supabase db push`).
-- Every table has RLS on and no policies: only the server (service role key) reads and writes.

create extension if not exists pgcrypto;

create type task_status as enum (
    'idea', 'planned', 'in_progress', 'review', 'approved', 'changes_requested', 'rejected'
);
create type task_priority as enum ('urgent', 'high', 'normal', 'low');
create type task_effort as enum ('S', 'M', 'L');
create type task_impact as enum ('revenue', 'time_saved', 'quality');
create type decision_action as enum ('approved', 'changes_requested', 'rejected', 'started');

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

/** A workspace above the tasks (SRE first, more later). Domains are the project's own labels. */
create table projects (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
    name text not null,
    domains text[] not null default '{}',
    wip_limit int not null default 3 check (wip_limit > 0),
    archived_at timestamptz,
    created_at timestamptz not null default now()
);

/**
 * An AI agent (Morpheus, Air, ...). It calls the API with its own key; only the key's SHA-256 is stored.
 * After each decision on its task, RichView POSTs to webhook_url (optional) signed with webhook_secret.
 */
create table agents (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    api_key_hash text unique,
    webhook_url text,
    webhook_secret text,
    active boolean not null default true,
    created_at timestamptz not null default now()
);

create table tasks (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects (id) on delete cascade,
    title text not null check (char_length(title) between 1 and 200),
    summary text check (char_length(summary) <= 300),
    description text,
    status task_status not null default 'review',
    priority task_priority not null default 'normal',
    domain text,
    owner_id uuid references agents (id) on delete set null,
    created_by uuid references agents (id) on delete set null,
    impact task_impact,
    effort task_effort,
    preview_url text,
    images text[] not null default '{}',
    before text,
    after text,
    context text,
    /** Choices the agent offers Richie, e.g. [{"id": "a", "label": "Ship as is"}]. */
    options jsonb,
    reviewed_at timestamptz,
    /** The Airtable record it came from (SRE Board migration). */
    airtable_id text unique,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index tasks_project_status on tasks (project_id, status);
create index tasks_owner on tasks (owner_id);
create trigger tasks_updated_at before update on tasks for each row execute function set_updated_at();

/** Richie (agent_id null) or an agent. */
create table comments (
    id uuid primary key default gen_random_uuid(),
    task_id uuid not null references tasks (id) on delete cascade,
    agent_id uuid references agents (id) on delete set null,
    body text not null check (char_length(body) between 1 and 5000),
    created_at timestamptz not null default now()
);
create index comments_task on comments (task_id, created_at);

/**
 * Richie's decisions, in order. Agents poll this (`?after=<seq>`) or get it by webhook;
 * delivered_at is set once the webhook answered 2xx.
 */
create table decisions (
    seq bigint generated always as identity primary key,
    task_id uuid not null references tasks (id) on delete cascade,
    agent_id uuid references agents (id) on delete set null,
    action decision_action not null,
    comment text,
    option_id text,
    delivered_at timestamptz,
    created_at timestamptz not null default now()
);
create index decisions_agent on decisions (agent_id, seq);

alter table projects enable row level security;
alter table agents enable row level security;
alter table tasks enable row level security;
alter table comments enable row level security;
alter table decisions enable row level security;

-- Preview images and before/after shots. Public read so cards can show them; uploads go through the server.
insert into storage.buckets (id, name, public) values ('previews', 'previews', true) on conflict (id) do nothing;

-- Starting data: the SRE project and the current agents (no keys yet; they're issued from the app).
insert into projects (slug, name, domains) values
    ('sre', 'SRE', array['planning', 'onboarding', 'dashboard', 'finance', 'reports', 'platforms', 'ops']);
insert into agents (name) values ('Morpheus'), ('Air'), ('Obi'), ('Dash');
