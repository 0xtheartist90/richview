-- Every agent gets its own API key (agents.api_key_hash, from 0001). Which projects an agent may write to:
-- a lead its own (lead_projects), any other agent those of the lead of its project (agents.project_id).
-- Run once in the Supabase SQL editor (after 0003). Safe to run on the live app: it only adds.

alter table agents add column if not exists project_id uuid references projects (id) on delete set null;

-- Who belongs where, as far as known. Moni, Rappa, Neo, Trinity, Tank and Dozer are set on the Agents page.
update agents set project_id = p.id
from projects p
where agents.project_id is null
  and (
    (p.slug = 'sre' and agents.name in ('Morpheus', 'Air', 'Obi', 'Fin', 'Dash', 'Mouse'))
    or (p.slug = 'virtuo' and agents.name = 'The Oracle')
    or (p.slug = 'good-life' and agents.name in ('Good Life', 'GL Content', 'GL Visuals', 'GL Ads', 'GL Leads', 'GL Finance'))
  );

create index if not exists agents_project on agents (project_id);
