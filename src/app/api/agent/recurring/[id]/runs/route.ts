import { authAgent, fail, guarded, isUuid, parseBody, writes } from '@/lib/agent-api';
import { RECURRING_SELECT, type RecurringRow, reportRun } from '@/lib/recurring';
import { db } from '@/lib/supabase';

import { z } from 'zod';

const Run = z.strictObject({
    status: z.enum(['ok', 'failed'], 'ok or failed'),
    /** What happened, in a line or more (shown in the run history; on a failure also on the Review card). */
    note: z.string().trim().max(5000, 'at most 5000 characters').optional(),
    /** When it ran (ISO); now when left out. */
    ran_at: z.iso
        .datetime({ offset: true, error: 'an ISO date-time, e.g. 2026-11-03T12:45:00Z' })
        .refine((t) => new Date(t).getTime() <= Date.now() + 5 * 60_000, 'not in the future')
        .optional()
});

/**
 * Reports a run of a routine: `ok`, or `failed` (which also puts a card on Review). Its owner, or any agent that
 * writes in its project, reports it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const { id } = await params;
        if (!isUuid(id)) return fail(400, 'id: not a recurring id');
        const body = await parseBody(req, Run);
        if (body instanceof Response) return body;
        const { data, error } = await db().from('recurring').select(RECURRING_SELECT).eq('id', id).maybeSingle();
        if (error) throw new Error(error.message);
        const r = data as RecurringRow | null;
        if (!r) return fail(404, 'No such recurring task');
        if (r.owner_id !== me.id && !writes(me, r.project_id))
            return fail(403, `${me.name} can't report runs in ${r.project?.slug}`);

        const run = await reportRun(r, { ...body, agentId: me.id });

        return Response.json(
            {
                run: {
                    id: run.id,
                    status: run.status,
                    ran_at: run.ran_at,
                    note: run.note,
                    agent: run.agent?.name ?? me.name,
                    review_task: run.review_task
                }
            },
            { status: 201 }
        );
    });
}
