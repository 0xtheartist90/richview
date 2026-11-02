import { authAgent, guarded } from '@/lib/agent-api';

/** The agent behind the key, whether it leads, and the projects it may write in. */
export async function GET(req: Request) {
    return guarded(async () => {
        const me = await authAgent(req);
        if (me instanceof Response) return me;

        return Response.json({
            agent: { id: me.id, name: me.name, lead: me.lead },
            projects: me.projects.map(({ slug, name }) => ({ slug, name }))
        });
    });
}
