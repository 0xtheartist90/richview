import { Board } from '@/components/board/board';
import { LoadError } from '@/components/load-error';
import { UnlockForm } from '@/components/unlock-form';
import { adminKey, adminOpen } from '@/lib/admin';
import { getBoard, getProjects } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

/** All work per project, grouped by status; `?project=<slug>` picks the project (the first one otherwise). */
export default async function BoardPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
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

        return <Board projects={projects} project={project} tasks={await getBoard(project.slug)} />;
    } catch (err) {
        return <LoadError message={(err as Error).message} />;
    }
}
