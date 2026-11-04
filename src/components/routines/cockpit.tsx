'use client';

// /routines: every routine and check as a cockpit. On top the day in numbers; then a search, filters and the kinds
// (finance, ops, …) as chips; then the routines in sections, by how often they come back (every few hours, daily,
// weekly) or by kind. Each is a tile (or, as an option, a compact row): its state today as a light and a dial, when
// it's next due, who runs it and its last 7 days. A tile opens to its steps, checks and definition of done, a box to
// request a change, its runs and its history; "…" holds Log a run, Pause and Delete. Times are Bangkok time.
import { useEffect, useMemo, useState } from 'react';

import { useRouter } from 'next/navigation';

import { Avatar, domainHex } from '@/components/review/parts';
import type { Frequency, RoutineView } from '@/lib/recurring';
import type { RoutineState } from '@/lib/schedule';
import { cn } from '@/lib/utils';

import {
    CalendarClock,
    Check,
    ChevronDown,
    Clock3,
    LayoutGrid,
    List,
    MoreHorizontal,
    Pause,
    Search,
    TriangleAlert,
    X
} from 'lucide-react';
import { toast } from 'sonner';

const POLL_MS = 60_000;
const TZ = 'Asia/Bangkok';
/** The viewer's choice of tiles or rows, and of grouping (tiles and frequency unless changed). */
const VIEW_KEY = 'routines-view-v2';
const GROUP_KEY = 'routines-group';
const NO_KIND = '__none';

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
    const [kind, setKind] = useState<string | null>(null);
    const [view, setView] = useState<'list' | 'cards'>('cards');
    const [group, setGroup] = useState<'frequency' | 'kind'>('frequency');
    const [open, setOpen] = useState<string | null>(null);

    useEffect(() => setProject(initialProject ?? ''), [initialProject]);
    useEffect(() => {
        try {
            if (localStorage.getItem(VIEW_KEY) === 'list') setView('list');
            if (localStorage.getItem(GROUP_KEY) === 'kind') setGroup('kind');
        } catch {
            // No storage: tiles by frequency.
        }
    }, []);
    const remember = (key: string, value: string) => {
        try {
            localStorage.setItem(key, value);
        } catch {
            // As above.
        }
    };
    const pickView = (v: 'list' | 'cards') => {
        setView(v);
        remember(VIEW_KEY, v);
    };
    const pickGroup = (g: 'frequency' | 'kind') => {
        setGroup(g);
        remember(GROUP_KEY, g);
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
    const scope = routines.filter((r) => !project || r.project.slug === project);
    // The kinds in view, with how many each; routines without one under "No kind", last.
    const kinds = useMemo(() => {
        const count = new Map<string, number>();
        for (const r of scope) count.set(r.domain || NO_KIND, (count.get(r.domain || NO_KIND) ?? 0) + 1);

        return [...count.entries()].sort(
            ([a], [b]) => Number(a === NO_KIND) - Number(b === NO_KIND) || a.localeCompare(b)
        );
    }, [scope]);
    const q = query.trim().toLowerCase();
    const shown = scope.filter(
        (r) =>
            (!owner || r.owner === owner) &&
            (!frequency || r.frequency === frequency) &&
            (kind === null || (r.domain || NO_KIND) === kind) &&
            STATUS_FILTER[status].has(r.status.state) &&
            (!q ||
                `${r.title} ${r.summary} ${r.owner} ${r.reviewer} ${r.domain} ${r.steps.join(' ')} ${r.checks.join(' ')}`
                    .toLowerCase()
                    .includes(q))
    );
    const byTime = (a: RoutineView, b: RoutineView) =>
        a.sortKey.localeCompare(b.sortKey) || a.title.localeCompare(b.title);
    const sections =
        group === 'frequency'
            ? SECTIONS.map(({ key, label }) => ({ key, label, items: shown.filter((r) => r.frequency === key) }))
            : kinds.map(([k]) => ({
                  key: k,
                  label: k === NO_KIND ? 'No kind' : k,
                  items: shown.filter((r) => (r.domain || NO_KIND) === k)
              }));

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
                    <div className='track flex shrink-0 rounded-xl p-1' role='group' aria-label='Group by'>
                        {(['frequency', 'kind'] as const).map((g) => (
                            <button
                                key={g}
                                onClick={() => pickGroup(g)}
                                aria-pressed={group === g}
                                className={cn(
                                    'inline-flex h-8 items-center rounded-lg px-3 text-sm',
                                    group === g ? 'btn-key' : 'text-white/50'
                                )}>
                                {g === 'frequency' ? 'By frequency' : 'By kind'}
                            </button>
                        ))}
                    </div>
                    <div className='track flex shrink-0 rounded-xl p-1' role='group' aria-label='View'>
                        {(['list', 'cards'] as const).map((v) => (
                            <button
                                key={v}
                                onClick={() => pickView(v)}
                                aria-pressed={view === v}
                                aria-label={v === 'list' ? 'Rows' : 'Tiles'}
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

            {kinds.length > 1 && (
                <div className='no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0'>
                    <KindChip active={kind === null} onClick={() => setKind(null)}>
                        All kinds
                    </KindChip>
                    {kinds.map(([k, n]) => (
                        <KindChip
                            key={k}
                            active={kind === k}
                            hex={k === NO_KIND ? undefined : domainHex(k)}
                            onClick={() => setKind(kind === k ? null : k)}>
                            {k === NO_KIND ? 'No kind' : k} <span className='text-white/35'>{n}</span>
                        </KindChip>
                    ))}
                </div>
            )}

            {shown.length ? (
                sections.map(({ key, label, items: unsorted }) => {
                    const items = [...unsorted].sort(byTime);
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
                                <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
                                    {items.map((r) => (
                                        <Tile
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
    // Too few days to draw a line: the percentage next to it says enough.
    if (known.length < 2) return null;
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
                            <Flags routine={r} />
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

/** "in 12m", "in 2h 15m", "in 3d": how long until a due time. */
function until(iso: string | null) {
    if (!iso) return '';
    const min = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
    if (min <= 0) return 'now';
    if (min < 60) return `in ${min}m`;
    if (min < 60 * 24) return `in ${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`;

    return `in ${Math.round(min / (60 * 24))}d`;
}

function StateIcon({ state, className }: { state: RoutineState; className?: string }) {
    if (state === 'done' || state === 'on_track') return <Check className={className} />;
    if (state === 'late' || state === 'failed') return <TriangleAlert className={className} />;
    if (state === 'paused') return <Pause className={className} />;
    if (state === 'not_today') return <CalendarClock className={className} />;

    return <Clock3 className={className} />;
}

/** Today's due times covered, as a dial around the state's icon. */
function Dial({ routine: r }: { routine: RoutineView }) {
    const s = STATE[r.status.state];
    const total = r.status.dueSoFar + r.status.remaining;
    const part = total ? r.status.coveredSoFar / total : r.status.state === 'done' ? 1 : 0;
    const R = 26;
    const C = 2 * Math.PI * R;

    return (
        <div className='relative size-16 shrink-0'>
            <svg viewBox='0 0 64 64' className='size-16 -rotate-90' aria-hidden>
                <circle cx='32' cy='32' r={R} fill='none' stroke='rgb(0 0 0 / 0.35)' strokeWidth='5' />
                {part > 0 && (
                    <circle
                        cx='32'
                        cy='32'
                        r={R}
                        fill='none'
                        stroke={s.hex}
                        strokeWidth='5'
                        strokeLinecap='round'
                        strokeDasharray={`${C * part} ${C}`}
                        style={{ filter: `drop-shadow(0 0 5px ${s.hex}99)` }}
                    />
                )}
            </svg>
            <span className='absolute inset-0 flex items-center justify-center' style={{ color: s.hex }}>
                <StateIcon state={r.status.state} className='size-6' />
            </span>
        </div>
    );
}

/** The last 7 days as bars: height and colour by how many due times a run covered (grey: nothing due). */
function Week({ values }: { values: (number | null)[] }) {
    return (
        <span className='flex h-6 items-end gap-1' aria-label='Last 7 days'>
            {values.map((v, i) => (
                <span
                    key={i}
                    className='w-2 rounded-sm'
                    style={{
                        height: v === null ? 4 : `${Math.max(18, v * 100)}%`,
                        background:
                            v === null
                                ? 'rgb(255 255 255 / 0.12)'
                                : v >= 0.999
                                  ? '#34d399'
                                  : v >= 0.5
                                    ? '#d4b062'
                                    : '#f43f5e'
                    }}
                />
            ))}
        </span>
    );
}

/** A routine as a cockpit tile: its kind, its state today as a light and a dial, when it's next due, who, its week. */
function Tile({
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
    const s = STATE[r.status.state];
    const last = lastRun(r);
    const alarm = r.status.state === 'late' || r.status.state === 'failed';
    const total = r.status.dueSoFar + r.status.remaining;

    return (
        <article
            className={cn(
                'bg-card panel flex flex-col overflow-hidden rounded-2xl border shadow-[var(--shadow-card)] transition-shadow',
                !r.active && 'opacity-55',
                expanded && 'sm:col-span-2'
            )}
            style={
                alarm
                    ? { borderColor: `${s.hex}55`, boxShadow: `0 0 0 1px ${s.hex}22, 0 18px 40px -24px ${s.hex}88` }
                    : undefined
            }>
            <div className='h-0.5' style={{ background: `linear-gradient(90deg, ${s.hex}, transparent)` }} />
            <div className='flex items-center gap-2 px-4 pt-3'>
                {r.domain ? (
                    <span
                        className='inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium'
                        style={{
                            borderColor: `${domainHex(r.domain)}55`,
                            background: `${domainHex(r.domain)}1a`,
                            color: domainHex(r.domain)
                        }}>
                        {r.domain}
                    </span>
                ) : (
                    <span className='label-xs text-white/25'>no kind</span>
                )}
                {showProject && <ProjectDot project={r.project} />}
                <Flags routine={r} />
                <span className='ml-auto'>
                    <Menu routine={r} />
                </span>
            </div>

            <button
                onClick={onToggle}
                aria-expanded={expanded}
                className='flex flex-1 flex-col gap-3 px-4 pt-1 pb-4 text-left'>
                <span>
                    <span className='block text-[17px] leading-snug font-medium'>{r.title}</span>
                    {r.summary && <span className='block truncate text-[13px] text-white/50'>{r.summary}</span>}
                </span>

                <span className='flex items-center gap-3.5'>
                    <Dial routine={r} />
                    <span className='min-w-0'>
                        <span className='block text-lg leading-tight font-light' style={{ color: s.hex }}>
                            {s.label}
                            {total > 1 && (
                                <span className='readout ml-2 text-sm text-white/45'>
                                    {r.status.coveredSoFar}/{total}
                                </span>
                            )}
                        </span>
                        <span className='mt-0.5 block truncate text-[13px] text-white/65'>{r.schedule}</span>
                        <span className='readout mt-0.5 block text-xs text-white/45'>
                            {r.status.next ? `next ${when(r.status.next)} · ${until(r.status.next)}` : 'not scheduled'}
                        </span>
                    </span>
                </span>

                <span className='mt-auto flex items-end justify-between gap-3 border-t border-white/[0.06] pt-3'>
                    <span className='flex items-end gap-2.5'>
                        <Week values={r.status.spark} />
                        <span className='readout text-xs text-white/50'>
                            <span className='block text-[10px] tracking-[0.1em] text-white/30 lowercase'>7 days</span>
                            {pct(r.status.hit7)}
                        </span>
                    </span>
                    <span className='flex min-w-0 flex-col items-end gap-1 text-right'>
                        <Person name={r.owner} />
                        <span className='readout text-[11px] text-white/40'>last {last ? when(last.ran_at) : '–'}</span>
                    </span>
                </span>
            </button>
            {expanded && <Details routine={r} />}
        </article>
    );
}

function KindChip({
    active,
    hex,
    onClick,
    children
}: {
    active: boolean;
    hex?: string;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm capitalize',
                active ? 'text-white' : 'border-white/[0.08] text-white/60'
            )}
            style={active ? { borderColor: `${hex ?? '#ffffff'}80`, background: `${hex ?? '#ffffff'}1f` } : undefined}>
            {hex && <span className='size-2 rounded-full' style={{ background: hex, boxShadow: `0 0 8px ${hex}99` }} />}
            {children}
        </button>
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

/** A routine whose steps and checks are still missing, or with changes waiting, says so on its tile or row. */
function Flags({ routine: r }: { routine: RoutineView }) {
    const open = r.requests.filter((x) => x.status === 'open').length;

    return (
        <>
            {!r.steps.length && !r.checks.length && (
                <span className='shrink-0 rounded-full border border-amber-300/25 px-2 py-0.5 text-[11px] text-amber-200/80'>
                    no steps
                </span>
            )}
            {open > 0 && (
                <span className='shrink-0 rounded-full border border-[var(--brand)]/40 px-2 py-0.5 text-[11px] text-[var(--brand)]'>
                    {open} change{open > 1 ? 's' : ''} open
                </span>
            )}
        </>
    );
}

const NotDocumented = () => <p className='text-sm text-amber-200/70'>Not documented yet.</p>;

/** Opened: what it does (steps, checks, definition of done), the changes asked for, its runs and its history. */
function Details({ routine: r }: { routine: RoutineView }) {
    const last = lastRun(r);
    const results = new Map(last?.checks.map((c) => [c.check, c]));

    return (
        <div className='grid gap-5 border-t bg-black/15 px-4 py-4 lg:grid-cols-2'>
            <div className='flex min-w-0 flex-col gap-4'>
                {r.description && (
                    <div>
                        <p className='label-xs mb-1.5 text-white/40'>what it does</p>
                        <p className='text-sm leading-relaxed whitespace-pre-wrap text-white/75'>{r.description}</p>
                    </div>
                )}
                <div>
                    <p className='label-xs mb-1.5 text-white/40'>steps</p>
                    {r.steps.length ? (
                        <ol className='flex flex-col gap-1.5'>
                            {r.steps.map((s, i) => (
                                <li key={i} className='flex gap-2.5 text-sm leading-snug text-white/80'>
                                    <span className='readout w-4 shrink-0 text-right text-white/40'>{i + 1}</span>
                                    <span className='min-w-0'>{s}</span>
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <NotDocumented />
                    )}
                </div>
                <div>
                    <p className='label-xs mb-1.5 text-white/40'>
                        checks{last?.checks.length ? ` · last run ${when(last.ran_at)}` : ''}
                    </p>
                    {r.checks.length ? (
                        <ul className='flex flex-col gap-1.5'>
                            {r.checks.map((c, i) => {
                                const result = results.get(c);

                                return (
                                    <li key={i} className='flex gap-2 text-sm leading-snug text-white/80'>
                                        <CheckMark ok={result?.ok} />
                                        <span className='min-w-0'>
                                            {c}
                                            {result?.note && (
                                                <span className='block text-[13px] text-white/50'>{result.note}</span>
                                            )}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <NotDocumented />
                    )}
                </div>
                <div>
                    <p className='label-xs mb-1.5 text-white/40'>definition of done</p>
                    {r.definitionOfDone ? (
                        <p className='text-sm leading-relaxed whitespace-pre-wrap text-white/80'>
                            {r.definitionOfDone}
                        </p>
                    ) : (
                        <NotDocumented />
                    )}
                </div>
            </div>

            <div className='flex min-w-0 flex-col gap-4'>
                <Requests routine={r} />
                <div>
                    <p className='label-xs mb-1.5 text-white/40'>
                        runs · {r.status.coveredSoFar}/{r.status.dueSoFar} today so far
                        {r.status.remaining ? ` · ${r.status.remaining} to come` : ''}
                    </p>
                    <Runs routine={r} />
                </div>
                {r.changes.length > 0 && <History routine={r} />}
            </div>
        </div>
    );
}

/** A check's result on the last run: passed, failed, or nothing reported. */
function CheckMark({ ok }: { ok?: boolean }) {
    if (ok === undefined) return <span className='mt-[7px] mr-1 ml-1 size-1.5 shrink-0 rounded-full bg-white/25' />;

    return ok ? (
        <Check className='mt-0.5 size-3.5 shrink-0 text-emerald-400' aria-label='Passed' />
    ) : (
        <X className='mt-0.5 size-3.5 shrink-0 text-rose-400' aria-label='Failed' />
    );
}

const REQUEST_STATE = {
    open: { label: 'Open', className: 'text-[var(--brand)]' },
    done: { label: 'Done', className: 'text-emerald-400' },
    declined: { label: 'Declined', className: 'text-white/50' }
} as const;

/** Ask the owner for a change, and what came of earlier requests. */
function Requests({ routine: r }: { routine: RoutineView }) {
    const router = useRouter();
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const send = async () => {
        setBusy(true);
        const res = await fetch(`/api/admin/recurring/${r.id}/requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request: text })
        }).catch(() => null);
        setBusy(false);
        if (!res?.ok) {
            const { error } = ((await res?.json().catch(() => null)) ?? {}) as { error?: string };

            return void toast.error(error ?? 'No connection');
        }
        setText('');
        toast('Change requested', { description: r.owner ? `Sent to ${r.owner}` : r.title });
        router.refresh();
    };

    return (
        <div>
            <p className='label-xs mb-1.5 text-white/40'>request a change</p>
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder='What should change in this routine?'
                aria-label={`Request a change to ${r.title}`}
                className='track w-full resize-y rounded-xl px-3 py-2 text-sm outline-none placeholder:text-white/35 focus:ring-2 focus:ring-[var(--ring)]'
            />
            <button
                onClick={send}
                disabled={busy || !text.trim()}
                className='btn-key mt-1.5 inline-flex h-9 items-center rounded-lg px-3.5 text-sm disabled:opacity-40'>
                Request change
            </button>
            {r.requests.length > 0 && (
                <ul className='mt-3 flex flex-col gap-2.5'>
                    {r.requests.slice(0, 10).map((x) => (
                        <li key={x.id} className='text-sm'>
                            <span className='flex items-center gap-2 text-xs'>
                                <span className={REQUEST_STATE[x.status].className}>
                                    {REQUEST_STATE[x.status].label}
                                </span>
                                <span className='readout text-white/40'>{when(x.created_at)}</span>
                            </span>
                            <span className='block whitespace-pre-wrap text-white/80'>{x.body}</span>
                            {x.reply && (
                                <span className='mt-0.5 block text-[13px] whitespace-pre-wrap text-white/50'>
                                    {x.by ? `${x.by}: ` : ''}
                                    {x.reply}
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

const FIELD_LABEL: Record<string, string> = {
    steps: 'Steps',
    checks: 'Checks',
    definition_of_done: 'Definition of done',
    description: 'Description'
};

/** What changed in the routine, and who changed it. */
function History({ routine: r }: { routine: RoutineView }) {
    return (
        <div>
            <p className='label-xs mb-1.5 text-white/40'>history</p>
            <ul className='flex flex-col gap-2'>
                {r.changes.slice(0, 10).map((x) => {
                    const before = Array.isArray(x.before) ? x.before : [];
                    const after = Array.isArray(x.after) ? x.after : [];
                    const added = after.filter((l) => !before.includes(l));
                    const removed = before.filter((l) => !after.includes(l));

                    return (
                        <li key={x.id} className='text-sm'>
                            <span className='text-white/75'>
                                {FIELD_LABEL[x.field] ?? x.field} changed
                                {x.agent && <span className='text-white/40'> · {x.agent}</span>}
                            </span>
                            <span className='readout ml-2 text-xs text-white/40'>{when(x.created_at)}</span>
                            {added.map((l, i) => (
                                <span key={`a${i}`} className='block text-[13px] text-emerald-300/80'>
                                    + {l}
                                </span>
                            ))}
                            {removed.map((l, i) => (
                                <span key={`r${i}`} className='block text-[13px] text-rose-300/80'>
                                    − {l}
                                </span>
                            ))}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function Runs({ routine: r }: { routine: RoutineView }) {
    return (
        <>
            {r.runs.length ? (
                <ul className='flex flex-col gap-1'>
                    {r.runs.slice(0, 10).map((x) => (
                        <li key={x.id} className='flex items-start gap-2 text-sm'>
                            <span
                                className='mt-1.5 size-1.5 shrink-0 rounded-full'
                                style={{ background: RUN_HEX[x.status] }}
                            />
                            {/* A missed one shows the due time nobody covered; a reported one when it ran. */}
                            <span className='readout w-28 shrink-0 text-white/55'>
                                {when(x.status === 'missed' ? x.due_at : x.ran_at)}
                            </span>
                            <span className='min-w-0 text-white/75'>
                                {x.status === 'missed'
                                    ? 'Missed · sent to Review'
                                    : x.status === 'failed'
                                      ? 'Failed'
                                      : 'Ok'}
                                {x.agent && <span className='text-white/40'> · {x.agent}</span>}
                                {x.note && <span className='block truncate text-white/50'>{x.note}</span>}
                                {x.checks.length > 0 && (
                                    <span className='block text-[13px] text-white/50'>
                                        {x.checks.filter((c) => c.ok).length}/{x.checks.length} checks ok
                                    </span>
                                )}
                                {x.checks
                                    .filter((c) => !c.ok)
                                    .map((c, i) => (
                                        <span key={i} className='block text-[13px] text-rose-300/80'>
                                            {c.check}
                                            {c.note ? `: ${c.note}` : ''}
                                        </span>
                                    ))}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className='text-sm text-white/40'>No runs reported yet.</p>
            )}
        </>
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
