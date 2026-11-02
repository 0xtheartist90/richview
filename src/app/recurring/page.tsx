import { LoadError } from '@/components/load-error';
import { RoutineButtons, RunNow } from '@/components/recurring/controls';
import { Avatar, domainHex } from '@/components/review/parts';
import { UnlockForm } from '@/components/unlock-form';
import { adminKey, adminOpen } from '@/lib/admin';
import { RECURRING_SELECT, type RecurringRow, dateIn, describe, dueOn } from '@/lib/recurring';
import { db } from '@/lib/supabase';
import { STATUS_META, type TaskStatus } from '@/lib/task-types';
import { cn } from '@/lib/utils';

import { Repeat } from 'lucide-react';

export const dynamic = 'force-dynamic';

/** The routines that turn into tasks by themselves, per project: when, for whom, and how the last run went. */
export default async function RecurringPage() {
    if (!adminKey() || !(await adminOpen()))
        return (
            <div className='mx-auto max-w-sm pt-10'>
                <UnlockForm missing={!adminKey()} />
            </div>
        );

    const [templates, projects] = await Promise.all([
        db().from('recurring').select(RECURRING_SELECT).order('created_at'),
        db().from('projects').select('slug, name').is('archived_at', null).order('created_at')
    ]);
    if (templates.error) return <LoadError message={templates.error.message} />;
    if (projects.error) return <LoadError message={projects.error.message} />;
    const all = templates.data as RecurringRow[];
    const groups = (projects.data as { slug: string; name: string }[])
        .map((p) => ({ project: p, items: all.filter((r) => r.project?.slug === p.slug) }))
        .filter((g) => g.items.length);

    return (
        <div className='mx-auto flex w-full max-w-3xl flex-col gap-6'>
            <div className='flex flex-wrap items-end gap-3'>
                <div className='min-w-0 flex-1'>
                    <h1 className='label-hud text-white/55'>recurring</h1>
                    <p className='text-muted-foreground mt-2 text-sm'>
                        Every morning (06:00 Bangkok) these turn into tasks on the board. A routine waits while its last
                        task is still open. Agents add them through the API (docs/agent-api.md).
                    </p>
                </div>
                <RunNow />
            </div>

            {groups.length ? (
                groups.map(({ project, items }) => (
                    <section
                        key={project.slug}
                        className='bg-card panel overflow-hidden rounded-2xl border shadow-[var(--shadow-card)]'>
                        <p className='flex items-center gap-2.5 border-b px-4 py-3 text-lg font-light'>
                            <span
                                className='size-1.5 rounded-full'
                                style={{
                                    background: domainHex(project.slug),
                                    boxShadow: `0 0 10px 1px ${domainHex(project.slug)}b3`
                                }}
                            />
                            {project.name}
                        </p>
                        <ul className='divide-y'>
                            {items.map((r) => {
                                const today = dateIn(r.timezone);
                                const madeToday = r.last_run_on === today && r.last_skipped_on !== today;

                                return (
                                    <li
                                        key={r.id}
                                        className={cn(
                                            'flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center',
                                            !r.active && 'opacity-55'
                                        )}>
                                        <div className='min-w-0 flex-1'>
                                            <p className='flex items-center gap-2 font-medium'>
                                                <Repeat className='size-4 shrink-0 text-[var(--brand)]' />
                                                <span className='truncate'>{r.title}</span>
                                                {!r.active && <span className='text-xs text-white/45'>paused</span>}
                                            </p>
                                            <p className='mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55'>
                                                <span className='text-white/80'>{describe(r)}</span>
                                                {r.owner && (
                                                    <span className='inline-flex items-center gap-1.5'>
                                                        <Avatar name={r.owner.name} className='size-4 text-[9px]' />
                                                        {r.owner.name}
                                                    </span>
                                                )}
                                                {r.reviewer && <span>reviewer · {r.reviewer.name}</span>}
                                                <span>
                                                    starts in {STATUS_META[r.start_status as TaskStatus]?.label}
                                                </span>
                                            </p>
                                            <p className='label-xs mt-1.5 text-white/40'>
                                                {r.last_skipped_on === today
                                                    ? 'skipped today: the last one is still open'
                                                    : madeToday
                                                      ? 'made today'
                                                      : r.active && dueOn(r, today)
                                                        ? 'due today'
                                                        : r.last_run_on
                                                          ? `last made ${r.last_run_on}`
                                                          : 'not run yet'}
                                                {r.allow_overlap && ' · overlap allowed'}
                                            </p>
                                        </div>
                                        <RoutineButtons id={r.id} title={r.title} active={r.active} />
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                ))
            ) : (
                <p className='text-muted-foreground py-10 text-center text-sm'>
                    No recurring tasks yet. Agents add them with POST /api/agent/recurring.
                </p>
            )}
        </div>
    );
}
