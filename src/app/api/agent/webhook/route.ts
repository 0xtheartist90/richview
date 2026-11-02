import { authAgent, guarded, parseBody } from '@/lib/agent-api';
import { db } from '@/lib/supabase';

import { z } from 'zod';

const Webhook = z.strictObject({
    /** Where Richie's decisions are POSTed; null stops them (poll GET /api/agent/decisions instead). */
    webhook_url: z
        .url({ protocol: /^https$/, error: 'an https:// URL' })
        .max(2000)
        .nullable(),
    /** Signs each POST (X-RichView-Signature: sha256=<HMAC of the body>); null sends them unsigned. */
    webhook_secret: z.string().min(16, 'at least 16 characters').max(200).nullable().optional()
});

/** The caller's webhook for Richie's decisions: on its own tasks, and for a lead on all its projects' tasks. */
export async function PUT(req: Request) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const body = await parseBody(req, Webhook);
        if (body instanceof Response) return body;
        const { error } = await db()
            .from('agents')
            .update({
                webhook_url: body.webhook_url,
                ...(body.webhook_secret !== undefined ? { webhook_secret: body.webhook_secret } : {})
            })
            .eq('id', me.id);
        if (error) throw new Error(error.message);
        const { data } = await db().from('agents').select('webhook_url, webhook_secret').eq('id', me.id).single();

        return Response.json({ webhook_url: data?.webhook_url ?? null, signed: !!data?.webhook_secret });
    });
}
