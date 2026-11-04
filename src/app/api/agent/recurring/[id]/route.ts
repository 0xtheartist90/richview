import { agentsByName, authAgent, belongs, fail, fields, guarded, isUuid, parseBody, writes } from '@/lib/agent-api';
import {
    RECURRING_SELECT,
    type RecurringRow,
    Schedule,
    apiChange,
    apiRecurring,
    apiRequest,
    logChanges,
    playbookLog,
    recentRuns,
    scheduleColumns,
    validTimezone
} from '@/lib/recurring';
import { dateIn, statusOf } from '@/lib/schedule';
import { db } from '@/lib/supabase';

import { z } from 'zod';

type Params = { params: Promise<{ id: string }> };

const Patch = z
    .strictObject({
        title: fields.title.optional(),
        summary: fields.summary.nullable().optional(),
        description: fields.description.nullable().optional(),
        steps: fields.lines.optional(),
        checks: fields.lines.optional(),
        definition_of_done: fields.definition_of_done.nullable().optional(),
        context: fields.context.nullable().optional(),
        priority: fields.priority.optional(),
        domain: fields.domain.nullable().optional(),
        impact: fields.impact.nullable().optional(),
        effort: fields.effort.nullable().optional(),
        owner: fields.owner.optional(),
        reviewer: fields.reviewer.nullable().optional(),
        schedule: Schedule.optional(),
        grace_minutes: z.number().int().min(0).max(1440, 'at most 1440').nullable().optional(),
        timezone: z.string().refine(validTimezone, 'a timezone, e.g. Asia/Bangkok').optional(),
        /** false pauses it. */
        active: z.boolean().optional()
    })
    .refine((p) => Object.keys(p).length > 0, 'Nothing to change');

async function row(id: string): Promise<RecurringRow | null> {
    const { data, error } = await db().from('recurring').select(RECURRING_SELECT).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);

    return (data as RecurringRow | null) ?? null;
}

/** One routine (any project), with where it stands now, its runs of the last 8 days, its change requests and history, newest first. */
export async function GET(req: Request, { params }: Params) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const { id } = await params;
        if (!isUuid(id)) return fail(400, 'id: not a recurring id');
        const r = await row(id);
        if (!r) return fail(404, 'No such recurring task');
        const [recent, log] = await Promise.all([recentRuns([r.id]), playbookLog([r.id])]);
        const runs = recent.get(r.id) ?? [];

        return Response.json({
            recurring: apiRecurring(
                r,
                statusOf(r, runs),
                runs.find((x) => x.status !== 'missed')
            ),
            runs: runs.map((x) => ({
                id: x.id,
                status: x.status,
                due_at: x.due_at,
                ran_at: x.ran_at,
                note: x.note,
                checks: x.check_results,
                agent: x.agent?.name ?? null,
                review_task: x.task_id
            })),
            requests: (log.requests.get(r.id) ?? []).map(apiRequest),
            changes: (log.changes.get(r.id) ?? []).map(apiChange)
        });
    });
}

/** Changes a routine in a project the caller writes in (title, summary, description, schedule with times, …); `active: false` pauses it. */
export async function PATCH(req: Request, { params }: Params) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const { id } = await params;
        if (!isUuid(id)) return fail(400, 'id: not a recurring id');
        const body = await parseBody(req, Patch);
        if (body instanceof Response) return body;
        const r = await row(id);
        if (!r) return fail(404, 'No such recurring task');
        if (!writes(me, r.project_id)) return fail(403, `${me.name} can't write in ${r.project?.slug}`);

        const { owner: ownerName, reviewer: reviewerName, schedule, timezone, ...rest } = body;
        const change: Record<string, unknown> = { ...rest };
        const agents = await agentsByName();
        let ownerId = r.owner_id;
        let reviewerId = r.reviewer_id;
        if (ownerName !== undefined && ownerName.toLowerCase() !== r.owner?.name.toLowerCase()) {
            if (!me.lead) return fail(403, 'owner: only a lead can give work to another agent');
            const owner = agents.get(ownerName.toLowerCase());
            if (!owner) return fail(400, `owner: no agent named "${ownerName}"`);
            if (!belongs(owner, r.project_id)) return fail(400, `owner: ${owner.name} isn't in ${r.project?.slug}`);
            ownerId = change.owner_id = owner.id;
        }
        if (reviewerName !== undefined) {
            const reviewer = reviewerName === null ? null : agents.get(reviewerName.toLowerCase());
            if (reviewerName !== null && !reviewer) return fail(400, `reviewer: no agent named "${reviewerName}"`);
            reviewerId = change.reviewer_id = reviewer?.id ?? null;
        }
        if (reviewerId && (reviewerId === ownerId || reviewerId === r.created_by))
            return fail(400, 'reviewer: must be someone other than the owner and the creator');
        if (timezone) change.timezone = timezone;
        if (schedule) Object.assign(change, scheduleColumns(schedule, dateIn(timezone ?? r.timezone)));

        const { data, error } = await db()
            .from('recurring')
            .update(change)
            .eq('id', id)
            .select(RECURRING_SELECT)
            .single();
        if (error) throw new Error(error.message);
        await logChanges(r, data as RecurringRow, me.id);

        return Response.json({ recurring: apiRecurring(data as RecurringRow) });
    });
}

/** Removes a routine from a project the caller writes in, with its run history. Review cards it raised stay. */
export async function DELETE(req: Request, { params }: Params) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const { id } = await params;
        if (!isUuid(id)) return fail(400, 'id: not a recurring id');
        const r = await row(id);
        if (!r) return fail(404, 'No such recurring task');
        if (!writes(me, r.project_id)) return fail(403, `${me.name} can't write in ${r.project?.slug}`);
        const { error } = await db().from('recurring').delete().eq('id', id);
        if (error) throw new Error(error.message);

        return Response.json({ deleted: id });
    });
}
