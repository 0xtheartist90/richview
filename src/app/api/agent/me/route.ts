import { authLead, guarded } from '@/lib/agent-api';

/** The lead behind the key, and the projects it writes in. */
export async function GET(req: Request) {
    return guarded(async () => {
        const lead = await authLead(req);
        if (lead instanceof Response) return lead;

        return Response.json({
            agent: { id: lead.id, name: lead.name },
            projects: lead.projects.map(({ slug, name }) => ({ slug, name }))
        });
    });
}
