import { agentsByName, authAgent, belongs, fail, fields, guarded, isUuid, parseBody, writes } from '@/lib/agent-api';
import {
    RECURRING_SELECT,
    type RecurringRow,
    START_STATUSES,
    Schedule,
    apiRecurring,
    dateIn,
    scheduleColumns,
    validTimezone
} from '@/lib/recurring';
import { db } from '@/lib/supabase';

import { z } from 'zod';

type Params = { params: Promise<{ id: string }> };

const Patch = z
    .strictObject({
        title: fields.title.optional(),
        summary: fields.summary.nullable().optional(),
        description: fields.description.nullable().optional(),
        context: fields.context.nullable().optional(),
        priority: fields.priority.optional(),
        domain: fields.domain.nullable().optional(),
        impact: fields.impact.nullable().optional(),
        effort: fields.effort.nullable().optional(),
        start_status: z.enum(START_STATUSES, `one of ${START_STATUSES.join(', ')}`).optional(),
        owner: fields.owner.optional(),
        reviewer: fields.reviewer.nullable().optional(),
        schedule: Schedule.optional(),
        timezone: z.string().refine(validTimezone, 'a timezone, e.g. Asia/Bangkok').optional(),
        allow_overlap: z.boolean().optional(),
        /** false pauses it. */
        active: z.boolean().optional()
    })
    .refine((p) => Object.keys(p).length > 0, 'Nothing to change');

async function row(id: string): Promise<RecurringRow | null> {
    const { data, error } = await db().from('recurring').select(RECURRING_SELECT).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);

    return (data as RecurringRow | null) ?? null;
}

/** One recurring template (any project). */
export async function GET(req: Request, { params }: Params) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const { id } = await params;
        if (!isUuid(id)) return fail(400, 'id: not a recurring id');
        const r = await row(id);
        if (!r) return fail(404, 'No such recurring task');

        return Response.json({ recurring: apiRecurring(r) });
    });
}

/** Changes a template in a project the caller writes in; `active: false` pauses it. Tasks already made stay as they are. */
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

        return Response.json({ recurring: apiRecurring(data as RecurringRow) });
    });
}

/** Removes a template from a project the caller writes in. Tasks already made stay (without the repeat mark's link). */
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
