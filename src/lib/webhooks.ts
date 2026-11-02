// Tells a project's lead agent what Richie decided, at the webhook URL the lead registered (PUT /api/agent/webhook).
// The lead passes it on to the task's owner. The body is signed with the lead's webhook secret
// (X-RichView-Signature: sha256=<hex HMAC of the raw body>). Leads without a webhook read the same decisions from
// GET /api/agent/decisions instead. Server only.
import { db } from '@/lib/supabase';
import type { Decision } from '@/lib/tasks';

import { createHmac } from 'node:crypto';
import 'server-only';

type Lead = { name: string; webhook_url: string; webhook_secret: string | null };

/** POSTs the decision to every active lead of the task's project; gives up after 5 seconds each and only logs. */
export async function notifyLead(d: Decision): Promise<void> {
    const { data, error } = await db()
        .from('lead_projects')
        .select('agent:agents!inner(name, webhook_url, webhook_secret, active, is_lead)')
        .eq('project_id', d.projectId)
        .eq('agent.active', true)
        .eq('agent.is_lead', true)
        .not('agent.webhook_url', 'is', null);
    if (error) return console.error(`Webhook leads for decision ${d.seq}:`, error.message);
    const leads = (data as unknown as { agent: Lead }[]).map((r) => r.agent);
    if (!leads.length) return;

    let owner: string | null = null;
    if (d.agentId) {
        const o = await db().from('agents').select('name').eq('id', d.agentId).maybeSingle();
        owner = (o.data?.name as string | undefined) ?? null;
    }
    const body = JSON.stringify({
        event: 'decision',
        seq: d.seq,
        taskId: d.taskId,
        project: d.project,
        title: d.title,
        owner,
        action: d.action,
        comment: d.comment
    });

    const sent = await Promise.all(leads.map((lead) => post(lead, body, d.seq)));
    if (sent.some(Boolean))
        await db().from('decisions').update({ delivered_at: new Date().toISOString() }).eq('seq', d.seq);
}

async function post(lead: Lead, body: string, seq: number): Promise<boolean> {
    const signature = lead.webhook_secret
        ? `sha256=${createHmac('sha256', lead.webhook_secret).update(body).digest('hex')}`
        : null;
    try {
        const res = await fetch(lead.webhook_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(signature ? { 'X-RichView-Signature': signature } : {})
            },
            body,
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) console.error(`Webhook ${lead.name}: ${res.status} for decision ${seq}`);

        return res.ok;
    } catch (err) {
        console.error(`Webhook ${lead.name} failed for decision ${seq}:`, (err as Error).message);

        return false;
    }
}
