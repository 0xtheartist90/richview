import {
    TASK_SELECT,
    type TaskRow,
    apiTask,
    authAgent,
    fail,
    guarded,
    isUuid,
    parseBody,
    taskRow
} from '@/lib/agent-api';
import { db } from '@/lib/supabase';

import { z } from 'zod';

const PeerCheck = z
    .strictObject({
        verdict: z.enum(['ok', 'changes'], 'ok or changes'),
        comment: z.string().trim().max(5000, 'at most 5000 characters').optional()
    })
    .refine((b) => b.verdict === 'ok' || !!b.comment, { path: ['comment'], message: 'say what should change' });

/**
 * The reviewer's check of a task in Peer review. Only the task's reviewer may send it, from any team, and never on a
 * task it owns or created. `ok` sends it on to Richie's review; `changes` sends it back to its owner with the comment.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const { id } = await params;
        if (!isUuid(id)) return fail(400, 'id: not a task id');
        const body = await parseBody(req, PeerCheck);
        if (body instanceof Response) return body;
        const row = await taskRow(id);
        if (!row) return fail(404, 'No such task');
        if (row.status !== 'peer_review') return fail(409, `The task is in ${row.status}, not peer_review`);
        if (row.reviewer_id !== me.id)
            return fail(403, `Only the reviewer (${row.reviewer?.name ?? 'none set'}) can peer-check this task`);
        if (row.owner_id === me.id || row.created_by === me.id)
            return fail(403, "You can't peer-check a task you own or created");

        const ok = body.verdict === 'ok';
        const { data, error } = await db()
            .from('tasks')
            .update(
                ok
                    ? { status: 'review', peer_checked_at: new Date().toISOString() }
                    : { status: 'changes_requested', peer_checked_at: null }
            )
            .eq('id', id)
            .eq('status', 'peer_review')
            .select(TASK_SELECT)
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return fail(409, 'The task left peer_review in the meantime');
        if (body.comment) {
            const c = await db().from('comments').insert({ task_id: id, agent_id: me.id, body: body.comment });
            if (c.error) throw new Error(c.error.message);
        }

        return Response.json({ task: apiTask(data as TaskRow) });
    });
}
