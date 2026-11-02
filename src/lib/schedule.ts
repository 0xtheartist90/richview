// When a routine is due, and how it's doing: its due times (times of day, or every N minutes) in its own timezone,
// which of them a reported run covered, today's state, the next due time and the 7-day hit rate. Pure functions,
// no database: the cockpit, the API and the late check all use these.

export type Every = 'day' | 'week' | 'month' | 'n_days' | 'intraday';

export type Rule = {
    every: Every;
    weekdays: number[];
    month_day: number | null;
    interval_days: number | null;
    anchor_on: string;
    /** HH:MM, in `timezone`; empty = some time that day. */
    times: string[];
    every_minutes: number | null;
    grace_minutes: number | null;
    timezone: string;
    active: boolean;
    /** When the routine was made: due times before it don't count. */
    created_at?: string;
};

export type RunLike = { status: 'ok' | 'failed' | 'missed'; ran_at: string; due_at: string | null };

export type RoutineState = 'done' | 'on_track' | 'upcoming' | 'late' | 'failed' | 'not_today' | 'paused';

const MIN = 60_000;
const DAY = 86_400_000;

// ---- Calendar in a timezone ------------------------------------------------------------------------------------

/** The date (YYYY-MM-DD) it is at `now` in a timezone. */
export function dateIn(tz: string, now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
        now
    );
}

/** The clock time (HH:MM) at an instant in a timezone. */
export function timeIn(tz: string, at: Date) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).format(at);
}

/** How far a timezone is ahead of UTC at an instant, in ms. */
function offset(tz: string, at: number) {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })
            .formatToParts(new Date(at))
            .map((p) => [p.type, p.value])
    );
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);

    return asUtc - Math.floor(at / 1000) * 1000;
}

/** The instant of a date and clock time in a timezone. */
export function zoned(date: string, time: string, tz: string): Date {
    const [h, m] = time.split(':').map(Number);
    const guess = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, m);
    let at = guess - offset(tz, guess);
    at = guess - offset(tz, at);

    return new Date(at);
}

const utcDate = (date: string) => new Date(`${date}T00:00:00Z`);
export const addDays = (date: string, n: number) =>
    new Date(utcDate(date).getTime() + n * DAY).toISOString().slice(0, 10);

// ---- Due times ---------------------------------------------------------------------------------------------------

/** Whether a routine's schedule falls on a date. */
export function dueOn(r: Pick<Rule, 'every' | 'weekdays' | 'month_day' | 'interval_days' | 'anchor_on'>, date: string) {
    const d = utcDate(date);
    if (r.every === 'day' || r.every === 'intraday') return true;
    if (r.every === 'week') return r.weekdays.includes(d.getUTCDay());
    if (r.every === 'month') {
        const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

        return d.getUTCDate() === Math.min(r.month_day ?? 1, last);
    }
    const days = Math.round((d.getTime() - utcDate(r.anchor_on).getTime()) / DAY);

    return days >= 0 && days % (r.interval_days ?? 1) === 0;
}

/** Clock times on a due day: every N minutes from midnight, the set times, or (none set) end of day. */
export function clockTimes(r: Pick<Rule, 'every' | 'times' | 'every_minutes'>): string[] {
    if (r.every === 'intraday') {
        const step = Math.max(5, r.every_minutes ?? 60);
        const out: string[] = [];
        for (let m = 0; m < 1440; m += step)
            out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

        return out;
    }

    return r.times.length ? [...r.times].sort() : ['23:59'];
}

/** The instants a routine is due on a date (none when its schedule skips the day). */
export function dueTimes(r: Rule, date: string): Date[] {
    return dueOn(r, date) ? clockTimes(r).map((t) => zoned(date, t, r.timezone)) : [];
}

export const graceOf = (r: Pick<Rule, 'every' | 'every_minutes' | 'grace_minutes'>) =>
    (r.grace_minutes ?? (r.every === 'intraday' ? (r.every_minutes ?? 60) : 60)) * MIN;

/** Due instants in [from, to), oldest first. */
function dueBetween(r: Rule, from: number, to: number): Date[] {
    const out: Date[] = [];
    for (let date = dateIn(r.timezone, new Date(from - DAY)); ; date = addDays(date, 1)) {
        if (zoned(date, '00:00', r.timezone).getTime() >= to) break;
        for (const t of dueTimes(r, date)) if (t.getTime() >= from && t.getTime() < to) out.push(t);
    }

    return out;
}

// ---- Coverage ----------------------------------------------------------------------------------------------------

/** The ok runs' times, oldest first, for coverage checks. */
const okTimes = (runs: RunLike[]) =>
    runs
        .filter((x) => x.status === 'ok')
        .map((x) => new Date(x.ran_at).getTime())
        .sort((a, b) => a - b);

/** Whether a sorted list holds a time in (from, to]. */
function anyIn(sorted: number[], from: number, to: number) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] <= from) lo = mid + 1;
        else hi = mid;
    }

    return lo < sorted.length && sorted[lo] <= to;
}

/**
 * Each due time with whether an ok run covered it: a run counts for a due time when it came after the one before
 * (plus grace) and no later than this one plus grace. The first due time of a day is open from that day's start.
 */
function coverage(r: Rule, due: Date[], ok: number[]) {
    const grace = graceOf(r);

    return due.map((d, i) => {
        const at = d.getTime();
        const prev = i > 0 ? due[i - 1].getTime() : null;
        const sameDay = prev !== null && dateIn(r.timezone, new Date(prev)) === dateIn(r.timezone, d);
        const from = sameDay ? prev! + grace : zoned(dateIn(r.timezone, d), '00:00', r.timezone).getTime() - 1;

        return { at: d, covered: anyIn(ok, Math.min(from, at - 1), at + grace) };
    });
}

export type Status = {
    state: RoutineState;
    /** Today's due times so far (their grace over) and how many a run covered. */
    dueSoFar: number;
    coveredSoFar: number;
    /** Today's due times still to come. */
    remaining: number;
    /** The next due time after now. */
    next: Date | null;
    /** Share of the last 7 days' due times that a run covered (null without any). */
    hit7: number | null;
    /** Per day, oldest first (7 days, today last): covered share, or null without due times. */
    spark: (number | null)[];
    /** Due times in the last 2 days nobody covered (for the late check), oldest first. */
    missed: Date[];
};

/** Where a routine stands at `now`, from its schedule and its runs (any order, the last 8 days are enough). */
export function statusOf(r: Rule, runs: RunLike[], now = new Date()): Status {
    const t = now.getTime();
    const grace = graceOf(r);
    const ok = okTimes(runs);
    const today = dateIn(r.timezone, now);
    const startToday = zoned(today, '00:00', r.timezone).getTime();

    const born = r.created_at ? new Date(r.created_at).getTime() : -Infinity;
    // A due time counts once a run covered it, or once its grace is over; none from before the routine existed.
    const settled = (d: { at: Date; covered: boolean }) =>
        d.at.getTime() > born && d.at.getTime() <= t && (d.covered || d.at.getTime() + grace <= t);
    const todays = coverage(r, dueTimes(r, today), ok).filter((d) => d.at.getTime() > born);
    const passed = todays.filter(settled);
    const remaining = todays.length - passed.length;
    const missedToday = passed.filter((d) => !d.covered).length;

    // The 7 days up to now, per day.
    const spark: (number | null)[] = [];
    let total = 0;
    let hit = 0;
    for (let i = 6; i >= 0; i--) {
        const date = addDays(today, -i);
        const cov = coverage(r, dueTimes(r, date), ok).filter(settled);
        spark.push(cov.length ? cov.filter((d) => d.covered).length / cov.length : null);
        total += cov.length;
        hit += cov.filter((d) => d.covered).length;
    }

    const last2 = coverage(r, dueBetween(r, t - 2 * DAY, t), ok).filter(settled);
    const missed = last2.filter((d) => !d.covered).map((d) => d.at);

    let next: Date | null = null;
    if (r.active)
        for (let i = 0; i <= 400 && !next; i++)
            next = dueTimes(r, addDays(today, i)).find((d) => d.getTime() > t) ?? null;

    const latest = [...runs].sort((a, b) => b.ran_at.localeCompare(a.ran_at)).find((x) => x.status !== 'missed');
    let state: RoutineState;
    if (!r.active) state = 'paused';
    else if (latest?.status === 'failed' && new Date(latest.ran_at).getTime() >= startToday - DAY) state = 'failed';
    else if (missedToday > 0) state = 'late';
    else if (!todays.length) state = 'not_today';
    else if (!remaining) state = 'done';
    else if (passed.length) state = 'on_track';
    else state = 'upcoming';

    return {
        state,
        dueSoFar: passed.length,
        coveredSoFar: passed.length - missedToday,
        remaining,
        next,
        hit7: total ? hit / total : null,
        spark,
        missed
    };
}
