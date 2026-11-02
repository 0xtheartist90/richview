import {
    TASK_SELECT,
    type TaskRow,
    apiTask,
    authLead,
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
        /** The reviewer's name: only the agent set as the task's reviewer may check it. */
        as: z.string().trim().min(1, 'the reviewer’s name').max(100),
        verdict: z.enum(['ok', 'changes'], 'ok or changes'),
        comment: z.string().trim().max(5000, 'at most 5000 characters').optional()
    })
    .refine((b) => b.verdict === 'ok' || !!b.comment, { path: ['comment'], message: 'say what should change' });

/**
 * The reviewer's check of a task in Peer review, from any lead (a reviewer may sit in another team). `ok` sends it on
 * to Richie's review; `changes` sends it back to its owner with the comment.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    return guarded(async () => {
        const lead = await authLead(req);
        if (lead instanceof Response) return lead;
        const { id } = await params;
        if (!isUuid(id)) return fail(400, 'id: not a task id');
        const body = await parseBody(req, PeerCheck);
        if (body instanceof Response) return body;
        const row = await taskRow(id);
        if (!row) return fail(404, 'No such task');
        if (row.status !== 'peer_review') return fail(409, `The task is in ${row.status}, not peer_review`);
        if (!row.reviewer || row.reviewer.name.toLowerCase() !== body.as.toLowerCase())
            return fail(403, `Only the reviewer (${row.reviewer?.name ?? 'none set'}) can peer-check this task`);

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
            const c = await db()
                .from('comments')
                .insert({ task_id: id, agent_id: row.reviewer_id, body: body.comment });
            if (c.error) throw new Error(c.error.message);
        }

        return Response.json({ task: apiTask(data as TaskRow) });
    });
}
