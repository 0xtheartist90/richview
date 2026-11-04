import { authAgent, fail, guarded, isUuid, parseBody, writes } from '@/lib/agent-api';
import { REQUEST_SELECT, type RequestRow, apiRequest } from '@/lib/recurring';
import { db } from '@/lib/supabase';

import { z } from 'zod';

const Resolve = z
    .strictObject({
        status: z.enum(['done', 'declined'], 'done or declined'),
        /** What was changed, or why not (Richie reads it on the routine). */
        reply: z.string().trim().max(2000, 'at most 2000 characters').optional()
    })
    .refine((b) => b.status === 'done' || !!b.reply, { path: ['reply'], error: 'say why when you decline' });

/** Closes a change Richie asked for: `done` (after changing the routine), or `declined` with the reason. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; requestId: string }> }) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const { id, requestId } = await params;
        if (!isUuid(id)) return fail(400, 'id: not a recurring id');
        if (!isUuid(requestId)) return fail(400, 'requestId: not a request id');
        const body = await parseBody(req, Resolve);
        if (body instanceof Response) return body;
        const routine = await db().from('recurring').select('project_id, owner_id').eq('id', id).maybeSingle();
        if (routine.error) throw new Error(routine.error.message);
        if (!routine.data) return fail(404, 'No such recurring task');
        if (routine.data.owner_id !== me.id && !writes(me, routine.data.project_id as string))
            return fail(403, `${me.name} can't answer requests on this routine`);

        const { data, error } = await db()
            .from('routine_requests')
            .update({
                status: body.status,
                reply: body.reply ?? null,
                resolved_by: me.id,
                resolved_at: new Date().toISOString()
            })
            .eq('id', requestId)
            .eq('recurring_id', id)
            .eq('status', 'open')
            .select(REQUEST_SELECT)
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return fail(409, 'No open request with this id on this routine');

        return Response.json({ request: apiRequest(data as unknown as RequestRow) });
    });
}
