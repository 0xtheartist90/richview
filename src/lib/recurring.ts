// Recurring work: templates that turn into ordinary tasks on their days. The daily cron (and Richie's "Run now")
// calls runRecurring; agents manage templates through /api/agent/recurring. Server only.
import { db } from '@/lib/supabase';
import { notifyNewTask } from '@/lib/webhooks';

import 'server-only';
import { z } from 'zod';

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Day = (typeof DAYS)[number];

/** Where a recurring task may start. */
export const START_STATUSES = ['new', 'planned', 'in_progress'] as const;

/** How often, as the API takes and gives it. */
export const Schedule = z.discriminatedUnion(
    'every',
    [
        z.strictObject({ every: z.literal('day') }),
        z.strictObject({
            every: z.literal('week'),
            days: z
                .array(z.enum(DAYS, `one of ${DAYS.join(', ')}`))
                .min(1, 'at least one day')
                .max(7)
        }),
        z.strictObject({
            every: z.literal('month'),
            day: z.number().int().min(1, '1–31').max(31, '1–31')
        }),
        z.strictObject({
            every: z.literal('n_days'),
            n: z.number().int().min(2, '2–365').max(365, '2–365'),
            /** The first day it runs (YYYY-MM-DD); today when left out. */
            from: z.iso.date('a date, e.g. 2026-11-03').optional()
        })
    ],
    'every: one of day, week, month, n_days'
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

export type RecurringRow = {
    id: string;
    project_id: string;
    title: string;
    summary: string | null;
    description: string | null;
    context: string | null;
    priority: string;
    domain: string | null;
    impact: string | null;
    effort: string | null;
    start_status: string;
    owner_id: string;
    reviewer_id: string | null;
    created_by: string | null;
    every: 'day' | 'week' | 'month' | 'n_days';
    weekdays: number[];
    month_day: number | null;
    interval_days: number | null;
    anchor_on: string;
    timezone: string;
    allow_overlap: boolean;
    active: boolean;
    last_run_on: string | null;
    last_task_id: string | null;
    last_skipped_on: string | null;
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
    return {
        every: s.every,
        weekdays: s.every === 'week' ? [...new Set(s.days.map((d) => DAYS.indexOf(d)))].sort() : [],
        month_day: s.every === 'month' ? s.day : null,
        interval_days: s.every === 'n_days' ? s.n : null,
        anchor_on: s.every === 'n_days' ? (s.from ?? today) : today
    };
}

export function scheduleOf(r: RecurringRow): Schedule {
    if (r.every === 'week') return { every: 'week', days: r.weekdays.map((d) => DAYS[d]) };
    if (r.every === 'month') return { every: 'month', day: r.month_day ?? 1 };
    if (r.every === 'n_days') return { every: 'n_days', n: r.interval_days ?? 2, from: r.anchor_on };

    return { every: 'day' };
}

/** "every day", "every Sat", "monthly on the 1st", "every 3 days": for the page. */
export function describe(r: RecurringRow) {
    const s = scheduleOf(r);
    if (s.every === 'day') return 'Every day';
    if (s.every === 'week')
        return s.days.length === 7
            ? 'Every day'
            : `Every ${s.days.map((d) => d[0].toUpperCase() + d.slice(1)).join(', ')}`;
    if (s.every === 'month') return `Monthly on day ${s.day}`;

    return `Every ${s.n} days`;
}

export function apiRecurring(r: RecurringRow) {
    return {
        id: r.id,
        project: r.project?.slug ?? null,
        title: r.title,
        summary: r.summary,
        description: r.description,
        context: r.context,
        priority: r.priority,
        domain: r.domain,
        impact: r.impact,
        effort: r.effort,
        start_status: r.start_status,
        owner: r.owner?.name ?? null,
        reviewer: r.reviewer?.name ?? null,
        created_by: r.creator?.name ?? null,
        schedule: scheduleOf(r),
        timezone: r.timezone,
        allow_overlap: r.allow_overlap,
        active: r.active,
        last_run_on: r.last_run_on,
        last_task_id: r.last_task_id,
        last_skipped_on: r.last_skipped_on,
        created_at: r.created_at,
        updated_at: r.updated_at
    };
}

// ---- Calendar ---------------------------------------------------------------------------------------------------

/** The date (YYYY-MM-DD) it is at `now` in a timezone. */
export function dateIn(tz: string, now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
        now
    );
}

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** Whether a template's schedule falls on this date. */
export function dueOn(
    r: Pick<RecurringRow, 'every' | 'weekdays' | 'month_day' | 'interval_days' | 'anchor_on'>,
    date: string
) {
    const d = utc(date);
    if (r.every === 'day') return true;
    if (r.every === 'week') return r.weekdays.includes(d.getUTCDay());
    if (r.every === 'month') {
        const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

        return d.getUTCDate() === Math.min(r.month_day ?? 1, last);
    }
    const days = Math.round((d.getTime() - utc(r.anchor_on).getTime()) / 86_400_000);

    return days >= 0 && days % (r.interval_days ?? 1) === 0;
}

/** "Mon 3 Nov": the date in a generated task's title. */
const label = (date: string) =>
    utc(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// ---- Generating -------------------------------------------------------------------------------------------------

export type RunResult = { created: { template: string; task: string }[]; skipped: string[]; failed: string[] };

/**
 * Turns every active template that's due today (in its own timezone) and hasn't run today into a task. While the
 * previous task from a template is still open, nothing new is made (unless the template allows overlap); that day is
 * marked as skipped. Safe to call more than once a day.
 */
export async function runRecurring(now = new Date()): Promise<RunResult> {
    const { data, error } = await db().from('recurring').select('*').eq('active', true);
    if (error) throw new Error(error.message);
    const result: RunResult = { created: [], skipped: [], failed: [] };

    for (const r of data as RecurringRow[]) {
        const today = dateIn(r.timezone, now);
        if (r.last_run_on === today || !dueOn(r, today)) continue;
        try {
            if (!r.allow_overlap && r.last_task_id) {
                const prev = await db().from('tasks').select('status').eq('id', r.last_task_id).maybeSingle();
                if (prev.data && !['approved', 'rejected'].includes(prev.data.status as string)) {
                    // Claimed for today only if nobody else ran it in the meantime.
                    await db()
                        .from('recurring')
                        .update({ last_run_on: today, last_skipped_on: today })
                        .eq('id', r.id)
                        .or(`last_run_on.is.null,last_run_on.lt.${today}`);
                    result.skipped.push(r.title);
                    continue;
                }
            }
            // Claim today first, so two runs at once can't both make a task.
            const claim = await db()
                .from('recurring')
                .update({ last_run_on: today })
                .eq('id', r.id)
                .or(`last_run_on.is.null,last_run_on.lt.${today}`)
                .select('id')
                .maybeSingle();
            if (claim.error) throw new Error(claim.error.message);
            if (!claim.data) continue;

            const { data: task, error: e } = await db()
                .from('tasks')
                .insert({
                    project_id: r.project_id,
                    title: `${r.title} · ${label(today)}`.slice(0, 200),
                    summary: r.summary,
                    description: r.description,
                    context: r.context,
                    priority: r.priority,
                    domain: r.domain,
                    impact: r.impact,
                    effort: r.effort,
                    status: r.start_status,
                    owner_id: r.owner_id,
                    reviewer_id: r.reviewer_id,
                    created_by: r.created_by,
                    recurring_id: r.id,
                    images: []
                })
                .select('id, title')
                .single();
            if (e) throw new Error(e.message);
            await db().from('recurring').update({ last_task_id: task.id }).eq('id', r.id);
            result.created.push({ template: r.title, task: task.id as string });
            await notifyNewTask({ taskId: task.id as string, title: task.title as string, ownerId: r.owner_id });
        } catch (err) {
            console.error(`Recurring "${r.title}":`, (err as Error).message);
            result.failed.push(r.title);
        }
    }

    return result;
}
