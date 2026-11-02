import { LoadError } from '@/components/load-error';
import { ReviewDeck } from '@/components/review/deck';
import { UnlockForm } from '@/components/unlock-form';
import { adminKey, adminOpen } from '@/lib/admin';
import type { Task } from '@/lib/task-types';
import { getQueue } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

/**
 * Richie's review of the agents' finished work across all projects (tasks in Review; returned ones first, then by
 * priority, oldest first), as cards to swipe.
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
        tasks = await getQueue();
    } catch (err) {
        return <LoadError message={(err as Error).message} />;
    }

    return <ReviewDeck initial={tasks} renderedAt={Date.now()} />;
}
