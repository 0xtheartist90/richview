// What the agent API (/api/agent/*) shares: who's calling (an agent, by its own key), what a task looks like on the
// wire, what a request may hold, and the answers it gets. Every agent reads every project. A lead writes in its own
// projects (lead_projects); any other agent in those of the lead of its project (agents.project_id). Peer checks
// are the exception: the reviewer may sit in another team. Server only.
import { NextResponse } from 'next/server';

import { db } from '@/lib/supabase';
import { TASK_STATUSES } from '@/lib/task-types';

import { createHash } from 'node:crypto';
import 'server-only';
import { z } from 'zod';

export type Project = { id: string; slug: string; name: string };
/** The agent behind the key: the projects it may write in, and whether it leads them. */
export type Caller = { id: string; name: string; lead: boolean; projectId: string | null; projects: Project[] };

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** A JSON error the agent can read: `{ "error": "..." }`. */
export const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/** The projects each lead leads, by lead id (active leads only). */
async function leadProjects(): Promise<{ agent_id: string; project_id: string }[]> {
    const { data, error } = await db()
        .from('lead_projects')
        .select('agent_id, project_id, agent:agents!inner(active, is_lead)')
        .eq('agent.active', true)
        .eq('agent.is_lead', true);
    if (error) throw new Error(error.message);

    return data.map((r) => ({ agent_id: r.agent_id as string, project_id: r.project_id as string }));
}

/**
 * The agent behind `Authorization: Bearer <key>`, with the projects it may write in; a 401 answer when the key is
 * missing, unknown, or the agent isn't active.
 */
export async function authAgent(req: Request): Promise<Caller | NextResponse> {
    const key = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
    if (!key) return fail(401, 'Send Authorization: Bearer <your API key>');
    const { data, error } = await db()
        .from('agents')
        .select('id, name, is_lead, project_id')
        .eq('api_key_hash', hashKey(key))
        .eq('active', true)
        .maybeSingle();
    if (error) return fail(502, error.message);
    if (!data) return fail(401, 'Unknown or revoked API key');

    const links = await leadProjects();
    const lead = data.is_lead as boolean;
    const projectId = (data.project_id as string | null) ?? null;
    // A lead: its own projects. Anyone else: every project of its project's lead(s), and its own project.
    const leads = lead ? [data.id as string] : links.filter((l) => l.project_id === projectId).map((l) => l.agent_id);
    const ids = new Set(links.filter((l) => leads.includes(l.agent_id)).map((l) => l.project_id));
    if (!lead && projectId) ids.add(projectId);

    let projects: Project[] = [];
    if (ids.size) {
        const p = await db()
            .from('projects')
            .select('id, slug, name')
            .in('id', [...ids])
            .is('archived_at', null);
        if (p.error) return fail(502, p.error.message);
        projects = p.data as Project[];
    }

    return { id: data.id as string, name: data.name as string, lead, projectId, projects };
}

export const writes = (caller: Caller, projectId: string) => caller.projects.some((p) => p.id === projectId);

/** An agent as other agents name it: which project it's in, and which it leads. */
export type Member = { id: string; name: string; lead: boolean; projectId: string | null; leads: string[] };

/** Every active agent by name (case-insensitive), so a request can name an owner or a reviewer. */
export async function agentsByName(): Promise<Map<string, Member>> {
    const [{ data, error }, links] = await Promise.all([
        db().from('agents').select('id, name, is_lead, project_id').eq('active', true),
        leadProjects()
    ]);
    if (error) throw new Error(error.message);

    return new Map(
        data.map((a) => [
            (a.name as string).toLowerCase(),
            {
                id: a.id as string,
                name: a.name as string,
                lead: a.is_lead as boolean,
                projectId: (a.project_id as string | null) ?? null,
                leads: links.filter((l) => l.agent_id === a.id).map((l) => l.project_id)
            }
        ])
    );
}

/** Whether an agent belongs to a project: it's in it, or leads it. */
export const belongs = (m: Member, projectId: string) => m.projectId === projectId || m.leads.includes(projectId);

/** The request's JSON body, or a 400 that says what's wrong with it (the first problem, with its field). */
export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T> | NextResponse> {
    const raw = await req.json().catch(() => undefined);
    if (raw === undefined) return fail(400, 'The body must be JSON');
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail(400, issue(parsed.error));

    return parsed.data;
}

export function issue(error: z.ZodError) {
    const first = error.issues[0];
    if (!first) return 'Invalid request';
    const path = first.path.join('.');

    return path ? `${path}: ${first.message}` : first.message;
}

export const isUuid = (id: string) => z.uuid().safeParse(id).success;

// ---- Tasks on the wire -----------------------------------------------------------------------------------------

/** What agents may set a task to. Approved and rejected are Richie's, through his review. */
export const AGENT_STATUSES = TASK_STATUSES.filter(
    (s): s is Exclude<(typeof TASK_STATUSES)[number], 'approved' | 'rejected'> => s !== 'approved' && s !== 'rejected'
);

const text = (max: number) => z.string().trim().max(max, `at most ${max} characters`);
const name = text(100).min(1, 'an agent name');

/** The fields a task is made of, as POST and PATCH take them (PATCH: any of them; null clears). */
export const fields = {
    title: text(200).min(1, 'is required'),
    summary: text(300),
    description: text(20_000),
    status: z.enum(AGENT_STATUSES, `one of ${AGENT_STATUSES.join(', ')}`),
    priority: z.enum(['urgent', 'high', 'normal', 'low'], 'one of urgent, high, normal, low'),
    domain: text(60),
    impact: z.enum(['revenue', 'time_saved', 'quality'], 'one of revenue, time_saved, quality'),
    effort: z.enum(['S', 'M', 'L'], 'one of S, M, L'),
    preview_url: z.url('a full URL').max(2000),
    images: z.array(z.url('a full URL').max(2000)).max(10, 'at most 10'),
    before: text(2000),
    after: text(2000),
    context: text(20_000),
    options: z.array(z.strictObject({ id: text(50).min(1), label: text(200).min(1) })).max(10, 'at most 10'),
    owner: name,
    reviewer: name
};

export const TaskCreate = z.strictObject({
    project: z.string().trim().min(1, 'a project slug'),
    title: fields.title,
    summary: fields.summary.optional(),
    description: fields.description.optional(),
    status: fields.status.optional(),
    priority: fields.priority.optional(),
    domain: fields.domain.optional(),
    impact: fields.impact.optional(),
    effort: fields.effort.optional(),
    preview_url: fields.preview_url.optional(),
    images: fields.images.optional(),
    before: fields.before.optional(),
    after: fields.after.optional(),
    context: fields.context.optional(),
    options: fields.options.optional(),
    /** Whose work it is: the caller when left out; only a lead may name another agent of the project. */
    owner: fields.owner.optional(),
    reviewer: fields.reviewer.optional()
});
export type TaskCreate = z.infer<typeof TaskCreate>;

export const TaskPatch = z
    .strictObject({
        title: fields.title.optional(),
        summary: fields.summary.nullable().optional(),
        description: fields.description.nullable().optional(),
        status: fields.status.optional(),
        priority: fields.priority.optional(),
        domain: fields.domain.nullable().optional(),
        impact: fields.impact.nullable().optional(),
        effort: fields.effort.nullable().optional(),
        preview_url: fields.preview_url.nullable().optional(),
        images: fields.images.optional(),
        before: fields.before.nullable().optional(),
        after: fields.after.nullable().optional(),
        context: fields.context.nullable().optional(),
        options: fields.options.nullable().optional(),
        owner: fields.owner.optional(),
        reviewer: fields.reviewer.nullable().optional()
    })
    .refine((p) => Object.keys(p).length > 0, 'Nothing to change');
export type TaskPatch = z.infer<typeof TaskPatch>;

/** The columns a task is read with: its project, and its owner, reviewer and creator by name. */
export const TASK_SELECT =
    '*, project:projects!inner(slug, name), owner:agents!owner_id(name), reviewer:agents!reviewer_id(name), creator:agents!created_by(name)';

type Named = { name: string } | null;
export type TaskRow = Record<string, unknown> & {
    id: string;
    project_id: string;
    owner_id: string | null;
    reviewer_id: string | null;
    created_by: string | null;
    peer_checked_at: string | null;
    status: string;
    project: { slug: string; name: string };
    owner: Named;
    reviewer: Named;
    creator: Named;
};

/** A task as the API answers it: plain fields, people by name. */
export function apiTask(r: TaskRow) {
    return {
        id: r.id,
        project: r.project.slug,
        title: r.title,
        summary: r.summary,
        description: r.description,
        status: r.status,
        priority: r.priority,
        domain: r.domain,
        impact: r.impact,
        effort: r.effort,
        preview_url: r.preview_url,
        images: r.images,
        before: r.before,
        after: r.after,
        context: r.context,
        options: r.options,
        owner: r.owner?.name ?? null,
        reviewer: r.reviewer?.name ?? null,
        peer_checked_at: r.peer_checked_at,
        recurring_id: (r.recurring_id as string | null) ?? null,
        created_by: r.creator?.name ?? null,
        reviewed_at: r.reviewed_at,
        created_at: r.created_at,
        updated_at: r.updated_at
    };
}

/** One task by id, as a row; null when there's none. */
export async function taskRow(id: string): Promise<TaskRow | null> {
    const { data, error } = await db().from('tasks').select(TASK_SELECT).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);

    return (data as TaskRow | null) ?? null;
}

/** Answers 502 with the database's message when a handler throws. */
export async function guarded(run: () => Promise<Response>): Promise<Response> {
    try {
        return await run();
    } catch (err) {
        return fail(502, (err as Error).message);
    }
}
