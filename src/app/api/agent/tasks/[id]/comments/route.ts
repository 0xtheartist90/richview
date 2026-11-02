import { agentsByName, authLead, fail, guarded, isUuid, parseBody, taskRow, writes } from '@/lib/agent-api';
import { db } from '@/lib/supabase';

import { z } from 'zod';

const Comment = z.strictObject({
    body: z.string().trim().min(1, 'is required').max(5000, 'at most 5000 characters'),
    /** The agent who wrote it (a specialist); the lead itself when left out. */
    as: z.string().trim().min(1, 'an agent name').max(100).optional()
});

/** A comment on a task in one of the lead's projects, shown under the name of the agent who wrote it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    return guarded(async () => {
        const lead = await authLead(req);
        if (lead instanceof Response) return lead;
        const { id } = await params;
        if (!isUuid(id)) return fail(400, 'id: not a task id');
        const body = await parseBody(req, Comment);
        if (body instanceof Response) return body;
        const row = await taskRow(id);
        if (!row) return fail(404, 'No such task');
        if (!writes(lead, row.project_id)) return fail(403, `${lead.name} can't write in ${row.project.slug}`);

        const author = body.as ? (await agentsByName()).get(body.as.toLowerCase()) : { id: lead.id, name: lead.name };
        if (!author) return fail(400, `as: no agent named "${body.as}"`);
        const { data, error } = await db()
            .from('comments')
            .insert({ task_id: id, agent_id: author.id, body: body.body })
            .select('id, body, created_at')
            .single();
        if (error) throw new Error(error.message);

        return Response.json({ comment: { ...data, author: author.name } }, { status: 201 });
    });
}
