// Routines: the work that comes back (a daily VPS check, the Sunday payouts, a check every 10 minutes). Agents report
// each run (ok or failed); the schedule (src/lib/schedule.ts) says when one is due. Runs live in routine_runs, not on
// the board: only a failed run, or one that didn't come in time, becomes a card on Review. Server only.
import { type Rule, type RunLike, type Status, dateIn, statusOf, timeIn } from '@/lib/schedule';
import { db } from '@/lib/supabase';
import { notifyNewTask, notifyRoutineRequest } from '@/lib/webhooks';

import 'server-only';
import { z } from 'zod';

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Day = (typeof DAYS)[number];

const at = z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time HH:MM, e.g. 19:45'))
    .max(24, 'at most 24 times')
    .optional();

/** How often, and at what time of day, as the API takes and gives it. */
export const Schedule = z.discriminatedUnion(
    'every',
    [
        z.strictObject({ every: z.literal('day'), at }),
        z.strictObject({
            every: z.literal('week'),
            days: z
                .array(z.enum(DAYS, `one of ${DAYS.join(', ')}`))
                .min(1, 'at least one day')
                .max(7),
            at
        }),
        z.strictObject({ every: z.literal('month'), day: z.number().int().min(1, '1–31').max(31, '1–31'), at }),
        z.strictObject({
            every: z.literal('n_days'),
            n: z.number().int().min(2, '2–365').max(365, '2–365'),
            /** The first day it runs (YYYY-MM-DD); today when left out. */
            from: z.iso.date('a date, e.g. 2026-11-03').optional(),
            at
        }),
        z.strictObject({ every: z.literal('hours'), n: z.number().int().min(1, '1–24').max(24, '1–24') }),
        z.strictObject({ every: z.literal('minutes'), n: z.number().int().min(5, '5–1440').max(1440, '5–1440') })
    ],
    'every: one of day, week, month, n_days, hours, minutes'
);
export type Schedule = z.infer<typeof Schedule>;

export const validTimezone = (tz: string) => {
    try {
        new Intl.DateTimeFormat('en', { timeZone: tz });

        return true;
    } catch {
        return false;
    }
};

export type RecurringRow = Rule & {
    id: string;
    project_id: string;
    title: string;
    summary: string | null;
    description: string | null;
    steps: string[];
    checks: string[];
    definition_of_done: string | null;
    context: string | null;
    priority: string;
    domain: string | null;
    impact: string | null;
    effort: string | null;
    owner_id: string;
    reviewer_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    project?: { slug: string; name: string };
    owner?: { name: string } | null;
    reviewer?: { name: string } | null;
    creator?: { name: string } | null;
};

export const RECURRING_SELECT =
    '*, project:projects!inner(slug, name), owner:agents!owner_id(name), reviewer:agents!reviewer_id(name), creator:agents!created_by(name)';

/** The schedule columns for a Schedule. */
export function scheduleColumns(s: Schedule, today: string) {
    const intraday = s.every === 'hours' || s.every === 'minutes';

    return {
        every: intraday ? 'intraday' : s.every,
        weekdays: s.every === 'week' ? [...new Set(s.days.map((d) => DAYS.indexOf(d)))].sort() : [],
        month_day: s.every === 'month' ? s.day : null,
        interval_days: s.every === 'n_days' ? s.n : null,
        anchor_on: s.every === 'n_days' ? (s.from ?? today) : today,
        times: intraday ? [] : [...new Set(s.at ?? [])].sort(),
        every_minutes: s.every === 'hours' ? s.n * 60 : s.every === 'minutes' ? s.n : null
    };
}

export function scheduleOf(r: RecurringRow): Schedule {
    const at = r.times.length ? { at: r.times } : {};
    if (r.every === 'intraday') {
        const m = r.every_minutes ?? 60;

        return m % 60 === 0 ? { every: 'hours', n: m / 60 } : { every: 'minutes', n: m };
    }
    if (r.every === 'week') return { every: 'week', days: r.weekdays.map((d) => DAYS[d]), ...at };
    if (r.every === 'month') return { every: 'month', day: r.month_day ?? 1, ...at };
    if (r.every === 'n_days') return { every: 'n_days', n: r.interval_days ?? 2, from: r.anchor_on, ...at };

    return { every: 'day', ...at };
}

const tzLabel = (tz: string) => (tz === 'Asia/Bangkok' ? 'BKK' : tz.split('/').pop()!.replace('_', ' '));
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Daily 19:45 BKK", "Mon–Sat 04:30, 16:30 BKK", "Every 4 hours", "Sun 13:00 BKK": for the cockpit. */
export function describe(r: RecurringRow) {
    if (r.every === 'intraday') {
        const m = r.every_minutes ?? 60;

        return m % 60 === 0 ? (m === 60 ? 'Every hour' : `Every ${m / 60} hours`) : `Every ${m} min`;
    }
    const when = r.times.length ? ` ${r.times.join(', ')} ${tzLabel(r.timezone)}` : '';
    if (r.every === 'day') return `Daily${when}`;
    if (r.every === 'month') return `Monthly on day ${r.month_day}${when}`;
    if (r.every === 'n_days') return `Every ${r.interval_days} days${when}`;
    const d = [...r.weekdays].sort();
    const run = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
    const days =
        d.length === 7
            ? 'Daily'
            : run
              ? `${DAY_NAMES[d[0]]}–${DAY_NAMES[d.at(-1)!]}`
              : d.map((x) => DAY_NAMES[x]).join(', ');

    return `${days}${when}`;
}

/** The cockpit's sections: how often a routine comes back. */
export type Frequency = 'ongoing' | 'daily' | 'weekly' | 'other';

export function frequencyOf(r: Pick<RecurringRow, 'every' | 'times' | 'weekdays'>): Frequency {
    if (r.every === 'intraday' || r.times.length > 1) return 'ongoing';
    if (r.every === 'day' || (r.every === 'week' && r.weekdays.length >= 5)) return 'daily';
    if (r.every === 'week') return 'weekly';

    return 'other';
}

/** What one check gave on a run. */
export const CheckResult = z.strictObject({
    check: z.string().trim().min(1, 'is required').max(500, 'at most 500 characters'),
    ok: z.boolean('true or false'),
    note: z.string().trim().max(1000, 'at most 1000 characters').optional()
});
export type CheckResult = z.infer<typeof CheckResult>;

export type RunRow = RunLike & {
    id: string;
    note: string | null;
    check_results: CheckResult[];
    agent: { name: string } | null;
    task_id: string | null;
};

/** The last 8 days of runs of these routines (enough for today, the late check and the 7-day rate). */
export async function recentRuns(ids: string[]): Promise<Map<string, RunRow[]>> {
    const out = new Map<string, RunRow[]>(ids.map((id) => [id, []]));
    if (!ids.length) return out;
    const since = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const { data, error } = await db()
        .from('routine_runs')
        .select('id, recurring_id, status, due_at, ran_at, note, check_results, task_id, agent:agents(name)')
        .in('recurring_id', ids)
        .gte('ran_at', since)
        .order('ran_at', { ascending: false });
    if (error) throw new Error(error.message);
    for (const r of data as unknown as (RunRow & { recurring_id: string })[]) out.get(r.recurring_id)?.push(r);

    return out;
}

export function apiRecurring(r: RecurringRow, status?: Status, last?: RunRow) {
    return {
        id: r.id,
        project: r.project?.slug ?? null,
        title: r.title,
        summary: r.summary,
        description: r.description,
        steps: r.steps,
        checks: r.checks,
        definition_of_done: r.definition_of_done,
        context: r.context,
        priority: r.priority,
        domain: r.domain,
        owner: r.owner?.name ?? null,
        reviewer: r.reviewer?.name ?? null,
        created_by: r.creator?.name ?? null,
        schedule: scheduleOf(r),
        grace_minutes: r.grace_minutes,
        timezone: r.timezone,
        active: r.active,
        ...(status
            ? {
                  state: status.state,
                  next_due: status.next?.toISOString() ?? null,
                  hit_rate_7d: status.hit7,
                  last_run: last
                      ? { status: last.status, ran_at: last.ran_at, note: last.note, checks: last.check_results }
                      : null
              }
            : {}),
        created_at: r.created_at,
        updated_at: r.updated_at
    };
}

// ---- Runs, and what reaches Review -------------------------------------------------------------------------------

const CLOSED = ['approved', 'rejected'];

/**
 * A card on Review for a routine that failed or didn't run in time, unless one for it is still open there (one card
 * per routine at a time, so a stuck check every 10 minutes doesn't flood Review). Returns the card's id.
 */
async function raiseCard(r: RecurringRow, kind: 'failed' | 'late', due: Date | null, note: string | null) {
    const open = await db()
        .from('tasks')
        .select('id')
        .eq('recurring_id', r.id)
        .not('status', 'in', `(${CLOSED.join(',')})`)
        .limit(1)
        .maybeSingle();
    if (open.data) return open.data.id as string;

    const when = due ? `${dateIn(r.timezone, due)} ${timeIn(r.timezone, due)} ${tzLabel(r.timezone)}` : '';
    const { data, error } = await db()
        .from('tasks')
        .insert({
            project_id: r.project_id,
            recurring_id: r.id,
            title: `${r.title} · ${kind === 'failed' ? 'failed' : 'late'}`.slice(0, 200),
            summary: (kind === 'failed'
                ? (note ?? 'The run reported a failure')
                : `No run by ${when || 'its due time'}`
            ).slice(0, 300),
            description: r.description,
            context: kind === 'failed' && note && note.length > 300 ? note : r.context,
            status: 'review',
            priority: r.priority === 'urgent' ? 'urgent' : 'high',
            domain: r.domain,
            owner_id: r.owner_id,
            created_by: r.created_by,
            images: []
        })
        .select('id, title')
        .single();
    if (error) throw new Error(error.message);
    await notifyNewTask({ taskId: data.id as string, title: data.title as string, ownerId: r.owner_id });

    return data.id as string;
}

/** A run an agent reports. A failed one also goes to Review. */
export async function reportRun(
    r: RecurringRow,
    run: { status: 'ok' | 'failed'; note?: string; checks?: CheckResult[]; ran_at?: string; agentId: string | null }
): Promise<RunRow & { review_task: string | null }> {
    const ranAt = run.ran_at ?? new Date().toISOString();
    const failed = (run.checks ?? []).filter((c) => !c.ok).map((c) => (c.note ? `${c.check}: ${c.note}` : c.check));
    const why = run.note ?? (failed.length ? `Failed checks: ${failed.join('; ')}` : null);
    const task = run.status === 'failed' ? await raiseCard(r, 'failed', null, why) : null;
    const { data, error } = await db()
        .from('routine_runs')
        .insert({
            recurring_id: r.id,
            status: run.status,
            ran_at: ranAt,
            note: run.note ?? null,
            check_results: run.checks ?? [],
            agent_id: run.agentId,
            task_id: task
        })
        .select('id, status, due_at, ran_at, note, check_results, task_id, agent:agents(name)')
        .single();
    if (error) throw new Error(error.message);

    return { ...(data as unknown as RunRow), review_task: task };
}

/**
 * The late check: the latest due time in the last 2 days that no run covered is noted as missed (once), and the
 * routine gets a card on Review. Runs every morning (cron) and whenever Review or Routines opens. Safe to call often.
 */
export async function checkRoutines(now = new Date()): Promise<{ late: string[] }> {
    const { data, error } = await db().from('recurring').select('*').eq('active', true);
    if (error) throw new Error(error.message);
    const rows = data as RecurringRow[];
    const runs = await recentRuns(rows.map((r) => r.id));
    const late: string[] = [];

    for (const r of rows) {
        // statusOf leaves out due times from before the routine existed.
        const missed = statusOf(r, runs.get(r.id) ?? [], now).missed;
        if (!missed.length) continue;
        const noted = new Set(
            (runs.get(r.id) ?? []).filter((x) => x.status === 'missed').map((x) => new Date(x.due_at!).getTime())
        );
        // The latest one is enough: a check every 10 min that stopped hours ago is one problem, not dozens.
        const latest = missed.at(-1)!;
        if (noted.has(latest.getTime())) continue;
        try {
            const task = await raiseCard(r, 'late', latest, null);
            const ins = await db().from('routine_runs').insert({
                recurring_id: r.id,
                status: 'missed',
                due_at: latest.toISOString(),
                ran_at: now.toISOString(),
                task_id: task
            });
            if (ins.error && !ins.error.message.includes('duplicate')) throw new Error(ins.error.message);
            late.push(r.title);
        } catch (err) {
            console.error(`Late check "${r.title}":`, (err as Error).message);
        }
    }

    return { late };
}

// ---- Change requests and history ---------------------------------------------------------------------------------

export type RequestRow = {
    id: string;
    recurring_id: string;
    body: string;
    status: 'open' | 'done' | 'declined';
    reply: string | null;
    created_at: string;
    resolved_at: string | null;
    resolver: { name: string } | null;
};
export const REQUEST_SELECT =
    'id, recurring_id, body, status, reply, created_at, resolved_at, resolver:agents!resolved_by(name)';

export const apiRequest = (x: RequestRow) => ({
    id: x.id,
    routine: x.recurring_id,
    request: x.body,
    status: x.status,
    reply: x.reply,
    created_at: x.created_at,
    resolved_at: x.resolved_at,
    resolved_by: x.resolver?.name ?? null
});

type ChangeRow = {
    id: string;
    recurring_id: string;
    field: string;
    before: string | string[] | null;
    after: string | string[] | null;
    created_at: string;
    agent: { name: string } | null;
};

export const apiChange = (x: ChangeRow) => ({
    field: x.field,
    before: x.before,
    after: x.after,
    agent: x.agent?.name ?? null,
    created_at: x.created_at
});

/** The change requests and the history of these routines, newest first. */
export async function playbookLog(ids: string[]) {
    const requests = new Map<string, RequestRow[]>(ids.map((id) => [id, []]));
    const changes = new Map<string, ChangeRow[]>(ids.map((id) => [id, []]));
    if (!ids.length) return { requests, changes };
    const [req, chg] = await Promise.all([
        db()
            .from('routine_requests')
            .select(REQUEST_SELECT)
            .in('recurring_id', ids)
            .order('created_at', { ascending: false })
            .limit(500),
        db()
            .from('routine_changes')
            .select('id, recurring_id, field, before, after, created_at, agent:agents(name)')
            .in('recurring_id', ids)
            .order('created_at', { ascending: false })
            .limit(500)
    ]);
    if (req.error) throw new Error(req.error.message);
    if (chg.error) throw new Error(chg.error.message);
    for (const x of req.data as unknown as RequestRow[]) requests.get(x.recurring_id)?.push(x);
    for (const x of chg.data as unknown as ChangeRow[]) changes.get(x.recurring_id)?.push(x);

    return { requests, changes };
}

/** A change Richie asks for: stored as open, and sent to the routine's owner and the project's lead(s). */
export async function addRequest(r: RecurringRow, body: string) {
    const { data, error } = await db()
        .from('routine_requests')
        .insert({ recurring_id: r.id, body })
        .select(REQUEST_SELECT)
        .single();
    if (error) throw new Error(error.message);
    const request = data as unknown as RequestRow;
    await notifyRoutineRequest({
        requestId: request.id,
        routineId: r.id,
        title: r.title,
        project: r.project?.slug ?? '',
        projectId: r.project_id,
        ownerId: r.owner_id,
        request: body
    });

    return request;
}

const LOGGED = ['steps', 'checks', 'definition_of_done', 'description'] as const;

/** Notes what changed in a routine's steps, checks, definition of done or description. A failure is only logged. */
export async function logChanges(before: RecurringRow, after: RecurringRow, agentId: string) {
    const rows = LOGGED.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f])).map((field) => ({
        recurring_id: before.id,
        field,
        before: before[field],
        after: after[field],
        agent_id: agentId
    }));
    if (!rows.length) return;
    const { error } = await db().from('routine_changes').insert(rows);
    if (error) console.error(`History of "${before.title}":`, error.message);
}

// ---- The cockpit -------------------------------------------------------------------------------------------------

export type RoutineView = {
    id: string;
    project: { slug: string; name: string };
    title: string;
    summary: string;
    description: string;
    steps: string[];
    checks: string[];
    definitionOfDone: string;
    /** Its kind (finance, ops, …): the routine's domain, or '' when none is set. */
    domain: string;
    schedule: string;
    frequency: Frequency;
    /** Sort key within a section: the first time of day (HH:MM), or the interval for "every N". */
    sortKey: string;
    owner: string;
    reviewer: string;
    active: boolean;
    status: Omit<Status, 'next' | 'missed'> & { next: string | null };
    runs: {
        id: string;
        status: string;
        ran_at: string;
        due_at: string | null;
        note: string | null;
        checks: CheckResult[];
        agent: string | null;
        task_id: string | null;
    }[];
    /** The changes Richie asked for, newest first. */
    requests: {
        id: string;
        body: string;
        status: RequestRow['status'];
        reply: string | null;
        by: string | null;
        created_at: string;
        resolved_at: string | null;
    }[];
    /** What changed in its steps, checks, definition of done or description, newest first. */
    changes: {
        id: string;
        field: string;
        before: string | string[] | null;
        after: string | string[] | null;
        agent: string | null;
        created_at: string;
    }[];
};

/** Every routine (all projects) as the cockpit shows it. */
export async function getRoutines(now = new Date()): Promise<RoutineView[]> {
    const { data, error } = await db().from('recurring').select(RECURRING_SELECT).order('created_at');
    if (error) throw new Error(error.message);
    const rows = data as RecurringRow[];
    const ids = rows.map((r) => r.id);
    const [runs, log] = await Promise.all([recentRuns(ids), playbookLog(ids)]);

    return rows.map((r) => {
        const mine = runs.get(r.id) ?? [];
        const { next, missed: _m, ...status } = statusOf(r, mine, now);

        return {
            id: r.id,
            project: r.project ?? { slug: '', name: '' },
            title: r.title,
            summary: r.summary ?? '',
            description: r.description ?? '',
            steps: r.steps,
            checks: r.checks,
            definitionOfDone: r.definition_of_done ?? '',
            domain: (r.domain ?? '').trim().toLowerCase(),
            schedule: describe(r),
            frequency: frequencyOf(r),
            sortKey: r.every === 'intraday' ? String(r.every_minutes ?? 0).padStart(5, '0') : (r.times[0] ?? '99:99'),
            owner: r.owner?.name ?? '',
            reviewer: r.reviewer?.name ?? '',
            active: r.active,
            status: { ...status, next: next?.toISOString() ?? null },
            runs: mine.slice(0, 20).map((x) => ({
                id: x.id,
                status: x.status,
                ran_at: x.ran_at,
                due_at: x.due_at,
                note: x.note,
                checks: x.check_results,
                agent: x.agent?.name ?? null,
                task_id: x.task_id
            })),
            requests: (log.requests.get(r.id) ?? []).map((x) => ({
                id: x.id,
                body: x.body,
                status: x.status,
                reply: x.reply,
                by: x.resolver?.name ?? null,
                created_at: x.created_at,
                resolved_at: x.resolved_at
            })),
            changes: (log.changes.get(r.id) ?? []).map((x) => ({
                id: x.id,
                field: x.field,
                before: x.before,
                after: x.after,
                agent: x.agent?.name ?? null,
                created_at: x.created_at
            }))
        };
    });
}
