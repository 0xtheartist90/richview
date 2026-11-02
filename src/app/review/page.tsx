import { ReviewDeck } from '@/components/review/deck';
import { UnlockForm } from '@/components/unlock-form';
import { adminKey, adminOpen } from '@/lib/admin';
import type { Task } from '@/lib/task-types';
import { getQueue } from '@/lib/tasks';

import { TriangleAlert } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Richie's review of the agents' finished work (tasks in Review; returned ones first, then by priority, oldest first),
 * as cards to swipe; `?q=planned` is the Planned queue, `?project=<slug>` narrows it to one project.
 */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ q?: string; project?: string }> }) {
    const { q, project } = await searchParams;
    const planned = q === 'planned';
    if (!adminKey() || !(await adminOpen()))
        return (
            <div className='mx-auto max-w-sm pt-10'>
                <UnlockForm missing={!adminKey()} />
            </div>
        );

    let tasks: Task[];
    try {
        tasks = await getQueue(planned ? 'planned' : 'review', project);
    } catch (err) {
        return (
            <p className='mx-auto mt-10 flex max-w-md items-start gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200'>
                <TriangleAlert className='mt-0.5 size-4 shrink-0' />
                Couldn&apos;t read the tasks: {(err as Error).message}
            </p>
        );
    }

    return (
        <ReviewDeck
            key={`${planned ? 'planned' : 'review'}-${project ?? 'all'}`}
            initial={tasks}
            renderedAt={Date.now()}
            mode={planned ? 'planned' : 'review'}
            project={project}
        />
    );
}
