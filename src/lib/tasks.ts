// Tasks in and out of Supabase. Server only.
import { db } from '@/lib/supabase';
import type { DecisionAction, Task, TaskStatus } from '@/lib/task-types';
import type { Change } from '@/lib/webhooks';

import 'server-only';

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
    updated_at: string;
    peer_checked_at: string | null;
    recurring_id: string | null;
    owner: { name: string } | null;
    reviewer: { name: string } | null;
    project: { slug: string; name: string };
};

const SELECT = '*, owner:agents!owner_id(name), reviewer:agents!reviewer_id(name), project:projects!inner(slug, name)';

const toTask = (r: Row, returned: Set<string>): Task => ({
    id: r.id,
    title: r.title,
    summary: r.summary ?? '',
    description: r.description ?? '',
    status: r.status,
    priority: r.priority,
    domain: r.domain ?? '',
    owner: r.owner?.name ?? '',
    reviewer: r.reviewer?.name ?? '',
    peerCheckedAt: r.peer_checked_at,
    recurring: !!r.recurring_id,
    recurringId: r.recurring_id,
    project: r.project,
    impact: (r.impact ?? '').replace('_', ' '),
    effort: r.effort ?? '',
    previewUrl: r.preview_url ?? '',
    images: r.images ?? [],
    before: r.before ?? '',
    after: r.after ?? '',
    context: r.context ?? '',
    returned: returned.has(r.id),
    createdAt: r.created_at,
    updatedAt: r.updated_at
});

const PRIORITY = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

/** Which of these tasks were sent back with changes requested before (so a card back in Review shows as returned). */
async function returnedOf(ids: string[]): Promise<Set<string>> {
    const returned = new Set<string>();
    if (!ids.length) return returned;
    const { data, error } = await db()
        .from('decisions')
        .select('task_id')
        .eq('action', 'changes_requested')
        .in('task_id', ids);
    if (error) throw new Error(error.message);
    for (const d of data) returned.add(d.task_id as string);

    return returned;
}

/** The review stack, all projects: the ones sent back and returned first, then by priority, then oldest first. */
export async function getQueue(): Promise<Task[]> {
    const { data, error } = await db()
        .from('tasks')
        .select(SELECT)
        .eq('status', 'review')
        .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    const rows = data as Row[];
    const returned = await returnedOf(rows.filter((r) => r.status === 'review').map((r) => r.id));

    return rows
        .map((r) => toTask(r, returned))
        .sort((a, b) => Number(b.returned) - Number(a.returned) || PRIORITY[a.priority] - PRIORITY[b.priority]);
}

export type ProjectSummary = {
    id: string;
    slug: string;
    name: string;
    wipLimit: number;
    /** Tasks not yet done (anything but Approved). */
    open: number;
    /** Waiting for Richie. */
    review: number;
    blocked: number;
    working: number;
};

/** The projects, with how much is open and waiting in each; oldest project first. */
export async function getProjects(): Promise<ProjectSummary[]> {
    const [projects, tasks] = await Promise.all([
        db().from('projects').select('id, slug, name, wip_limit').is('archived_at', null).order('created_at'),
        db().from('tasks').select('project_id, status, recurring_id').not('status', 'in', '(approved,rejected)')
    ]);
    if (projects.error) throw new Error(projects.error.message);
    if (tasks.error) throw new Error(tasks.error.message);

    return projects.data.map((p) => {
        const all = tasks.data.filter((t) => t.project_id === p.id);
        // The board's numbers leave routine runs out (they're on the Routines cockpit); Review counts everything.
        const mine = all.filter((t) => !t.recurring_id);

        return {
            id: p.id as string,
            slug: p.slug as string,
            name: p.name as string,
            wipLimit: p.wip_limit as number,
            open: mine.length,
            review: all.filter((t) => t.status === 'review').length,
            blocked: mine.filter((t) => t.status === 'blocked').length,
            working: mine.filter((t) => t.status === 'in_progress').length
        };
    });
}

/** Done work stays on the board this long after it was last touched. */
const DONE_DAYS = 14;

/**
 * One project's tasks, newest change first: everything open, and what was approved (done) lately. Routine runs aren't
 * here: they're on the Routines cockpit.
 */
export async function getBoard(project: string): Promise<Task[]> {
    const since = new Date(Date.now() - DONE_DAYS * 86_400_000).toISOString();
    const { data, error } = await db()
        .from('tasks')
        .select(SELECT)
        .eq('project.slug', project)
        .is('recurring_id', null)
        .neq('status', 'rejected')
        .or(`status.neq.approved,updated_at.gte.${since}`)
        .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = data as Row[];
    const returned = await returnedOf(rows.filter((r) => r.status === 'review').map((r) => r.id));

    return rows.map((r) => toTask(r, returned));
}

/** Which status a verdict may come from, and where it takes the task. */
const MOVES: Record<DecisionAction, { from: TaskStatus[]; to: TaskStatus }> = {
    approved: { from: ['review'], to: 'approved' },
    changes_requested: { from: ['review'], to: 'changes_requested' },
    rejected: { from: ['review', 'planned'], to: 'rejected' },
    started: { from: ['planned', 'new'], to: 'in_progress' }
};

export type Decision = {
    seq: number;
    taskId: string;
    title: string;
    project: string;
    projectId: string;
    /** The task's owner (whose work it is). */
    agentId: string | null;
    action: DecisionAction;
    comment: string | null;
};

/**
 * Richie's verdict: moves the task (only from a status it may come from, so a double swipe does nothing twice), keeps
 * his comment, and adds it to the decision feed the owner and the project's lead read. Null when the task isn't where the verdict expects.
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
        .select('id, title, owner_id, project_id, project:projects(slug)')
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
        projectId: data.project_id as string,
        agentId: (data.owner_id as string | null) ?? null,
        action,
        comment: comment ?? null
    };
}

/** What Richie can change on a card from the board. */
export type RichieEdit = {
    status?: TaskStatus;
    title?: string;
    summary?: string | null;
    priority?: Task['priority'];
    ownerId?: string;
    comment?: string;
};

/** Statuses that are Richie's verdicts: set from the board too, they land in the decision feed like a swipe. */
const VERDICTS: Partial<Record<TaskStatus, DecisionAction>> = {
    approved: 'approved',
    changes_requested: 'changes_requested',
    rejected: 'rejected'
};

/**
 * Richie's change to a card from the board: move it (any status; Done, Changes requested and Archive are verdicts
 * and go to the decision feed), rename it, give it to another agent, change its priority, and say why in a comment.
 * Null when there's no such task.
 */
export async function editTask(
    id: string,
    e: RichieEdit
): Promise<{ decision: Decision | null; change: Change | null } | null> {
    const { data: before, error } = await db()
        .from('tasks')
        .select('id, title, summary, status, priority, owner_id, project_id, project:projects(slug)')
        .eq('id', id)
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!before) return null;
    const project = (before.project as unknown as { slug: string } | null)?.slug ?? '';

    const update: Record<string, unknown> = {};
    const changes: Record<string, [unknown, unknown]> = {};
    const set = (field: string, column: string, value: unknown) => {
        if (value === undefined || value === before[column as keyof typeof before]) return;
        update[column] = value;
        changes[field] = [before[column as keyof typeof before], value];
    };
    set('title', 'title', e.title);
    set('summary', 'summary', e.summary);
    set('priority', 'priority', e.priority);
    set('owner', 'owner_id', e.ownerId);
    set('status', 'status', e.status);
    const verdict = e.status && e.status !== before.status ? VERDICTS[e.status] : undefined;
    if (verdict === 'approved') update.reviewed_at = new Date().toISOString();

    if (Object.keys(update).length) {
        const u = await db().from('tasks').update(update).eq('id', id);
        if (u.error) throw new Error(u.error.message);
    }
    if (e.comment) {
        const c = await db().from('comments').insert({ task_id: id, body: e.comment });
        if (c.error) throw new Error(c.error.message);
    }

    const ownerId = (update.owner_id as string | undefined) ?? (before.owner_id as string | null);
    const title = (update.title as string | undefined) ?? (before.title as string);
    let decision: Decision | null = null;
    if (verdict) {
        const d = await db()
            .from('decisions')
            .insert({ task_id: id, agent_id: ownerId, action: verdict, comment: e.comment ?? null })
            .select('seq')
            .single();
        if (d.error) throw new Error(d.error.message);
        decision = {
            seq: d.data.seq as number,
            taskId: id,
            title,
            project,
            projectId: before.project_id as string,
            agentId: ownerId,
            action: verdict,
            comment: e.comment ?? null
        };
    }
    // Anything besides a verdict (or a verdict with other edits) is a plain change the agents hear about.
    const other = Object.keys(changes).filter((k) => !(verdict && k === 'status'));
    const change: Change | null =
        other.length || (!verdict && e.comment)
            ? {
                  event: 'task_updated',
                  taskId: id,
                  project,
                  projectId: before.project_id as string,
                  title,
                  ownerId,
                  previousOwnerId: changes.owner ? (before.owner_id as string | null) : null,
                  changes: Object.fromEntries(other.map((k) => [k, changes[k]])),
                  comment: verdict ? null : (e.comment ?? null)
              }
            : null;

    return { decision, change };
}

/** Deletes a card for good (its comments and decisions go with it); null when there's none. */
export async function deleteTask(id: string): Promise<Change | null> {
    const { data, error } = await db()
        .from('tasks')
        .delete()
        .eq('id', id)
        .select('id, title, owner_id, project_id, project:projects(slug)')
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;

    return {
        event: 'task_deleted',
        taskId: id,
        project: (data.project as unknown as { slug: string } | null)?.slug ?? '',
        projectId: data.project_id as string,
        title: data.title as string,
        ownerId: (data.owner_id as string | null) ?? null
    };
}
