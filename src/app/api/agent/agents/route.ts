import { authLead, guarded } from '@/lib/agent-api';
import { db } from '@/lib/supabase';

/** Every active agent, so a lead can pick an owner or reviewer by name. */
export async function GET(req: Request) {
    return guarded(async () => {
        const lead = await authLead(req);
        if (lead instanceof Response) return lead;
        const { data, error } = await db().from('agents').select('id, name, is_lead').eq('active', true).order('name');
        if (error) throw new Error(error.message);

        return Response.json({ agents: data.map((a) => ({ id: a.id, name: a.name, lead: a.is_lead })) });
    });
}
