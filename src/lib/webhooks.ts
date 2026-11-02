// Tells the task's owner what Richie decided or changed, with a copy to the project's lead, and an agent when a
// recurring task was made for it; each at the webhook URL the agent set
// (PUT /api/agent/webhook). Each body is signed with that agent's webhook secret
// (X-RichView-Signature: sha256=<hex HMAC of the raw body>). Agents without a webhook read the same decisions from
// GET /api/agent/decisions instead. Server only.
import { db } from '@/lib/supabase';
import type { Decision } from '@/lib/tasks';

import { createHmac } from 'node:crypto';
import 'server-only';

type Hook = { id: string; name: string; webhook_url: string | null; webhook_secret: string | null; active: boolean };

/** Who hears about a task: its owner and the project's lead(s), once each, those with a webhook only. */
async function recipients(projectId: string, ownerId: string | null, previousOwnerId?: string | null) {
    const leads = await db()
        .from('lead_projects')
        .select('agent:agents!inner(id, name, webhook_url, webhook_secret, active, is_lead)')
        .eq('project_id', projectId)
        .eq('agent.is_lead', true);
    if (leads.error) throw new Error(leads.error.message);
    let owner: Hook | null = null;
    if (ownerId) {
        const o = await db()
            .from('agents')
            .select('id, name, webhook_url, webhook_secret, active')
            .eq('id', ownerId)
            .maybeSingle();
        owner = (o.data as Hook | null) ?? null;
    }
    const to = new Map<string, { hook: Hook; role: 'owner' | 'lead' | 'previous_owner' }>();
    if (owner) to.set(owner.id, { hook: owner, role: 'owner' });
    for (const { agent } of leads.data as unknown as { agent: Hook }[])
        if (!to.has(agent.id)) to.set(agent.id, { hook: agent, role: 'lead' });
    // A card given to someone else: the one who had it hears it's gone.
    if (previousOwnerId && !to.has(previousOwnerId)) {
        const p = await db()
            .from('agents')
            .select('id, name, webhook_url, webhook_secret, active')
            .eq('id', previousOwnerId)
            .maybeSingle();
        if (p.data) to.set(previousOwnerId, { hook: p.data as Hook, role: 'previous_owner' });
    }

    return { owner, targets: [...to.values()].filter(({ hook }) => hook.active && hook.webhook_url) };
}

/** POSTs the decision to the owner and the project's lead(s), once each; 5 seconds each, failures only logged. */
export async function notifyDecision(d: Decision): Promise<void> {
    let found: Awaited<ReturnType<typeof recipients>>;
    try {
        found = await recipients(d.projectId, d.agentId);
    } catch (err) {
        return console.error(`Webhook recipients for decision ${d.seq}:`, (err as Error).message);
    }
    const { owner, targets } = found;
    if (!targets.length) return;
    const sent = await Promise.all(
        targets.map(({ hook, role }) =>
            post(
                hook,
                JSON.stringify({
                    event: 'decision',
                    role,
                    seq: d.seq,
                    taskId: d.taskId,
                    project: d.project,
                    title: d.title,
                    owner: owner?.name ?? null,
                    action: d.action,
                    comment: d.comment
                }),
                d.seq
            )
        )
    );
    if (sent.some(Boolean))
        await db().from('decisions').update({ delivered_at: new Date().toISOString() }).eq('seq', d.seq);
}

export type Change = {
    event: 'task_updated' | 'task_deleted';
    taskId: string;
    project: string;
    projectId: string;
    title: string;
    ownerId: string | null;
    /** Set when the card went to another owner. */
    previousOwnerId?: string | null;
    /** What Richie changed, as { field: [before, after] }. */
    changes?: Record<string, [unknown, unknown]>;
    comment?: string | null;
};

/** Tells the owner and the project's lead(s) that Richie changed or deleted a task in the app. */
export async function notifyChange(c: Change): Promise<void> {
    try {
        const { owner, targets } = await recipients(c.projectId, c.ownerId, c.previousOwnerId);
        await Promise.all(
            targets.map(({ hook, role }) =>
                post(
                    hook,
                    JSON.stringify({
                        event: c.event,
                        role,
                        by: 'Richie',
                        taskId: c.taskId,
                        project: c.project,
                        title: c.title,
                        owner: owner?.name ?? null,
                        changes: c.changes ?? null,
                        comment: c.comment ?? null
                    }),
                    `${c.event} ${c.taskId}`
                )
            )
        );
    } catch (err) {
        console.error(`Webhook ${c.event} ${c.taskId}:`, (err as Error).message);
    }
}

async function post(hook: Hook, body: string, what: number | string): Promise<boolean> {
    const signature = hook.webhook_secret
        ? `sha256=${createHmac('sha256', hook.webhook_secret).update(body).digest('hex')}`
        : null;
    try {
        const res = await fetch(hook.webhook_url!, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(signature ? { 'X-RichView-Signature': signature } : {})
            },
            body,
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok)
            console.error(
                `Webhook ${hook.name}: ${res.status} for ${typeof what === 'number' ? `decision ${what}` : what}`
            );

        return res.ok;
    } catch (err) {
        console.error(
            `Webhook ${hook.name} failed for ${typeof what === 'number' ? `decision ${what}` : what}:`,
            (err as Error).message
        );

        return false;
    }
}

/** Tells an agent a task was made for it (a recurring task, so it can start without polling). */
export async function notifyNewTask(t: { taskId: string; title: string; ownerId: string }): Promise<void> {
    const { data } = await db()
        .from('agents')
        .select('id, name, webhook_url, webhook_secret, active')
        .eq('id', t.ownerId)
        .maybeSingle();
    const hook = data as Hook | null;
    if (!hook?.active || !hook.webhook_url) return;
    await post(
        hook,
        JSON.stringify({ event: 'task_created', taskId: t.taskId, title: t.title, owner: hook.name }),
        `new task ${t.taskId}`
    );
}
