import { authAgent, fail, guarded, isUuid, parseBody, taskRow, writes } from '@/lib/agent-api';
import { db } from '@/lib/supabase';

import { z } from 'zod';

const Comment = z.strictObject({
    body: z.string().trim().min(1, 'is required').max(5000, 'at most 5000 characters')
});

/** A comment on a task in a project the caller writes in, under the caller's name. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const { id } = await params;
        if (!isUuid(id)) return fail(400, 'id: not a task id');
        const body = await parseBody(req, Comment);
        if (body instanceof Response) return body;
        const row = await taskRow(id);
        if (!row) return fail(404, 'No such task');
        if (!writes(me, row.project_id)) return fail(403, `${me.name} can't write in ${row.project.slug}`);

        const { data, error } = await db()
            .from('comments')
            .insert({ task_id: id, agent_id: me.id, body: body.body })
            .select('id, body, created_at')
            .single();
        if (error) throw new Error(error.message);

        return Response.json({ comment: { ...data, author: me.name } }, { status: 201 });
    });
}
