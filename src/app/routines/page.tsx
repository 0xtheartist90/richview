import { LoadError } from '@/components/load-error';
import { RoutinesDashboard } from '@/components/routines/cockpit';
import { UnlockForm } from '@/components/unlock-form';
import { adminKey, adminOpen } from '@/lib/admin';
import { checkRoutines, getRoutines } from '@/lib/recurring';
import { getProjects } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

/** Every routine and check, as a dashboard; `?project=<slug>` starts with that project's. */
export default async function RoutinesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
    if (!adminKey() || !(await adminOpen()))
        return (
            <div className='mx-auto max-w-sm pt-10'>
                <UnlockForm missing={!adminKey()} />
            </div>
        );

    const { project } = await searchParams;
    try {
        // What didn't run in time goes to Review; check before showing the day.
        await checkRoutines().catch((err) => console.error('Late check:', (err as Error).message));
        const [routines, projects] = await Promise.all([getRoutines(), getProjects()]);

        return (
            <RoutinesDashboard
                routines={routines}
                projects={projects.map(({ slug, name }) => ({ slug, name }))}
                initialProject={projects.some((p) => p.slug === project) ? project! : null}
            />
        );
    } catch (err) {
        return <LoadError message={(err as Error).message} />;
    }
}
