import { authAgent, fail, guarded, issue } from '@/lib/agent-api';
import { REQUEST_SELECT, type RequestRow, apiRequest } from '@/lib/recurring';
import { db } from '@/lib/supabase';

import { z } from 'zod';

type Row = RequestRow & {
    routine: { title: string; project: { slug: string }; owner: { name: string } | null };
};

/**
 * The changes Richie asked for on routines, oldest first: the open ones unless `status` says otherwise. `project`
 * (slug) and `owner` (an agent's name) narrow it.
 */
export async function GET(req: Request) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const parsed = z
            .strictObject({
                status: z.enum(['open', 'done', 'declined'], 'one of open, done, declined').optional(),
                project: z.string().trim().min(1).optional(),
                owner: z.string().trim().min(1).optional()
            })
            .safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!parsed.success) return fail(400, issue(parsed.error));
        const { status = 'open', project, owner } = parsed.data;
        const { data, error } = await db()
            .from('routine_requests')
            .select(
                `${REQUEST_SELECT}, routine:recurring!inner(title, project:projects!inner(slug), owner:agents!owner_id(name))`
            )
            .eq('status', status)
            .order('created_at')
            .limit(200);
        if (error) throw new Error(error.message);

        return Response.json({
            requests: (data as unknown as Row[])
                .filter(
                    (x) =>
                        (!project || x.routine.project.slug === project) &&
                        (!owner || x.routine.owner?.name.toLowerCase() === owner.toLowerCase())
                )
                .map((x) => ({
                    ...apiRequest(x),
                    title: x.routine.title,
                    project: x.routine.project.slug,
                    owner: x.routine.owner?.name ?? null
                }))
        });
    });
}
