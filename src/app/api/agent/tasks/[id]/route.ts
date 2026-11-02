import { after } from 'next/server';

import {
    TASK_SELECT,
    TaskPatch,
    type TaskRow,
    agentsByName,
    apiTask,
    authAgent,
    belongs,
    fail,
    guarded,
    isUuid,
    parseBody,
    taskRow,
    writes
} from '@/lib/agent-api';
import { runRecurring } from '@/lib/recurring';
import { db } from '@/lib/supabase';

type Params = { params: Promise<{ id: string }> };

/** One task (any project), with its comments oldest first; a comment without an agent is Richie's. */
export async function GET(req: Request, { params }: Params) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const { id } = await params;
        if (!isUuid(id)) return fail(400, 'id: not a task id');
        const row = await taskRow(id);
        if (!row) return fail(404, 'No such task');
        const { data, error } = await db()
            .from('comments')
            .select('id, body, created_at, agent:agents(name)')
            .eq('task_id', id)
            .order('created_at');
        if (error) throw new Error(error.message);

        return Response.json({
            task: apiTask(row),
            comments: data.map((c) => ({
                id: c.id,
                author: (c.agent as unknown as { name: string } | null)?.name ?? 'Richie',
                body: c.body,
                created_at: c.created_at
            }))
        });
    });
}

/**
 * Changes a task in a project the caller writes in: any field POST takes, including `reviewer` and `status` (never
 * rejected, and approved only on a routine's run, meaning done; otherwise those are Richie's), and for a lead `owner`. A task Richie already decided on can't be
 * changed.
 */
export async function PATCH(req: Request, { params }: Params) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const { id } = await params;
        if (!isUuid(id)) return fail(400, 'id: not a task id');
        const body = await parseBody(req, TaskPatch);
        if (body instanceof Response) return body;
        const row = await taskRow(id);
        if (!row) return fail(404, 'No such task');
        if (!writes(me, row.project_id)) return fail(403, `${me.name} can't write in ${row.project.slug}`);
        if (row.status === 'approved' || row.status === 'rejected')
            return fail(409, `Richie already ${row.status} this task; create a new one for follow-up work`);

        const { owner: ownerName, reviewer: reviewerName, ...rest } = body;
        const change: Record<string, unknown> = { ...rest };
        const agents = await agentsByName();
        let ownerId = row.owner_id;
        let reviewerId = row.reviewer_id;
        if (ownerName !== undefined && ownerName.toLowerCase() !== row.owner?.name.toLowerCase()) {
            if (!me.lead) return fail(403, 'owner: only a lead can give a task to another agent');
            const owner = agents.get(ownerName.toLowerCase());
            if (!owner) return fail(400, `owner: no agent named "${ownerName}"`);
            if (!belongs(owner, row.project_id)) return fail(400, `owner: ${owner.name} isn't in ${row.project.slug}`);
            ownerId = change.owner_id = owner.id;
        }
        if (reviewerName !== undefined) {
            const reviewer = reviewerName === null ? null : agents.get(reviewerName.toLowerCase());
            if (reviewerName !== null && !reviewer) return fail(400, `reviewer: no agent named "${reviewerName}"`);
            reviewerId = change.reviewer_id = reviewer?.id ?? null;
            // A new reviewer checks afresh.
            if (reviewerId !== row.reviewer_id) change.peer_checked_at = null;
        }
        if (reviewerId && (reviewerId === ownerId || reviewerId === row.created_by))
            return fail(400, 'reviewer: must be someone other than the owner and the creator');

        // Only Richie approves work; a routine's run is the one thing an agent marks done itself.
        if (body.status === 'approved' && !row.recurring_id)
            return fail(400, "status: approved is Richie's, except on a routine's run (then it means done)");
        if (body.status === 'peer_review') {
            if (!reviewerId) return fail(400, 'status: peer_review needs a reviewer');
            change.peer_checked_at = null;
        }
        const checked = change.peer_checked_at === null ? null : row.peer_checked_at;
        if (body.status === 'review' && reviewerId && !checked)
            return fail(400, 'status: this task has a reviewer and goes to peer_review first');
        if (body.images === undefined) delete change.images;

        const { data, error } = await db()
            .from('tasks')
            .update(change)
            .eq('id', id)
            .not('status', 'in', '(approved,rejected)')
            .select(TASK_SELECT)
            .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return fail(409, 'Richie decided on this task in the meantime');
        // A routine's late run done: today's may be made now instead of tomorrow.
        if (body.status === 'approved' && row.recurring_id) after(() => runRecurring().then(() => undefined));

        return Response.json({ task: apiTask(data as TaskRow) });
    });
}
