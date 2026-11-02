import { LoadError } from '@/components/load-error';
import { Cockpit } from '@/components/routines/cockpit';
import { UnlockForm } from '@/components/unlock-form';
import { adminKey, adminOpen } from '@/lib/admin';
import { agentsByName, belongs } from '@/lib/agent-api';
import { getCockpit } from '@/lib/recurring';
import { getProjects } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

/** The routines and checks of one project, as a cockpit; `?project=<slug>` picks the project (the first otherwise). */
export default async function RoutinesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
    if (!adminKey() || !(await adminOpen()))
        return (
            <div className='mx-auto max-w-sm pt-10'>
                <UnlockForm missing={!adminKey()} />
            </div>
        );

    const { project: slug } = await searchParams;
    try {
        const projects = await getProjects();
        const project = projects.find((p) => p.slug === slug) ?? projects[0];
        if (!project) return <p className='mt-10 text-center text-sm text-white/45'>No projects yet.</p>;
        const [cockpit, agents] = await Promise.all([getCockpit(project.slug), agentsByName()]);
        const team = [...agents.values()]
            .filter((a) => belongs(a, project.id))
            .map(({ id, name }) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return <Cockpit projects={projects} project={project} cockpit={cockpit} team={team} />;
    } catch (err) {
        return <LoadError message={(err as Error).message} />;
    }
}
