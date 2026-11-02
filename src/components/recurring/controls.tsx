'use client';

// The buttons on /recurring: run what's due now, pause or resume a routine, remove one.
import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { Pause, Play, PlayCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
    }).catch(() => null);
    const json = ((await res?.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (!res?.ok) toast.error((json.error as string) ?? 'No connection');

    return res?.ok ? json : null;
}

export function RunNow() {
    const router = useRouter();
    const [busy, setBusy] = useState(false);

    return (
        <button
            disabled={busy}
            onClick={async () => {
                setBusy(true);
                const r = (await call('/api/admin/recurring/run', 'POST')) as {
                    created: unknown[];
                    skipped: string[];
                    failed: string[];
                } | null;
                setBusy(false);
                if (!r) return;
                toast(`${r.created.length} made · ${r.skipped.length} skipped (previous still open)`, {
                    description: r.failed.length ? `Failed: ${r.failed.join(', ')}` : undefined
                });
                router.refresh();
            }}
            className='btn-primary inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm disabled:opacity-50'>
            <PlayCircle className='size-4' /> {busy ? 'Running…' : 'Run now'}
        </button>
    );
}

export function RoutineButtons({ id, title, active }: { id: string; title: string; active: boolean }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const run = async (method: string, body?: unknown) => {
        setBusy(true);
        const ok = await call(`/api/admin/recurring/${id}`, method, body);
        setBusy(false);
        if (ok) router.refresh();
    };

    return (
        <div className='flex shrink-0 gap-2'>
            <button
                disabled={busy}
                onClick={() => run('PATCH', { active: !active })}
                aria-label={active ? `Pause ${title}` : `Resume ${title}`}
                className='btn-key inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm disabled:opacity-50'>
                {active ? <Pause className='size-3.5' /> : <Play className='size-3.5' />}
                {active ? 'Pause' : 'Resume'}
            </button>
            <button
                disabled={busy}
                onClick={() => window.confirm(`Remove "${title}"? Tasks it already made stay.`) && run('DELETE')}
                aria-label={`Remove ${title}`}
                className='btn-key inline-flex size-9 items-center justify-center rounded-lg text-rose-300 disabled:opacity-50'>
                <Trash2 className='size-4' />
            </button>
        </div>
    );
}
