import { LoadError } from '@/components/load-error';
import { ReviewDeck } from '@/components/review/deck';
import { UnlockForm } from '@/components/unlock-form';
import { adminKey, adminOpen } from '@/lib/admin';
import { checkRoutines } from '@/lib/recurring';
import type { Task } from '@/lib/task-types';
import { getQueue } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

/**
 * Richie's review of the agents' finished work across all projects (tasks in Review; returned ones first, then by
 * priority, oldest first), as cards to swipe. A routine that failed or ran late is here too, as its own card.
 */
export default async function ReviewPage() {
    if (!adminKey() || !(await adminOpen()))
        return (
            <div className='mx-auto max-w-sm pt-10'>
                <UnlockForm missing={!adminKey()} />
            </div>
        );

    let tasks: Task[];
    try {
        // Routines that failed or didn't run in time come to Review as cards; check before reading the queue.
        await checkRoutines().catch((err) => console.error('Late check:', (err as Error).message));
        tasks = await getQueue();
    } catch (err) {
        return <LoadError message={(err as Error).message} />;
    }

    return <ReviewDeck initial={tasks} renderedAt={Date.now()} />;
}
