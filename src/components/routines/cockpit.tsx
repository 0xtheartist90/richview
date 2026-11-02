'use client';

// /routines: one project's routines and checks as a cockpit. On top, how today is going; then a tile per routine with
// where it stands today, its last runs as a row of lights, and when it's next due. A tap on a tile opens today's run
// (or the late one) to mark it done, move it or comment.
import { useEffect, useState } from 'react';

import { useRouter } from 'next/navigation';

import { Led, ProjectRail, Stat } from '@/components/board/board';
import { type Member, TaskEditor } from '@/components/board/task-editor';
import { RoutineButtons, RunNow } from '@/components/recurring/controls';
import { Avatar, domainHex } from '@/components/review/parts';
import { PreviewSheet } from '@/components/review/preview-sheet';
import type { Cockpit as CockpitData, RoutineState, RoutineView } from '@/lib/recurring';
import { STATUS_META, type Task } from '@/lib/task-types';
import type { ProjectSummary } from '@/lib/tasks';
import { cn } from '@/lib/utils';

import { CalendarClock, Check, CircleDashed, Clock3, Pause, TriangleAlert } from 'lucide-react';

const POLL_MS = 30_000;

/** Each state's word and colour, in SRE's palette. */
const STATE: Record<RoutineState, { label: string; hex: string }> = {
    done: { label: 'Done', hex: '#34d399' },
    review: { label: 'Waiting for review', hex: '#d4b062' },
    working: { label: 'In progress', hex: '#a78bfa' },
    todo: { label: 'To do', hex: '#7ea6d8' },
    blocked: { label: 'Blocked', hex: '#f43f5e' },
    changes: { label: 'Changes requested', hex: '#c98a5a' },
    late: { label: 'Late', hex: '#f43f5e' },
    due: { label: 'Due today', hex: '#7ea6d8' },
    not_today: { label: 'Not today', hex: '#6b7280' },
    paused: { label: 'Paused', hex: '#6b7280' }
};

/** "Sat 8 Nov" from YYYY-MM-DD. */
const day = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC'
    });

export function Cockpit({
    projects,
    project,
    cockpit,
    team
}: {
    projects: ProjectSummary[];
    project: ProjectSummary;
    cockpit: CockpitData;
    team: Member[];
}) {
    const router = useRouter();
    const [open, setOpen] = useState<Task | null>(null);
    const hex = domainHex(project.slug);

    useEffect(() => {
        const refresh = () => document.visibilityState === 'visible' && router.refresh();
        const timer = setInterval(refresh, POLL_MS);
        document.addEventListener('visibilitychange', refresh);

        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [router]);

    // What needs looking at first: late and blocked, then today's open work, then done, then the rest.
    const order: RoutineState[] = [
        'late',
        'blocked',
        'changes',
        'review',
        'working',
        'todo',
        'due',
        'done',
        'not_today',
        'paused'
    ];
    const routines = [...cockpit.routines].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
    const progress = cockpit.dueToday ? cockpit.doneToday / cockpit.dueToday : 0;

    return (
        <div className='mx-auto w-full max-w-md lg:max-w-none'>
            <h1 className='sr-only'>Routines · {project.name}</h1>
            <ProjectRail projects={projects} current={project.slug} page='/routines' className='lg:hidden' />

            <section className='hero relative isolate mt-3 overflow-hidden rounded-2xl border border-white/[0.07] bg-[var(--hero)] p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_24px_48px_-28px_rgb(0_0_0/0.8)] lg:mt-0 lg:p-5'>
                <div
                    aria-hidden
                    className='pointer-events-none absolute inset-0 -z-10'
                    style={{
                        background: `radial-gradient(40rem 16rem at 100% -30%, ${hex}38, transparent 60%), radial-gradient(28rem 14rem at -5% 115%, rgb(var(--brand-rgb) / 0.1), transparent 60%)`
                    }}
                />
                <div className='flex flex-wrap items-center gap-4 lg:flex-nowrap lg:gap-8'>
                    <div className='min-w-0 flex-1'>
                        <p className='label-hud text-white/45'>routines</p>
                        <p className='mt-1.5 flex items-center gap-2.5 text-2xl font-light tracking-wide'>
                            <Led hex={hex} />
                            {project.name}
                        </p>
                    </div>
                    <TodayRing done={cockpit.doneToday} due={cockpit.dueToday} />
                    <dl className='grid w-full grid-cols-3 gap-2 lg:w-[26rem]'>
                        <Stat label='open' value={cockpit.open} />
                        <Stat label='late' value={cockpit.late} alert={cockpit.late > 0} />
                        <Stat
                            label='7-day'
                            value={cockpit.weekRate === null ? '–' : `${Math.round(cockpit.weekRate * 100)}%`}
                        />
                    </dl>
                    <div className='hidden lg:block'>
                        <RunNow />
                    </div>
                </div>
                {cockpit.dueToday > 0 && (
                    <div className='mt-4 h-1.5 overflow-hidden rounded-full bg-black/30'>
                        <div
                            className='h-full rounded-full bg-[linear-gradient(90deg,var(--brand),#34d399)] transition-all'
                            style={{ width: `${progress * 100}%` }}
                        />
                    </div>
                )}
            </section>

            {routines.length ? (
                <div className='mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
                    {routines.map((r) => (
                        <Tile key={r.id} routine={r} onOpen={setOpen} />
                    ))}
                </div>
            ) : (
                <p className='text-muted-foreground py-12 text-center text-sm'>
                    No routines in {project.name} yet. Agents add them with POST /api/agent/recurring.
                </p>
            )}

            <div className='mt-4 lg:hidden'>
                <RunNow />
            </div>

            <PreviewSheet task={open} onClose={() => setOpen(null)}>
                {open && <TaskEditor key={open.id} task={open} team={team} onDone={() => setOpen(null)} />}
            </PreviewSheet>
        </div>
    );
}

/** Today's routines done, as a ring around the count. */
function TodayRing({ done, due }: { done: number; due: number }) {
    const r = 26;
    const c = 2 * Math.PI * r;
    const part = due ? done / due : 0;

    return (
        <div className='flex items-center gap-3'>
            <svg viewBox='0 0 64 64' className='size-16 -rotate-90' aria-hidden>
                <circle cx='32' cy='32' r={r} fill='none' stroke='rgb(0 0 0 / 0.35)' strokeWidth='6' />
                <circle
                    cx='32'
                    cy='32'
                    r={r}
                    fill='none'
                    stroke={part === 1 ? '#34d399' : 'var(--brand)'}
                    strokeWidth='6'
                    strokeLinecap='round'
                    strokeDasharray={`${c * part} ${c}`}
                    style={{ filter: 'drop-shadow(0 0 6px rgb(var(--brand-rgb) / 0.5))' }}
                />
            </svg>
            <div>
                <p className='readout text-glow text-2xl leading-none font-light'>
                    {done}/{due}
                </p>
                <p className='label-xs mt-1 text-white/50'>done today</p>
            </div>
        </div>
    );
}

function StateIcon({ state }: { state: RoutineState }) {
    const cls = 'size-4';
    if (state === 'done') return <Check className={cls} />;
    if (state === 'late' || state === 'blocked') return <TriangleAlert className={cls} />;
    if (state === 'paused') return <Pause className={cls} />;
    if (state === 'not_today') return <CalendarClock className={cls} />;
    if (state === 'working' || state === 'review') return <Clock3 className={cls} />;

    return <CircleDashed className={cls} />;
}

/** One routine: its state today, who runs it, its last runs as lights, and when it's next due. */
function Tile({ routine: r, onOpen }: { routine: RoutineView; onOpen: (t: Task) => void }) {
    const s = STATE[r.state];
    const run = r.current;

    return (
        <article
            className={cn(
                'bg-card panel flex flex-col overflow-hidden rounded-2xl border shadow-[var(--shadow-card)]',
                !r.active && 'opacity-60'
            )}>
            <div className='h-0.5' style={{ background: `linear-gradient(90deg, ${s.hex}, transparent)` }} />
            <button
                onClick={() => run && onOpen(run)}
                disabled={!run}
                className='flex flex-1 flex-col gap-3 p-4 text-left enabled:hover:bg-white/[0.02]'>
                <span
                    className='inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium'
                    style={{ borderColor: `${s.hex}66`, background: `${s.hex}1f`, color: s.hex }}>
                    <StateIcon state={r.state} />
                    {s.label}
                    {r.state === 'late' && ` · ${r.lateDays}d`}
                </span>
                <span>
                    <span className='block text-[17px] leading-snug font-medium'>{r.title}</span>
                    {r.summary && <span className='mt-0.5 line-clamp-2 block text-sm text-white/55'>{r.summary}</span>}
                </span>
                <span className='flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55'>
                    <span className='text-white/80'>{r.schedule}</span>
                    {r.owner && (
                        <span className='inline-flex items-center gap-1.5'>
                            <Avatar name={r.owner} className='size-4 text-[9px]' />
                            {r.owner}
                        </span>
                    )}
                    {r.reviewer && <span>checked by {r.reviewer}</span>}
                </span>

                {/* The last runs, oldest left: a light each in its status's colour. */}
                <span className='mt-auto flex items-end justify-between gap-3'>
                    <span className='flex gap-1' aria-label='Last runs'>
                        {[...r.history].reverse().map((t) => (
                            <span
                                key={t.id}
                                title={`${t.title} · ${STATUS_META[t.status].label}`}
                                className='h-4 w-2 rounded-sm'
                                style={{
                                    background: STATUS_META[t.status].hex,
                                    opacity: t.status === 'approved' ? 1 : 0.7
                                }}
                            />
                        ))}
                        {!r.history.length && <span className='label-xs text-white/30'>no runs yet</span>}
                    </span>
                    <span className='label-xs shrink-0 text-white/40'>{r.next ? `next ${day(r.next)}` : 'paused'}</span>
                </span>
            </button>
            <div className='flex items-center justify-between gap-2 border-t px-3 py-2'>
                <span className='label-xs text-white/35'>{run ? 'tap to open the run' : ' '}</span>
                <RoutineButtons id={r.id} title={r.title} active={r.active} />
            </div>
        </article>
    );
}
