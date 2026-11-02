import { agentsByName, authAgent, belongs, fail, fields, guarded, issue, parseBody, writes } from '@/lib/agent-api';
import {
    RECURRING_SELECT,
    type RecurringRow,
    Schedule,
    apiRecurring,
    recentRuns,
    scheduleColumns,
    validTimezone
} from '@/lib/recurring';
import { dateIn, statusOf } from '@/lib/schedule';
import { db } from '@/lib/supabase';

import { z } from 'zod';

const Create = z.strictObject({
    project: z.string().trim().min(1, 'a project slug'),
    title: fields.title,
    summary: fields.summary.optional(),
    description: fields.description.optional(),
    context: fields.context.optional(),
    priority: fields.priority.optional(),
    domain: fields.domain.optional(),
    owner: fields.owner.optional(),
    reviewer: fields.reviewer.optional(),
    schedule: Schedule,
    grace_minutes: z.number().int().min(0).max(1440, 'at most 1440').optional(),
    timezone: z.string().refine(validTimezone, 'a timezone, e.g. Asia/Bangkok').optional(),
    active: z.boolean().optional()
});

/**
 * Every routine (any project) with where it stands now: state, next due time, 7-day hit rate and last run.
 * `project` (slug) narrows it.
 */
export async function GET(req: Request) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const parsed = z
            .strictObject({ project: z.string().trim().min(1).optional() })
            .safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!parsed.success) return fail(400, issue(parsed.error));
        let q = db().from('recurring').select(RECURRING_SELECT).order('created_at');
        if (parsed.data.project) q = q.eq('project.slug', parsed.data.project);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const rows = data as RecurringRow[];
        const runs = await recentRuns(rows.map((r) => r.id));

        return Response.json({
            recurring: rows.map((r) => {
                const mine = runs.get(r.id) ?? [];

                return apiRecurring(
                    r,
                    statusOf(r, mine),
                    mine.find((x) => x.status !== 'missed')
                );
            })
        });
    });
}

/**
 * A new routine in a project the caller writes in. Owner rules as for tasks: the caller, unless a lead names another
 * agent of the project. Its runs are reported with POST /api/agent/recurring/:id/runs.
 */
export async function POST(req: Request) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const body = await parseBody(req, Create);
        if (body instanceof Response) return body;

        const project = await db().from('projects').select('id').eq('slug', body.project).maybeSingle();
        if (project.error) throw new Error(project.error.message);
        if (!project.data) return fail(400, `project: no project "${body.project}"`);
        const projectId = project.data.id as string;
        if (!writes(me, projectId)) return fail(403, `${me.name} can't write in ${body.project}`);

        const agents = await agentsByName();
        let ownerId = me.id;
        if (body.owner && body.owner.toLowerCase() !== me.name.toLowerCase()) {
            if (!me.lead) return fail(403, 'owner: only a lead can give work to another agent');
            const owner = agents.get(body.owner.toLowerCase());
            if (!owner) return fail(400, `owner: no agent named "${body.owner}"`);
            if (!belongs(owner, projectId)) return fail(400, `owner: ${owner.name} isn't in ${body.project}`);
            ownerId = owner.id;
        }
        const reviewer = body.reviewer ? agents.get(body.reviewer.toLowerCase()) : undefined;
        if (body.reviewer && !reviewer) return fail(400, `reviewer: no agent named "${body.reviewer}"`);
        if (reviewer && (reviewer.id === ownerId || reviewer.id === me.id))
            return fail(400, 'reviewer: must be someone other than the owner and the creator');

        const timezone = body.timezone ?? 'Asia/Bangkok';
        const { project: _p, owner: _o, reviewer: _r, schedule, ...rest } = body;
        const { data, error } = await db()
            .from('recurring')
            .insert({
                ...rest,
                timezone,
                ...scheduleColumns(schedule, dateIn(timezone)),
                project_id: projectId,
                owner_id: ownerId,
                reviewer_id: reviewer?.id ?? null,
                created_by: me.id
            })
            .select(RECURRING_SELECT)
            .single();
        if (error) throw new Error(error.message);

        return Response.json({ recurring: apiRecurring(data as RecurringRow) }, { status: 201 });
    });
}
