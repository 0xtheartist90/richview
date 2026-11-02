import { TriangleAlert } from 'lucide-react';

/** The database didn't answer: what it said, in place of the page. */
export function LoadError({ message }: { message: string }) {
    return (
        <p className='mx-auto mt-10 flex max-w-md items-start gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200'>
            <TriangleAlert className='mt-0.5 size-4 shrink-0' />
            Couldn&apos;t read the tasks: {message}
        </p>
    );
}
