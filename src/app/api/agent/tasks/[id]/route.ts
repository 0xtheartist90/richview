import {
    TASK_SELECT,
    TaskPatch,
    type TaskRow,
    agentsByName,
    apiTask,
    authLead,
    fail,
    guarded,
    isUuid,
    parseBody,
    taskRow,
    writes
} from '@/lib/agent-api';
import { db } from '@/lib/supabase';

type Params = { params: Promise<{ id: string }> };

/** One task (any project), with its comments oldest first; a comment without an agent is Richie's. */
export async function GET(req: Request, { params }: Params) {
    return guarded(async () => {
        const lead = await authLead(req);
        if (lead instanceof Response) return lead;
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
 * Changes a task in one of the lead's projects: any field POST takes, including `owner`, `reviewer` and `status`
 * (never approved or rejected; those are Richie's). A task Richie already decided on can't be changed.
 */
export async function PATCH(req: Request, { params }: Params) {
    return guarded(async () => {
        const lead = await authLead(req);
        if (lead instanceof Response) return lead;
        const { id } = await params;
        if (!isUuid(id)) return fail(400, 'id: not a task id');
        const body = await parseBody(req, TaskPatch);
        if (body instanceof Response) return body;
        const row = await taskRow(id);
        if (!row) return fail(404, 'No such task');
        if (!writes(lead, row.project_id)) return fail(403, `${lead.name} can't write in ${row.project.slug}`);
        if (row.status === 'approved' || row.status === 'rejected')
            return fail(409, `Richie already ${row.status} this task; create a new one for follow-up work`);

        const { owner: ownerName, reviewer: reviewerName, ...rest } = body;
        const change: Record<string, unknown> = { ...rest };
        const agents = await agentsByName();
        let ownerId = row.owner_id;
        let reviewerId = row.reviewer_id;
        if (ownerName !== undefined) {
            const owner = agents.get(ownerName.toLowerCase());
            if (!owner) return fail(400, `owner: no agent named "${ownerName}"`);
            ownerId = change.owner_id = owner.id;
        }
        if (reviewerName !== undefined) {
            const reviewer = reviewerName === null ? null : agents.get(reviewerName.toLowerCase());
            if (reviewerName !== null && !reviewer) return fail(400, `reviewer: no agent named "${reviewerName}"`);
            reviewerId = change.reviewer_id = reviewer?.id ?? null;
            // A new reviewer checks afresh.
            if (reviewerId !== row.reviewer_id) change.peer_checked_at = null;
        }
        if (reviewerId && reviewerId === ownerId) return fail(400, 'reviewer: must be someone other than the owner');

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

        return Response.json({ task: apiTask(data as TaskRow) });
    });
}
