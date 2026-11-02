// Tasks in and out of Supabase. Server only.
import 'server-only';

import { db } from '@/lib/supabase';
import type { DecisionAction, Task, TaskStatus } from '@/lib/task-types';

type Row = {
    id: string;
    title: string;
    summary: string | null;
    description: string | null;
    status: TaskStatus;
    priority: Task['priority'];
    domain: string | null;
    impact: string | null;
    effort: string | null;
    preview_url: string | null;
    images: string[] | null;
    before: string | null;
    after: string | null;
    context: string | null;
    created_at: string;
    owner: { name: string } | null;
    project: { slug: string; name: string };
};

const SELECT = '*, owner:agents!owner_id(name), project:projects!inner(slug, name)';

const toTask = (r: Row, returned: Set<string>): Task => ({
    id: r.id,
    title: r.title,
    summary: r.summary ?? '',
    description: r.description ?? '',
    status: r.status,
    priority: r.priority,
    domain: r.domain ?? '',
    owner: r.owner?.name ?? '',
    project: r.project,
    impact: (r.impact ?? '').replace('_', ' '),
    effort: r.effort ?? '',
    previewUrl: r.preview_url ?? '',
    images: r.images ?? [],
    before: r.before ?? '',
    after: r.after ?? '',
    context: r.context ?? '',
    returned: returned.has(r.id),
    createdAt: r.created_at
});

const PRIORITY = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

/**
 * The cards in a status, in the order they're swiped: the ones sent back and returned first, then by priority, then
 * oldest first. `project` narrows it to one project (its slug).
 */
export async function getQueue(status: 'review' | 'planned', project?: string): Promise<Task[]> {
    let q = db().from('tasks').select(SELECT).eq('status', status).order('created_at', { ascending: true });
    if (project) q = q.eq('project.slug', project);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = data as Row[];

    const returned = new Set<string>();
    if (status === 'review' && rows.length) {
        const sent = await db()
            .from('decisions')
            .select('task_id')
            .eq('action', 'changes_requested')
            .in(
                'task_id',
                rows.map((r) => r.id)
            );
        if (sent.error) throw new Error(sent.error.message);
        for (const d of sent.data) returned.add(d.task_id as string);
    }

    return rows
        .map((r) => toTask(r, returned))
        .sort((a, b) => Number(b.returned) - Number(a.returned) || PRIORITY[a.priority] - PRIORITY[b.priority]);
}

/** Which status a verdict may come from, and where it takes the task. */
const MOVES: Record<DecisionAction, { from: TaskStatus[]; to: TaskStatus }> = {
    approved: { from: ['review'], to: 'approved' },
    changes_requested: { from: ['review'], to: 'changes_requested' },
    rejected: { from: ['review', 'planned'], to: 'rejected' },
    started: { from: ['planned'], to: 'in_progress' }
};

export type Decision = {
    seq: number;
    taskId: string;
    title: string;
    project: string;
    agentId: string | null;
    action: DecisionAction;
    comment: string | null;
};

/**
 * Richie's verdict: moves the task (only from a status it may come from, so a double swipe does nothing twice), keeps
 * his comment, and adds it to the decision feed the owner reads. Null when the task isn't where the verdict expects.
 */
export async function decide(id: string, action: DecisionAction, comment?: string): Promise<Decision | null> {
    const move = MOVES[action];
    const now = await db().from('tasks').select('status').eq('id', id).maybeSingle();
    if (now.error) throw new Error(now.error.message);
    const from = now.data?.status as TaskStatus | undefined;
    if (!from || !move.from.includes(from)) return null;
    // A Planned card started or rejected isn't reviewed work: no review date (it stays out of History).
    const { data, error } = await db()
        .from('tasks')
        .update({ status: move.to, ...(from === 'review' ? { reviewed_at: new Date().toISOString() } : {}) })
        .eq('id', id)
        .eq('status', from)
        .select('id, title, owner_id, project:projects(slug)')
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;

    if (comment) {
        const c = await db().from('comments').insert({ task_id: id, body: comment });
        if (c.error) throw new Error(c.error.message);
    }
    const d = await db()
        .from('decisions')
        .insert({ task_id: id, agent_id: data.owner_id, action, comment: comment ?? null })
        .select('seq')
        .single();
    if (d.error) throw new Error(d.error.message);

    return {
        seq: d.data.seq as number,
        taskId: id,
        title: data.title as string,
        project: (data.project as unknown as { slug: string } | null)?.slug ?? '',
        agentId: (data.owner_id as string | null) ?? null,
        action,
        comment: comment ?? null
    };
}
