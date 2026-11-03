'use client';

// /board: one project at a time, in SRE's look, as a calm list like Routines: a folding section per status, what
// needs Richie on top, each task a row (on a desktop with columns for owner, reviewer, priority, kind and last
// change). The projects sit in a rail on top (and in the sidebar on a desktop), each in its own colour, so it's
// always clear which one you're in. Richie manages a task from its sheet, or on a desktop drags it to another status.
import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { type Member, TaskEditor, saveTask } from '@/components/board/task-editor';
import { Avatar, domainHex } from '@/components/review/parts';
import { PreviewSheet } from '@/components/review/preview-sheet';
import { PHONE_ORDER, STATUS_META, type Task, type TaskStatus } from '@/lib/task-types';
import type { ProjectSummary } from '@/lib/tasks';
import { cn } from '@/lib/utils';

import { ArrowRight, ChevronDown, Flag, Repeat, RotateCcw, ShieldCheck, UserCheck } from 'lucide-react';
import { toast } from 'sonner';

/** Done work starts folded away on a phone. */
const FOLDED: TaskStatus[] = ['approved'];
const POLL_MS = 30_000;

const PRIORITY_HEX: Record<string, string> = { urgent: '#f43f5e', high: '#d4b062' };

/** "now", "5m", "3h", "2d": how long since the task last changed. */
function ago(iso: string) {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
    if (min < 1) return 'now';
    if (min < 60) return `${min}m`;
    if (min < 60 * 24) return `${Math.round(min / 60)}h`;

    return `${Math.round(min / (60 * 24))}d`;
}

/** A status's coloured light, as SRE's led. */
export function Led({ hex }: { hex: string }) {
    return (
        <span
            aria-hidden
            className='inline-block size-1.5 shrink-0 rounded-full'
            style={{ background: hex, boxShadow: `0 0 0 2px ${hex}26, 0 0 10px 1px ${hex}b3` }}
        />
    );
}

export function Board({
    projects,
    project,
    tasks,
    team
}: {
    projects: ProjectSummary[];
    project: ProjectSummary;
    tasks: Task[];
    /** Who a card can be given to: the agents of this project. */
    team: Member[];
}) {
    const router = useRouter();
    const [owner, setOwner] = useState<string | null>(null);
    const [folded, setFolded] = useState<Set<TaskStatus>>(() => new Set(FOLDED));
    const [open, setOpen] = useState<Task | null>(null);
    const hex = domainHex(project.slug);

    // New and moved cards show by themselves while the board is in front.
    useEffect(() => {
        const refresh = () => document.visibilityState === 'visible' && router.refresh();
        const timer = setInterval(refresh, POLL_MS);
        document.addEventListener('visibilitychange', refresh);

        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [router]);

    // Tasks dragged to another status show there right away, until the next read has them.
    const [moved, setMoved] = useState<Record<string, TaskStatus>>({});
    useEffect(() => setMoved({}), [tasks]);
    const all = tasks.map((t) => (moved[t.id] ? { ...t, status: moved[t.id] } : t));

    const owners = useMemo(() => [...new Set(tasks.map((t) => t.owner).filter(Boolean))].sort(), [tasks]);
    const shown = owner ? all.filter((t) => t.owner === owner) : all;

    /** A task dropped on another status. Changes requested needs a why, so that one opens the task instead. */
    const move = async (id: string, to: TaskStatus) => {
        const task = all.find((t) => t.id === id);
        if (!task || task.status === to) return;
        if (to === 'changes_requested') {
            toast('Say what should change', { description: 'Pick Changes requested here and add a comment.' });

            return setOpen(task);
        }
        if (to === 'peer_review' && !task.reviewer) return void toast.error('This card has no reviewer');
        setMoved((m) => ({ ...m, [id]: to }));
        if (await saveTask(id, { status: to })) router.refresh();
        else setMoved(({ [id]: _, ...rest }) => rest);
    };
    const of = (s: TaskStatus) => shown.filter((t) => t.status === s);

    const toggle = (s: TaskStatus) =>
        setFolded((f) => {
            const next = new Set(f);
            if (next.has(s)) next.delete(s);
            else next.add(s);

            return next;
        });

    return (
        <div className='mx-auto w-full max-w-md lg:max-w-none'>
            <h1 className='sr-only'>Board · {project.name}</h1>
            {/* The sidebar lists the projects on a desktop; a phone gets them here. */}
            <ProjectRail projects={projects} current={project.slug} className='lg:hidden' />

            {/* The project you're in, as SRE's header card, lit in the project's colour. */}
            <section className='hero relative isolate mt-3 overflow-hidden rounded-2xl border border-white/[0.07] bg-[var(--hero)] p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_24px_48px_-28px_rgb(0_0_0/0.8)] lg:mt-0 lg:flex lg:items-center lg:gap-8 lg:p-5'>
                <div
                    aria-hidden
                    className='pointer-events-none absolute inset-0 -z-10'
                    style={{
                        background: `radial-gradient(40rem 16rem at 100% -30%, ${hex}38, transparent 60%), radial-gradient(28rem 14rem at -5% 115%, rgb(var(--brand-rgb) / 0.1), transparent 60%)`
                    }}
                />
                <div className='min-w-0'>
                    <p className='label-hud text-white/45'>project</p>
                    <p className='mt-1.5 flex items-center gap-2.5 text-2xl font-light tracking-wide'>
                        <Led hex={hex} />
                        {project.name}
                    </p>
                </div>
                <dl className='mt-4 grid grid-cols-4 gap-2 lg:mt-0 lg:ml-auto lg:w-[34rem]'>
                    <Stat label='open' value={project.open} />
                    <Stat label='review' value={project.review} />
                    <Stat
                        label='working'
                        value={`${project.working}/${project.wipLimit}`}
                        alert={project.working > project.wipLimit}
                    />
                    <Stat label='blocked' value={project.blocked} alert={project.blocked > 0} />
                </dl>
            </section>

            {owners.length > 1 && (
                <div className='no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0'>
                    <FilterChip active={!owner} onClick={() => setOwner(null)}>
                        Everyone
                    </FilterChip>
                    {owners.map((o) => (
                        <FilterChip key={o} active={owner === o} onClick={() => setOwner(owner === o ? null : o)}>
                            <Avatar name={o} className='size-5 text-[10px]' /> {o}
                        </FilterChip>
                    ))}
                </div>
            )}

            {/* A folding section per status that holds something, what needs Richie first. */}
            <div className='mt-4 flex flex-col gap-3 lg:mt-5'>
                {shown.length ? (
                    PHONE_ORDER.filter((s) => of(s).length).map((s) => (
                        <StatusPanel
                            key={s}
                            status={s}
                            tasks={of(s)}
                            folded={folded.has(s)}
                            onToggle={() => toggle(s)}
                            onOpen={setOpen}
                            onDrop={move}
                        />
                    ))
                ) : (
                    <Empty owner={owner} project={project.name} />
                )}
            </div>

            <PreviewSheet task={open} onClose={() => setOpen(null)}>
                {open && <TaskEditor key={open.id} task={open} team={team} onDone={() => setOpen(null)} />}
            </PreviewSheet>
        </div>
    );
}

/** One status: a header with its light and count, then its tasks as rows (folding). */
function StatusPanel({
    status,
    tasks,
    folded = false,
    onToggle,
    onOpen,
    onDrop
}: {
    status: TaskStatus;
    tasks: Task[];
    folded?: boolean;
    onToggle?: () => void;
    onOpen: (t: Task) => void;
    /** A task dragged onto this status (a desktop) moves here. */
    onDrop?: (id: string, to: TaskStatus) => void;
}) {
    const meta = STATUS_META[status];
    const [over, setOver] = useState(false);

    return (
        <section
            onDragOver={
                onDrop
                    ? (e) => {
                          e.preventDefault();
                          setOver(true);
                      }
                    : undefined
            }
            onDragLeave={onDrop ? () => setOver(false) : undefined}
            onDrop={
                onDrop
                    ? (e) => {
                          e.preventDefault();
                          setOver(false);
                          const id = e.dataTransfer.getData('text/plain');
                          if (id) onDrop(id, status);
                      }
                    : undefined
            }
            className={cn(
                'bg-card panel overflow-hidden rounded-2xl border shadow-[var(--shadow-card)] transition-colors',
                over && 'border-[var(--brand)]/60 bg-[var(--brand)]/[0.06]'
            )}>
            <div className='h-0.5' style={{ background: `linear-gradient(90deg, ${meta.hex}, transparent)` }} />
            <div className='flex items-center'>
                <button
                    onClick={onToggle}
                    aria-expanded={!folded}
                    className='flex min-h-12 min-w-0 flex-1 items-center gap-2.5 px-4 text-left'>
                    <Led hex={meta.hex} />
                    <span className='truncate text-[15px] font-medium'>{meta.label}</span>
                    <span className='readout rounded-md bg-white/[0.06] px-1.5 py-0.5 text-xs text-white/60'>
                        {tasks.length}
                    </span>
                    <ChevronDown
                        className={cn('ml-auto size-4 text-white/40 transition-transform', folded && '-rotate-90')}
                    />
                </button>
                {status === 'review' && tasks.length > 0 && (
                    <Link
                        href='/review'
                        aria-label='Swipe through review'
                        className='btn-primary mr-2.5 inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-3 text-xs'>
                        Swipe <ArrowRight className='size-3.5' />
                    </Link>
                )}
            </div>
            {!folded && (
                <>
                    <div className={cn('label-xs hidden border-t px-4 py-2 text-white/35', ROW_GRID)}>
                        <span>task</span>
                        <span>owner</span>
                        <span>reviewer</span>
                        <span>priority</span>
                        <span>kind</span>
                        <span className='text-right'>changed</span>
                    </div>
                    <ul className='divide-y border-t'>
                        {tasks.map((t) => (
                            <li key={t.id}>
                                <Row task={t} onOpen={() => onOpen(t)} draggable={!!onDrop} />
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </section>
    );
}

/** The projects in a recessed rail, as SRE's tabs; it scrolls sideways once there are more than fit. */
export function ProjectRail({
    projects,
    current,
    className,
    page = '/board'
}: {
    projects: ProjectSummary[];
    current: string;
    className?: string;
    /** The page each tab opens, for that project. */
    page?: string;
}) {
    return (
        <nav
            aria-label='Projects'
            className={cn('track no-scrollbar flex gap-1 overflow-x-auto rounded-xl p-1', className)}>
            {projects.map((p) => {
                const active = p.slug === current;

                return (
                    <Link
                        key={p.slug}
                        href={`${page}?project=${p.slug}`}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                            'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-medium',
                            active ? 'btn-key' : 'text-white/55'
                        )}>
                        <Led hex={domainHex(p.slug)} />
                        {p.name}
                        {p.review > 0 && (
                            <span className='inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white tabular-nums'>
                                {p.review}
                            </span>
                        )}
                    </Link>
                );
            })}
        </nav>
    );
}

/** One number in the header card, as SRE's small stat tile. */
export function Stat({ label, value, alert }: { label: string; value: number | string; alert?: boolean }) {
    return (
        <div
            className={cn(
                'min-w-0 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2 py-2 sm:px-3',
                alert && 'border-rose-400/25 bg-rose-500/[0.08]'
            )}>
            <dt className='readout truncate text-[11px] leading-tight font-medium tracking-[0.08em] text-white/50 lowercase'>
                {label}
            </dt>
            <dd
                className={cn(
                    'readout mt-1 truncate text-xl leading-none font-light',
                    alert ? 'text-rose-300' : 'text-glow'
                )}>
                {value}
            </dd>
        </div>
    );
}

function FilterChip({
    active,
    onClick,
    children
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm',
                active ? 'btn-key' : 'border border-white/[0.08] text-white/60'
            )}>
            {children}
        </button>
    );
}

function Empty({ owner, project }: { owner: string | null; project: string }) {
    return (
        <p className='text-muted-foreground py-10 text-center text-sm'>
            {owner ? `Nothing from ${owner} in ${project}.` : `No tasks in ${project} yet.`}
        </p>
    );
}

const ROW_GRID = 'lg:grid lg:grid-cols-[minmax(0,1fr)_9rem_9rem_6.5rem_8rem_5rem] lg:items-center lg:gap-3';

/** Marks after a title: peer checked or waiting for its reviewer, from a routine, sent back before. */
function Marks({ task }: { task: Task }) {
    return (
        <>
            {task.reviewer &&
                (task.peerCheckedAt ? (
                    <ShieldCheck
                        className='size-3.5 shrink-0 text-emerald-300'
                        aria-label={`Peer checked by ${task.reviewer}`}
                    />
                ) : (
                    <UserCheck className='size-3.5 shrink-0 text-[#5fb8c2]' aria-label={`Reviewer: ${task.reviewer}`} />
                ))}
            {task.recurring && <Repeat className='size-3.5 shrink-0 text-white/45' aria-label='Recurring' />}
            {task.returned && <RotateCcw className='size-3.5 shrink-0 text-[var(--bronze)]' aria-label='Returned' />}
        </>
    );
}

/**
 * One task as a row: on a phone the title with its summary, then owner, priority and how long ago it changed; on a
 * desktop the same in columns. A tap opens it; on a desktop it drags to another status.
 */
function Row({ task, onOpen, draggable }: { task: Task; onOpen: () => void; draggable?: boolean }) {
    const hex = domainHex(task.domain);

    return (
        <button
            onClick={onOpen}
            draggable={draggable}
            onDragStart={draggable ? (e) => e.dataTransfer.setData('text/plain', task.id) : undefined}
            className={cn(
                'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03] active:bg-white/[0.05] lg:py-2.5',
                ROW_GRID,
                draggable && 'lg:cursor-grab lg:active:cursor-grabbing'
            )}>
            <span className='flex min-w-0 items-start gap-3'>
                <span
                    className='mt-1 h-8 w-[3px] shrink-0 rounded-full lg:h-7'
                    style={{ background: hex }}
                    aria-hidden
                />
                <span className='min-w-0 flex-1'>
                    <span className='flex items-center gap-1.5'>
                        <span className='line-clamp-2 text-[14.5px] leading-snug font-medium lg:line-clamp-1'>
                            {task.title}
                        </span>
                        <Marks task={task} />
                    </span>
                    {task.summary && <span className='block truncate text-[13px] text-white/45'>{task.summary}</span>}
                    {/* Phone: the rest on one quiet line. */}
                    <span className='mt-1.5 flex items-center gap-2 text-xs text-white/50 lg:hidden'>
                        {task.owner && (
                            <span className='inline-flex min-w-0 items-center gap-1.5'>
                                <Avatar name={task.owner} className='size-4 text-[9px]' />
                                <span className='truncate'>{task.owner}</span>
                            </span>
                        )}
                        {task.domain && <span className='truncate'>· {task.domain}</span>}
                        {PRIORITY_HEX[task.priority] && (
                            <Flag className='size-3.5 shrink-0' style={{ color: PRIORITY_HEX[task.priority] }} />
                        )}
                        <span className='readout ml-auto shrink-0' suppressHydrationWarning>
                            {ago(task.updatedAt)}
                        </span>
                    </span>
                </span>
            </span>
            <Who name={task.owner} />
            <Who name={task.reviewer} quiet />
            <span className='hidden items-center gap-1.5 text-sm text-white/65 capitalize lg:flex'>
                <Flag
                    className='size-3.5'
                    style={{ color: PRIORITY_HEX[task.priority] ?? 'rgb(255 255 255 / 0.25)' }}
                />
                {task.priority}
            </span>
            <span className='hidden min-w-0 lg:block'>
                {task.domain ? (
                    <span
                        className='inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[11px] font-medium'
                        style={{ borderColor: `${hex}55`, background: `${hex}1a`, color: hex }}>
                        {task.domain}
                    </span>
                ) : (
                    <span className='text-white/25'>–</span>
                )}
            </span>
            <span className='readout hidden text-right text-sm text-white/50 lg:block' suppressHydrationWarning>
                {ago(task.updatedAt)}
            </span>
        </button>
    );
}

/** A person in a desktop column, or a dash. */
function Who({ name, quiet }: { name: string; quiet?: boolean }) {
    return (
        <span
            className={cn(
                'hidden min-w-0 items-center gap-1.5 text-sm lg:flex',
                quiet ? 'text-white/55' : 'text-white/80'
            )}>
            {name ? (
                <>
                    <Avatar name={name} className='size-5 text-[10px]' />
                    <span className='truncate'>{name}</span>
                </>
            ) : (
                <span className='text-white/25'>–</span>
            )}
        </span>
    );
}
