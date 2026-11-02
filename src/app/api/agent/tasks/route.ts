import {
    TASK_SELECT,
    TaskCreate,
    type TaskRow,
    agentsByName,
    apiTask,
    authAgent,
    belongs,
    fail,
    guarded,
    issue,
    parseBody,
    writes
} from '@/lib/agent-api';
import { db } from '@/lib/supabase';
import { TASK_STATUSES } from '@/lib/task-types';

import { z } from 'zod';

const Filters = z.strictObject({
    project: z.string().trim().min(1).optional(),
    status: z.enum(TASK_STATUSES, `one of ${TASK_STATUSES.join(', ')}`).optional(),
    owner: z.string().trim().min(1).optional(),
    updated_after: z.iso.datetime({ offset: true, error: 'an ISO date-time, e.g. 2026-11-03T08:00:00Z' }).optional(),
    limit: z.coerce.number().int().min(1).max(500, 'at most 500').default(100)
});

/**
 * Tasks in any project (every agent reads everything), newest change first. Filters: `project` (slug), `status`,
 * `owner` (agent name), `updated_after` (ISO time), `limit` (1–500, default 100).
 */
export async function GET(req: Request) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const parsed = Filters.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!parsed.success) return fail(400, issue(parsed.error));
        const f = parsed.data;

        let q = db().from('tasks').select(TASK_SELECT).order('updated_at', { ascending: false }).limit(f.limit);
        if (f.project) q = q.eq('project.slug', f.project);
        if (f.status) q = q.eq('status', f.status);
        if (f.updated_after) q = q.gt('updated_at', f.updated_after);
        if (f.owner) {
            const owner = (await agentsByName()).get(f.owner.toLowerCase());
            if (!owner) return fail(400, `owner: no agent named "${f.owner}"`);
            q = q.eq('owner_id', owner.id);
        }
        const { data, error } = await q;
        if (error) throw new Error(error.message);

        return Response.json({ tasks: (data as TaskRow[]).map(apiTask) });
    });
}

/**
 * A new task in a project the caller writes in. The caller is its creator and, unless a lead names another agent of
 * the project as `owner`, its owner. With a `reviewer` the task starts in Peer review, otherwise in Review (or the
 * `status` given).
 */
export async function POST(req: Request) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const body = await parseBody(req, TaskCreate);
        if (body instanceof Response) return body;

        const project = await db().from('projects').select('id, slug').eq('slug', body.project).maybeSingle();
        if (project.error) throw new Error(project.error.message);
        if (!project.data) return fail(400, `project: no project "${body.project}"`);
        const projectId = project.data.id as string;
        if (!writes(me, projectId))
            return fail(403, `${me.name} can't write in ${body.project}; your projects: ${slugs(me)}`);

        const agents = await agentsByName();
        let ownerId = me.id;
        if (body.owner && body.owner.toLowerCase() !== me.name.toLowerCase()) {
            if (!me.lead) return fail(403, 'owner: only a lead can give a task to another agent');
            const owner = agents.get(body.owner.toLowerCase());
            if (!owner) return fail(400, `owner: no agent named "${body.owner}"`);
            if (!belongs(owner, projectId)) return fail(400, `owner: ${owner.name} isn't in ${body.project}`);
            ownerId = owner.id;
        }
        const reviewer = body.reviewer ? agents.get(body.reviewer.toLowerCase()) : undefined;
        if (body.reviewer && !reviewer) return fail(400, `reviewer: no agent named "${body.reviewer}"`);
        if (reviewer && (reviewer.id === ownerId || reviewer.id === me.id))
            return fail(400, 'reviewer: must be someone other than the owner and the creator');

        // With a reviewer, work meant for Richie goes to the peer check first.
        let status = body.status ?? 'review';
        if (reviewer && status === 'review') status = 'peer_review';
        if (status === 'peer_review' && !reviewer) return fail(400, 'status: peer_review needs a reviewer');

        const { project: _slug, owner: _o, reviewer: _r, images, ...rest } = body;
        const { data, error } = await db()
            .from('tasks')
            .insert({
                ...rest,
                status,
                images: images ?? [],
                project_id: projectId,
                owner_id: ownerId,
                reviewer_id: reviewer?.id ?? null,
                created_by: me.id
            })
            .select(TASK_SELECT)
            .single();
        if (error) throw new Error(error.message);

        return Response.json({ task: apiTask(data as TaskRow) }, { status: 201 });
    });
}

const slugs = (me: { projects: { slug: string }[] }) => me.projects.map((p) => p.slug).join(', ') || 'none';
