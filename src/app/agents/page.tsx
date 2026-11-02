import { KeyButton } from '@/components/agents/key-button';
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
    lead_projects: { project: { slug: string; name: string } | null }[];
};

/** The agents: the leads (with their projects, key and webhook) on top, then everyone who can own a card. */
export default async function AgentsPage() {
    if (!adminKey() || !(await adminOpen()))
        return (
            <div className='mx-auto max-w-sm pt-10'>
                <UnlockForm missing={!adminKey()} />
            </div>
        );

    const { data, error } = await db()
        .from('agents')
        .select('id, name, is_lead, active, api_key_hash, webhook_url, lead_projects(project:projects(slug, name))')
        .order('name');
    if (error) return <LoadError message={error.message} />;
    const agents = data as unknown as Agent[];
    const leads = agents.filter((a) => a.is_lead);
    const others = agents.filter((a) => !a.is_lead);

    return (
        <div className='mx-auto flex w-full max-w-3xl flex-col gap-6'>
            <div>
                <h1 className='label-hud text-white/55'>agents</h1>
                <p className='text-muted-foreground mt-2 text-sm'>
                    Leads hold the API key and write the cards for their project; everyone else is a card&apos;s owner
                    or reviewer. See docs/agent-api.md.
                </p>
            </div>

            <section className='flex flex-col gap-3'>
                {leads.map((a) => (
                    <article
                        key={a.id}
                        className='bg-card panel flex flex-col gap-3 rounded-2xl border p-4 shadow-[var(--shadow-card)] sm:flex-row sm:items-center'>
                        <div className='min-w-0 flex-1'>
                            <p className='flex items-center gap-2 text-lg font-light'>
                                {a.name}
                                {!a.active && <span className='text-xs text-rose-300'>inactive</span>}
                            </p>
                            <div className='mt-2 flex flex-wrap gap-1.5'>
                                {a.lead_projects.map(
                                    ({ project: p }) =>
                                        p && (
                                            <span
                                                key={p.slug}
                                                className='inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-xs'>
                                                <span
                                                    className='size-1.5 rounded-full'
                                                    style={{ background: domainHex(p.slug) }}
                                                />
                                                {p.name}
                                            </span>
                                        )
                                )}
                            </div>
                            <p className='label-xs mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-white/45'>
                                <span className={cn(a.api_key_hash && 'text-emerald-300')}>
                                    {a.api_key_hash ? 'key set' : 'no key'}
                                </span>
                                <span className={cn(a.webhook_url && 'text-emerald-300')}>
                                    {a.webhook_url ? 'webhook set' : 'no webhook (polls)'}
                                </span>
                            </p>
                        </div>
                        <KeyButton agentId={a.id} name={a.name} hasKey={!!a.api_key_hash} />
                    </article>
                ))}
            </section>

            <section className='bg-card panel rounded-2xl border p-4 shadow-[var(--shadow-card)]'>
                <p className='label-hud mb-3'>owners</p>
                <div className='flex flex-wrap gap-1.5'>
                    {others.map((a) => (
                        <span
                            key={a.id}
                            className={cn(
                                'rounded-full border border-white/10 px-2.5 py-1 text-sm',
                                !a.active && 'opacity-40'
                            )}>
                            {a.name}
                        </span>
                    ))}
                </div>
            </section>
        </div>
    );
}
