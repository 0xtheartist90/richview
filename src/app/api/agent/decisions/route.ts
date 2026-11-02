import { authLead, fail, guarded, issue } from '@/lib/agent-api';
import { db } from '@/lib/supabase';

import { z } from 'zod';

const Query = z.strictObject({
    after: z.coerce.number().int().min(0, 'a decision number (seq), 0 or more').default(0),
    limit: z.coerce.number().int().min(1).max(500, 'at most 500').default(100)
});

type Row = {
    seq: number;
    action: string;
    comment: string | null;
    option_id: string | null;
    created_at: string;
    task: { id: string; title: string; project: { slug: string }; owner: { name: string } | null };
};

/**
 * Richie's decisions on tasks in the lead's projects, oldest first, after decision number `after`. Poll with the
 * last `seq` you saw (the answer's `next`) to get only what's new.
 */
export async function GET(req: Request) {
    return guarded(async () => {
        const lead = await authLead(req);
        if (lead instanceof Response) return lead;
        const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!parsed.success) return fail(400, issue(parsed.error));
        const { after, limit } = parsed.data;
        if (!lead.projects.length) return Response.json({ decisions: [], next: after });

        const { data, error } = await db()
            .from('decisions')
            .select(
                'seq, action, comment, option_id, created_at, task:tasks!inner(id, title, project_id, project:projects(slug), owner:agents!owner_id(name))'
            )
            .gt('seq', after)
            .in(
                'task.project_id',
                lead.projects.map((p) => p.id)
            )
            .order('seq')
            .limit(limit);
        if (error) throw new Error(error.message);
        const rows = data as unknown as Row[];

        return Response.json({
            decisions: rows.map((d) => ({
                seq: d.seq,
                task_id: d.task.id,
                title: d.task.title,
                project: d.task.project.slug,
                owner: d.task.owner?.name ?? null,
                action: d.action,
                comment: d.comment,
                option_id: d.option_id,
                created_at: d.created_at
            })),
            next: rows.at(-1)?.seq ?? after
        });
    });
}
