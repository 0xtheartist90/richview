'use client';

// /routines: every routine and check as a calm dashboard. On top the day in numbers; then filters and a search; then
// the routines in sections by how often they come back (every few hours, daily, weekly), each a compact row (or a
// card): its state today, when, who, the last and next run, and its 7-day hit rate. A row opens to its steps and run
// history; "…" holds Log a run, Pause and Delete. Times are Bangkok time.
import { useEffect, useMemo, useState } from 'react';

import { useRouter } from 'next/navigation';

import { Avatar, domainHex } from '@/components/review/parts';
import type { Frequency, RoutineView } from '@/lib/recurring';
import type { RoutineState } from '@/lib/schedule';
import { cn } from '@/lib/utils';

import { ChevronDown, LayoutGrid, List, MoreHorizontal, Search } from 'lucide-react';
import { toast } from 'sonner';

const POLL_MS = 60_000;
const TZ = 'Asia/Bangkok';
const VIEW_KEY = 'routines-view';

const STATE: Record<RoutineState, { label: string; hex: string }> = {
    done: { label: 'Done', hex: '#34d399' },
    on_track: { label: 'On track', hex: '#34d399' },
    upcoming: { label: 'Open', hex: '#7ea6d8' },
    late: { label: 'Late', hex: '#f43f5e' },
    failed: { label: 'Failed', hex: '#f43f5e' },
    not_today: { label: 'Not today', hex: '#6b7280' },
    paused: { label: 'Paused', hex: '#6b7280' }
};

const SECTIONS: { key: Frequency; label: string }[] = [
    { key: 'ongoing', label: 'Every few hours · ongoing' },
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'other', label: 'Monthly & other' }
];

/** The status filter's groups. */
const STATUS_FILTER = {
    all: { label: 'Any status', has: () => true },
    late: { label: 'Late or failed', has: (s: RoutineState) => s === 'late' || s === 'failed' },
    open: { label: 'Open', has: (s: RoutineState) => s === 'upcoming' || s === 'on_track' },
    done: { label: 'Done', has: (s: RoutineState) => s === 'done' },
    quiet: { label: 'Not today or paused', has: (s: RoutineState) => s === 'not_today' || s === 'paused' }
} as const;
type StatusKey = keyof typeof STATUS_FILTER;

// ---- Time, in Bangkok -----------------------------------------------------------------------------------------

const bkkDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const clock = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/** "14:05", "Yesterday 19:50", "Sun 13:00", "12 Nov 13:00" (Bangkok). */
function when(iso: string | null) {
    if (!iso) return '–';
    const d = new Date(iso);
    const today = bkkDate(new Date());
    const day = bkkDate(d);
    const diff = Math.round((new Date(day).getTime() - new Date(today).getTime()) / 86_400_000);
    if (diff === 0) return clock(d);
    if (diff === -1) return `Yesterday ${clock(d)}`;
    if (diff === 1) return `Tomorrow ${clock(d)}`;
    if (Math.abs(diff) < 7) return `${d.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short' })} ${clock(d)}`;

    return `${d.toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' })} ${clock(d)}`;
}

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);

// ---- The page ---------------------------------------------------------------------------------------------------

export function RoutinesDashboard({
    routines,
    projects,
    initialProject
}: {
    routines: RoutineView[];
    projects: { slug: string; name: string }[];
    initialProject: string | null;
}) {
    const router = useRouter();
    const [project, setProject] = useState(initialProject ?? '');
    const [owner, setOwner] = useState('');
    const [frequency, setFrequency] = useState<Frequency | ''>('');
    const [status, setStatus] = useState<StatusKey>('all');
    const [query, setQuery] = useState('');
    const [view, setView] = useState<'list' | 'cards'>('list');
    const [open, setOpen] = useState<string | null>(null);

    useEffect(() => setProject(initialProject ?? ''), [initialProject]);
    useEffect(() => {
        try {
            if (localStorage.getItem(VIEW_KEY) === 'cards') setView('cards');
        } catch {
            // No storage: the list it is.
        }
    }, []);
    const pickView = (v: 'list' | 'cards') => {
        setView(v);
        try {
            localStorage.setItem(VIEW_KEY, v);
        } catch {
            // As above.
        }
    };
    useEffect(() => {
        const refresh = () => document.visibilityState === 'visible' && router.refresh();
        const timer = setInterval(refresh, POLL_MS);
        document.addEventListener('visibilitychange', refresh);

        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [router]);

    const owners = useMemo(() => [...new Set(routines.map((r) => r.owner).filter(Boolean))].sort(), [routines]);
    const q = query.trim().toLowerCase();
    const shown = routines.filter(
        (r) =>
            (!project || r.project.slug === project) &&
            (!owner || r.owner === owner) &&
            (!frequency || r.frequency === frequency) &&
            STATUS_FILTER[status].has(r.status.state) &&
            (!q || `${r.title} ${r.summary} ${r.owner} ${r.reviewer}`.toLowerCase().includes(q))
    );
    const scope = routines.filter((r) => !project || r.project.slug === project);

    return (
        <div className='mx-auto w-full max-w-md lg:max-w-none'>
            <h1 className='sr-only'>Routines</h1>
            <Kpis routines={scope} />

            <div className='mt-4 flex flex-col gap-2 lg:flex-row lg:items-center'>
                <label className='track flex h-10 flex-1 items-center gap-2 rounded-xl px-3'>
                    <Search className='size-4 text-white/40' />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder='Search routines'
                        aria-label='Search routines'
                        className='min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-white/35'
                    />
                </label>
                <div className='no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0'>
                    <Select value={project} onChange={setProject} label='Project'>
                        <option value=''>All projects</option>
                        {projects.map((p) => (
                            <option key={p.slug} value={p.slug}>
                                {p.name}
                            </option>
                        ))}
                    </Select>
                    <Select value={owner} onChange={setOwner} label='Owner'>
                        <option value=''>Anyone</option>
                        {owners.map((o) => (
                            <option key={o} value={o}>
                                {o}
                            </option>
                        ))}
                    </Select>
                    <Select value={frequency} onChange={(v) => setFrequency(v as Frequency | '')} label='Frequency'>
                        <option value=''>Any frequency</option>
                        {SECTIONS.map((s) => (
                            <option key={s.key} value={s.key}>
                                {s.label}
                            </option>
                        ))}
                    </Select>
                    <Select value={status} onChange={(v) => setStatus(v as StatusKey)} label='Status'>
                        {(Object.keys(STATUS_FILTER) as StatusKey[]).map((k) => (
                            <option key={k} value={k}>
                                {STATUS_FILTER[k].label}
                            </option>
                        ))}
                    </Select>
                    <div className='track flex shrink-0 rounded-xl p-1' role='group' aria-label='View'>
                        {(['list', 'cards'] as const).map((v) => (
                            <button
                                key={v}
                                onClick={() => pickView(v)}
                                aria-pressed={view === v}
                                aria-label={v === 'list' ? 'List' : 'Cards'}
                                className={cn(
                                    'inline-flex size-8 items-center justify-center rounded-lg',
                                    view === v ? 'btn-key' : 'text-white/50'
                                )}>
                                {v === 'list' ? <List className='size-4' /> : <LayoutGrid className='size-4' />}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {shown.length ? (
                SECTIONS.map(({ key, label }) => {
                    const items = shown
                        .filter((r) => r.frequency === key)
                        .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.title.localeCompare(b.title));
                    if (!items.length) return null;

                    return (
                        <section key={key} className='mt-6'>
                            <p className='label-hud mb-2.5 text-white/50'>
                                {label.toLowerCase()} <span className='text-white/30'>· {items.length}</span>
                            </p>
                            {view === 'list' ? (
                                <div className='bg-card panel overflow-hidden rounded-2xl border shadow-[var(--shadow-card)]'>
                                    <ListHead />
                                    <ul className='divide-y'>
                                        {items.map((r) => (
                                            <li key={r.id}>
                                                <Row
                                                    routine={r}
                                                    expanded={open === r.id}
                                                    onToggle={() => setOpen(open === r.id ? null : r.id)}
                                                    showProject={!project}
                                                />
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : (
                                <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
                                    {items.map((r) => (
                                        <Card
                                            key={r.id}
                                            routine={r}
                                            expanded={open === r.id}
                                            onToggle={() => setOpen(open === r.id ? null : r.id)}
                                            showProject={!project}
                                        />
                                    ))}
                                </div>
                            )}
                        </section>
                    );
                })
            ) : (
                <p className='text-muted-foreground py-12 text-center text-sm'>
                    {routines.length ? 'No routine matches these filters.' : 'No routines yet.'}
                </p>
            )}
        </div>
    );
}

function Select({
    value,
    onChange,
    label,
    children
}: {
    value: string;
    onChange: (v: string) => void;
    label: string;
    children: React.ReactNode;
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
            className='track h-10 shrink-0 rounded-xl px-3 text-sm text-white outline-none focus:ring-2 focus:ring-[var(--ring)]'>
            {children}
        </select>
    );
}

// ---- KPIs -------------------------------------------------------------------------------------------------------

function Kpis({ routines }: { routines: RoutineView[] }) {
    const active = routines.filter((r) => r.active);
    const done = active.filter((r) => r.status.state === 'done').length;
    const dueToday = active.filter((r) => r.status.state !== 'not_today').length;
    const open = active.filter((r) => r.status.state === 'upcoming' || r.status.state === 'on_track').length;
    const late = active.filter((r) => r.status.state === 'late' || r.status.state === 'failed').length;
    const rates = active.map((r) => r.status.hit7).filter((x): x is number => x !== null);
    const hit = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
    // The day-by-day average over all routines, for the strip's sparkline.
    const spark = Array.from({ length: 7 }, (_, i) => {
        const v = active.map((r) => r.status.spark[i]).filter((x): x is number => x !== null);

        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    });

    return (
        <section className='hero relative isolate overflow-hidden rounded-2xl border border-white/[0.07] bg-[var(--hero)] p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_24px_48px_-28px_rgb(0_0_0/0.8)] lg:p-5'>
            <div
                aria-hidden
                className='pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_20rem_at_100%_-30%,rgb(var(--brand-rgb)/0.2),transparent_60%)]'
            />
            <p className='label-hud text-white/45'>routines · today</p>
            <dl className='mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4'>
                <Kpi label='done today' value={`${done}/${dueToday}`} />
                <Kpi label='open' value={open} />
                <Kpi label='late or failed' value={late} alert={late > 0} />
                <Kpi label='7-day hit rate' value={pct(hit)}>
                    <Spark values={spark} className='mt-1.5 h-5 w-full' />
                </Kpi>
            </dl>
        </section>
    );
}

function Kpi({
    label,
    value,
    alert,
    children
}: {
    label: string;
    value: string | number;
    alert?: boolean;
    children?: React.ReactNode;
}) {
    return (
        <div
            className={cn(
                'min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5',
                alert && 'border-rose-400/25 bg-rose-500/[0.08]'
            )}>
            <dt className='readout truncate text-[11px] font-medium tracking-[0.08em] text-white/50 lowercase'>
                {label}
            </dt>
            <dd className={cn('readout mt-1 text-2xl leading-none font-light', alert ? 'text-rose-300' : 'text-glow')}>
                {value}
            </dd>
            {children}
        </div>
    );
}

/** Seven days of hit rate as a small gold line (gaps where nothing was due). */
function Spark({ values, className }: { values: (number | null)[]; className?: string }) {
    const pts = values.map((v, i) => (v === null ? null : ([(i / 6) * 60, 18 - v * 16] as const)));
    const known = pts.filter((p): p is readonly [number, number] => !!p);
    if (known.length < 2)
        return <span className={cn('label-xs block text-white/25', className)}>{known.length ? '' : 'no runs'}</span>;
    const d = known.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

    return (
        <svg viewBox='0 0 60 20' preserveAspectRatio='none' aria-hidden className={className}>
            <path d={d} fill='none' stroke='var(--brand)' strokeWidth='1.5' vectorEffect='non-scaling-stroke' />
        </svg>
    );
}

// ---- A routine ----------------------------------------------------------------------------------------------------

function StatePill({ state }: { state: RoutineState }) {
    const s = STATE[state];

    return (
        <span className='inline-flex items-center gap-1.5 text-xs font-medium' style={{ color: s.hex }}>
            <span
                className='size-1.5 shrink-0 rounded-full'
                style={{ background: s.hex, boxShadow: `0 0 0 2px ${s.hex}26, 0 0 8px 1px ${s.hex}99` }}
            />
            {s.label}
        </span>
    );
}

const GRID =
    'lg:grid lg:grid-cols-[7rem_minmax(0,1fr)_11rem_8.5rem_7.5rem_7.5rem_7.5rem_6.5rem_2.5rem] lg:items-center lg:gap-3';

function ListHead() {
    return (
        <div className={cn('label-xs hidden border-b px-4 py-2.5 text-white/40', GRID)}>
            <span>today</span>
            <span>routine</span>
            <span>when</span>
            <span>owner</span>
            <span>reviewer</span>
            <span>last run</span>
            <span>next run</span>
            <span>7 days</span>
            <span />
        </div>
    );
}

const lastRun = (r: RoutineView) => r.runs.find((x) => x.status !== 'missed') ?? null;

function Row({
    routine: r,
    expanded,
    onToggle,
    showProject
}: {
    routine: RoutineView;
    expanded: boolean;
    onToggle: () => void;
    showProject: boolean;
}) {
    const last = lastRun(r);

    return (
        <div className={cn(!r.active && 'opacity-55')}>
            <div className={cn('flex flex-col gap-1.5 px-4 py-3 lg:py-2.5', GRID)}>
                {/* Phone: state and menu share the first line with the name. */}
                <div className='flex items-center gap-2 lg:contents'>
                    <span className='lg:order-none'>
                        <StatePill state={r.status.state} />
                    </span>
                    <button
                        onClick={onToggle}
                        className='min-w-0 flex-1 text-left lg:flex-none'
                        aria-expanded={expanded}>
                        <span className='flex items-center gap-2'>
                            <span className='truncate font-medium'>{r.title}</span>
                            {showProject && <ProjectDot project={r.project} />}
                            <ChevronDown
                                className={cn(
                                    'size-3.5 shrink-0 text-white/30 transition-transform',
                                    expanded && 'rotate-180'
                                )}
                            />
                        </span>
                        {r.summary && <span className='block truncate text-[13px] text-white/50'>{r.summary}</span>}
                    </button>
                    <span className='text-sm text-white/75 max-lg:hidden'>{r.schedule}</span>
                    <span className='max-lg:hidden'>
                        <Person name={r.owner} />
                    </span>
                    <span className='max-lg:hidden'>
                        <Person name={r.reviewer} quiet />
                    </span>
                    <span className='readout text-sm text-white/65 max-lg:hidden'>
                        {last ? when(last.ran_at) : '–'}
                    </span>
                    <span className='readout text-sm text-white/65 max-lg:hidden'>{when(r.status.next)}</span>
                    <span className='flex items-center gap-2 max-lg:hidden'>
                        <Spark values={r.status.spark} className='h-4 w-12' />
                        <span className='readout text-xs text-white/55'>{pct(r.status.hit7)}</span>
                    </span>
                    <Menu routine={r} />
                </div>
                {/* Phone: the details on one quiet line. */}
                <p className='flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/50 lg:hidden'>
                    <span className='text-white/75'>{r.schedule}</span>
                    {r.owner && <Person name={r.owner} />}
                    <span>last {last ? when(last.ran_at) : '–'}</span>
                    <span>next {when(r.status.next)}</span>
                    <span className='inline-flex items-center gap-1.5'>
                        <Spark values={r.status.spark} className='h-3.5 w-10' />
                        {pct(r.status.hit7)}
                    </span>
                </p>
            </div>
            {expanded && <Details routine={r} />}
        </div>
    );
}

function Card({
    routine: r,
    expanded,
    onToggle,
    showProject
}: {
    routine: RoutineView;
    expanded: boolean;
    onToggle: () => void;
    showProject: boolean;
}) {
    const last = lastRun(r);

    return (
        <article
            className={cn(
                'bg-card panel overflow-hidden rounded-2xl border shadow-[var(--shadow-card)]',
                !r.active && 'opacity-55'
            )}>
            <div className='flex items-start gap-2 p-4 pb-2'>
                <div className='min-w-0 flex-1'>
                    <StatePill state={r.status.state} />
                    <button onClick={onToggle} className='mt-1.5 block w-full text-left' aria-expanded={expanded}>
                        <span className='flex items-center gap-2'>
                            <span className='truncate font-medium'>{r.title}</span>
                            {showProject && <ProjectDot project={r.project} />}
                        </span>
                        {r.summary && <span className='block truncate text-[13px] text-white/50'>{r.summary}</span>}
                    </button>
                </div>
                <Menu routine={r} />
            </div>
            <dl className='grid grid-cols-2 gap-x-3 gap-y-1.5 px-4 pb-4 text-xs'>
                <Fact label='when' value={r.schedule} wide />
                <Fact label='owner' value={<Person name={r.owner} />} />
                <Fact label='reviewer' value={<Person name={r.reviewer} quiet />} />
                <Fact label='last run' value={last ? when(last.ran_at) : '–'} />
                <Fact label='next run' value={when(r.status.next)} />
                <Fact
                    label='7 days'
                    wide
                    value={
                        <span className='flex items-center gap-2'>
                            <Spark values={r.status.spark} className='h-4 w-16' />
                            {pct(r.status.hit7)}
                        </span>
                    }
                />
            </dl>
            {expanded && <Details routine={r} />}
        </article>
    );
}

function Fact({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
    return (
        <div className={cn('min-w-0', wide && 'col-span-2')}>
            <dt className='label-xs text-white/35'>{label}</dt>
            <dd className='mt-0.5 truncate text-white/75'>{value}</dd>
        </div>
    );
}

function Person({ name, quiet }: { name: string; quiet?: boolean }) {
    if (!name) return <span className='text-white/30'>–</span>;

    return (
        <span
            className={cn(
                'inline-flex min-w-0 items-center gap-1.5 text-sm',
                quiet ? 'text-white/55' : 'text-white/80'
            )}>
            <Avatar name={name} className='size-5 text-[10px]' />
            <span className='truncate'>{name}</span>
        </span>
    );
}

function ProjectDot({ project }: { project: { slug: string; name: string } }) {
    return (
        <span className='inline-flex shrink-0 items-center gap-1 text-[11px] text-white/40'>
            <span className='size-1.5 rounded-full' style={{ background: domainHex(project.slug) }} />
            {project.name}
        </span>
    );
}

const RUN_HEX: Record<string, string> = { ok: '#34d399', failed: '#f43f5e', missed: '#c98a5a' };

/** Opened: the steps (description) and the run history. */
function Details({ routine: r }: { routine: RoutineView }) {
    return (
        <div className='grid gap-4 border-t bg-black/15 px-4 py-4 lg:grid-cols-2'>
            <div>
                <p className='label-xs mb-1.5 text-white/40'>steps · definition of done</p>
                <p className='text-sm leading-relaxed whitespace-pre-wrap text-white/75'>
                    {r.description || 'No description yet.'}
                </p>
            </div>
            <div>
                <p className='label-xs mb-1.5 text-white/40'>
                    runs · {r.status.coveredSoFar}/{r.status.dueSoFar} today so far
                    {r.status.remaining ? ` · ${r.status.remaining} to come` : ''}
                </p>
                {r.runs.length ? (
                    <ul className='flex flex-col gap-1'>
                        {r.runs.slice(0, 10).map((x) => (
                            <li key={x.id} className='flex items-start gap-2 text-sm'>
                                <span
                                    className='mt-1.5 size-1.5 shrink-0 rounded-full'
                                    style={{ background: RUN_HEX[x.status] }}
                                />
                                <span className='readout w-28 shrink-0 text-white/55'>{when(x.ran_at)}</span>
                                <span className='min-w-0 text-white/75'>
                                    {x.status === 'missed' ? 'Missed' : x.status === 'failed' ? 'Failed' : 'Ok'}
                                    {x.agent && <span className='text-white/40'> · {x.agent}</span>}
                                    {x.note && <span className='block truncate text-white/50'>{x.note}</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className='text-sm text-white/40'>No runs reported yet.</p>
                )}
            </div>
        </div>
    );
}

/** "…": Log a run, Pause or Resume, Delete. */
function Menu({ routine: r }: { routine: RoutineView }) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const call = async (url: string, method: string, body?: unknown, ok?: string) => {
        setBusy(true);
        setOpen(false);
        const res = await fetch(url, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined
        }).catch(() => null);
        setBusy(false);
        if (!res?.ok) {
            const { error } = ((await res?.json().catch(() => null)) ?? {}) as { error?: string };

            return void toast.error(error ?? 'No connection');
        }
        if (ok) toast(ok, { description: r.title });
        router.refresh();
    };

    return (
        <div className='relative justify-self-end'>
            <button
                onClick={() => setOpen((o) => !o)}
                disabled={busy}
                aria-label={`More for ${r.title}`}
                aria-expanded={open}
                className='inline-flex size-8 items-center justify-center rounded-lg text-white/50 hover:bg-white/[0.06] hover:text-white disabled:opacity-40'>
                <MoreHorizontal className='size-4' />
            </button>
            {open && (
                <>
                    <button
                        aria-label='Close'
                        className='fixed inset-0 z-40 cursor-default'
                        onClick={() => setOpen(false)}
                    />
                    <div
                        role='menu'
                        className='dark-panel absolute top-9 right-0 z-50 w-44 overflow-hidden rounded-xl border border-white/10 bg-[var(--sidebar-bg)] p-1 shadow-2xl'>
                        <MenuItem
                            onClick={() =>
                                call(`/api/admin/recurring/${r.id}/runs`, 'POST', { status: 'ok' }, 'Run logged')
                            }>
                            Log a run (ok)
                        </MenuItem>
                        <MenuItem onClick={() => call(`/api/admin/recurring/${r.id}`, 'PATCH', { active: !r.active })}>
                            {r.active ? 'Pause' : 'Resume'}
                        </MenuItem>
                        <MenuItem
                            danger
                            onClick={() =>
                                window.confirm(`Delete "${r.title}" and its run history?`) &&
                                call(`/api/admin/recurring/${r.id}`, 'DELETE', undefined, 'Deleted')
                            }>
                            Delete
                        </MenuItem>
                    </div>
                </>
            )}
        </div>
    );
}

function MenuItem({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) {
    return (
        <button
            role='menuitem'
            onClick={onClick}
            className={cn(
                'block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/[0.06]',
                danger ? 'text-rose-300' : 'text-white/85'
            )}>
            {children}
        </button>
    );
}
