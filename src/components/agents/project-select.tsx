'use client';

// Which project an agent belongs to (it then writes in that project's lead's projects).
import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { toast } from 'sonner';

export function ProjectSelect({
    agentId,
    current,
    projects
}: {
    agentId: string;
    current: string | null;
    projects: { slug: string; name: string }[];
}) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);

    return (
        <select
            aria-label='Project'
            value={current ?? ''}
            disabled={busy}
            onChange={async (e) => {
                setBusy(true);
                const res = await fetch(`/api/admin/agents/${agentId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ project: e.target.value || null })
                }).catch(() => null);
                setBusy(false);
                if (!res?.ok) return void toast.error('Could not move the agent');
                router.refresh();
            }}
            className='track h-10 rounded-xl px-3 text-sm text-white outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-50'>
            <option value=''>No project</option>
            {projects.map((p) => (
                <option key={p.slug} value={p.slug}>
                    {p.name}
                </option>
            ))}
        </select>
    );
}
