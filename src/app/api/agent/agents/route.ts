import { authAgent, guarded } from '@/lib/agent-api';
import { db } from '@/lib/supabase';

/** Every active agent with its project, so an agent can pick a reviewer (or a lead an owner) by name. */
export async function GET(req: Request) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;
        const { data, error } = await db()
            .from('agents')
            .select('id, name, is_lead, project:projects(slug)')
            .eq('active', true)
            .order('name');
        if (error) throw new Error(error.message);

        return Response.json({
            agents: data.map((a) => ({
                id: a.id,
                name: a.name,
                lead: a.is_lead,
                project: (a.project as unknown as { slug: string } | null)?.slug ?? null
            }))
        });
    });
}
