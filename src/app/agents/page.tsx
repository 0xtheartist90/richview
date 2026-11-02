import { KeyButton } from '@/components/agents/key-button';
import { ProjectSelect } from '@/components/agents/project-select';
import { LoadError } from '@/components/load-error';
import { domainHex } from '@/components/review/parts';
import { UnlockForm } from '@/components/unlock-form';
import { adminKey, adminOpen } from '@/lib/admin';
import { db } from '@/lib/supabase';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Agent = {
    id: string;
    name: string;
    is_lead: boolean;
    active: boolean;
    api_key_hash: string | null;
    webhook_url: string | null;
    project: { slug: string } | null;
    lead_projects: { project: { slug: string } | null }[];
};
type Project = { slug: string; name: string };

/** Every agent, grouped by project (leads first): its key, webhook and project. Richie only. */
export default async function AgentsPage() {
    if (!adminKey() || !(await adminOpen()))
        return (
            <div className='mx-auto max-w-sm pt-10'>
                <UnlockForm missing={!adminKey()} />
            </div>
        );

    const [agents, projects] = await Promise.all([
        db()
            .from('agents')
            .select(
                'id, name, is_lead, active, api_key_hash, webhook_url, project:projects!project_id(slug), lead_projects(project:projects(slug))'
            )
            .order('name'),
        db().from('projects').select('slug, name').is('archived_at', null).order('created_at')
    ]);
    if (agents.error) return <LoadError message={agents.error.message} />;
    if (projects.error) return <LoadError message={projects.error.message} />;
    const all = agents.data as unknown as Agent[];
    const list = projects.data as Project[];
    // An agent's group: the project it's in, else the one it leads.
    const home = (a: Agent) => a.project?.slug ?? a.lead_projects[0]?.project?.slug ?? null;
    const groups = [
        ...list.map((p) => ({ project: p as Project | null, agents: all.filter((a) => home(a) === p.slug) })),
        { project: null, agents: all.filter((a) => !home(a) || !list.some((p) => p.slug === home(a))) }
    ]
        .map((g) => ({ ...g, agents: [...g.agents].sort((a, b) => Number(b.is_lead) - Number(a.is_lead)) }))
        .filter((g) => g.agents.length);

    return (
        <div className='mx-auto flex w-full max-w-3xl flex-col gap-6'>
            <div>
                <h1 className='label-hud text-white/55'>agents</h1>
                <p className='text-muted-foreground mt-2 text-sm'>
                    Every agent has its own API key. A lead writes in its projects; any other agent in those of the lead
                    of its project. See docs/agent-api.md.
                </p>
            </div>

            {groups.map(({ project, agents: members }) => (
                <section
                    key={project?.slug ?? 'none'}
                    className='bg-card panel overflow-hidden rounded-2xl border shadow-[var(--shadow-card)]'>
                    <p className='flex items-center gap-2.5 border-b px-4 py-3 text-lg font-light'>
                        {project ? (
                            <>
                                <span
                                    className='size-1.5 rounded-full'
                                    style={{
                                        background: domainHex(project.slug),
                                        boxShadow: `0 0 10px 1px ${domainHex(project.slug)}b3`
                                    }}
                                />
                                {project.name}
                            </>
                        ) : (
                            <span className='text-amber-200'>No project yet: these can&apos;t write anywhere</span>
                        )}
                    </p>
                    <ul className='divide-y'>
                        {members.map((a) => (
                            <li key={a.id} className='flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center'>
                                <div className='min-w-0 flex-1'>
                                    <p className='flex items-center gap-2 font-medium'>
                                        {a.name}
                                        {a.is_lead && (
                                            <span className='rounded-md bg-[var(--brand)]/15 px-1.5 py-0.5 text-[11px] text-[var(--brand-2)]'>
                                                lead
                                            </span>
                                        )}
                                        {!a.active && <span className='text-xs text-rose-300'>inactive</span>}
                                    </p>
                                    <p className='label-xs mt-1 flex flex-wrap gap-x-4 text-white/45'>
                                        <span className={cn(a.api_key_hash && 'text-emerald-300')}>
                                            {a.api_key_hash ? 'key set' : 'no key'}
                                        </span>
                                        <span className={cn(a.webhook_url && 'text-emerald-300')}>
                                            {a.webhook_url ? 'webhook set' : 'no webhook'}
                                        </span>
                                    </p>
                                </div>
                                <div className='flex flex-wrap items-center gap-2'>
                                    {!a.is_lead && (
                                        <ProjectSelect
                                            agentId={a.id}
                                            current={a.project?.slug ?? null}
                                            projects={list}
                                        />
                                    )}
                                    <KeyButton agentId={a.id} name={a.name} hasKey={!!a.api_key_hash} />
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}
