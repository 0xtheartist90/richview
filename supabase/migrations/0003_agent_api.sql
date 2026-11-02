-- The agent API: lead agents (one per project) hold the API key and write the cards; every other agent is only a
-- card's owner or reviewer, so Richie still sees whose ticket it is. Adds the peer check before Richie's review.
-- Run once in the Supabase SQL editor (after 0001 and 0002). Safe to run on the live app: it only adds.

-- Leads, and the projects each one writes in.
alter table agents add column if not exists is_lead boolean not null default false;

create table if not exists lead_projects (
    agent_id uuid not null references agents (id) on delete cascade,
    project_id uuid not null references projects (id) on delete cascade,
    primary key (agent_id, project_id)
);
alter table lead_projects enable row level security;

insert into projects (slug, name) values ('virtuo', 'Virtuo'), ('good-life', 'Good Life') on conflict (slug) do nothing;

insert into agents (name) values
    ('Moni'), ('Rappa'), ('The Oracle'), ('Good Life'), ('GL Content'), ('GL Visuals'), ('GL Ads'), ('GL Leads'),
    ('GL Finance'), ('Neo'), ('Trinity'), ('Tank'), ('Dozer')
on conflict (name) do nothing;

update agents set is_lead = true where name in ('Morpheus', 'The Oracle', 'Good Life');

insert into lead_projects (agent_id, project_id)
select a.id, p.id
from agents a
join projects p on (a.name, p.slug) in (('Morpheus', 'sre'), ('The Oracle', 'virtuo'), ('Good Life', 'good-life'))
on conflict do nothing;

-- Peer check: another agent looks at the work before it reaches Richie.
alter type task_status add value if not exists 'peer_review' before 'review';

alter table tasks add column if not exists reviewer_id uuid references agents (id) on delete set null;
alter table tasks add column if not exists peer_checked_at timestamptz;
alter table tasks drop constraint if exists tasks_reviewer_not_owner;
alter table tasks add constraint tasks_reviewer_not_owner check (reviewer_id is null or reviewer_id <> owner_id);

create index if not exists tasks_updated on tasks (updated_at);
