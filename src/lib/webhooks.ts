// Tells a task's owner what Richie decided, at the webhook URL the agent registered. The body is signed with the
// agent's webhook secret (X-RichView-Signature: sha256=<hex HMAC of the raw body>). Agents without a webhook read the
// same decisions from the API instead. Server only.
import { db } from '@/lib/supabase';
import type { Decision } from '@/lib/tasks';

import { createHmac } from 'node:crypto';
import 'server-only';

/** POSTs the decision; gives up after 5 seconds and only logs a failure (the swipe is already saved). */
export async function notifyOwner(d: Decision): Promise<void> {
    if (!d.agentId) return;
    const { data: agent, error } = await db()
        .from('agents')
        .select('name, webhook_url, webhook_secret, active')
        .eq('id', d.agentId)
        .maybeSingle();
    if (error || !agent?.active || !agent.webhook_url) return;

    const body = JSON.stringify({
        event: 'decision',
        seq: d.seq,
        taskId: d.taskId,
        project: d.project,
        title: d.title,
        action: d.action,
        comment: d.comment
    });
    const signature = agent.webhook_secret
        ? `sha256=${createHmac('sha256', agent.webhook_secret).update(body).digest('hex')}`
        : null;
    try {
        const res = await fetch(agent.webhook_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(signature ? { 'X-RichView-Signature': signature } : {})
            },
            body,
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) return console.error(`Webhook ${agent.name}: ${res.status} for decision ${d.seq}`);
        await db().from('decisions').update({ delivered_at: new Date().toISOString() }).eq('seq', d.seq);
    } catch (err) {
        console.error(`Webhook ${agent.name} failed for decision ${d.seq}:`, (err as Error).message);
    }
}
