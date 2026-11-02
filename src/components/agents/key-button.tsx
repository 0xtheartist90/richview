'use client';

// Creates or rotates a lead's API key, then shows it once to copy (it's never shown again).
import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { Check, Copy, KeyRound } from 'lucide-react';
import { toast } from 'sonner';

export function KeyButton({ agentId, name, hasKey }: { agentId: string; name: string; hasKey: boolean }) {
    const router = useRouter();
    const [key, setKey] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);

    const issue = async () => {
        if (hasKey && !window.confirm(`Rotate ${name}'s key? The current key stops working right away.`)) return;
        setBusy(true);
        const res = await fetch(`/api/admin/agents/${agentId}/key`, { method: 'POST' }).catch(() => null);
        setBusy(false);
        const body = ((await res?.json().catch(() => null)) ?? {}) as { key?: string; error?: string };
        if (!res?.ok || !body.key) return void toast.error(body.error ?? 'Could not create the key');
        setKey(body.key);
        router.refresh();
    };

    const copy = async () => {
        if (!key) return;
        await navigator.clipboard.writeText(key);
        setCopied(true);
    };

    if (key)
        return (
            <div className='flex w-full flex-col gap-2 sm:w-80'>
                <p className='text-xs text-amber-200'>Copy it now: it won&apos;t be shown again.</p>
                <div className='track flex items-center gap-2 rounded-xl p-1.5 pl-3'>
                    <code className='min-w-0 flex-1 truncate text-xs'>{key}</code>
                    <button
                        onClick={copy}
                        aria-label='Copy the key'
                        className='btn-key inline-flex size-8 shrink-0 items-center justify-center rounded-lg'>
                        {copied ? <Check className='size-4 text-emerald-300' /> : <Copy className='size-4' />}
                    </button>
                </div>
                <button onClick={() => setKey(null)} className='self-end text-xs text-white/45 hover:text-white'>
                    Done
                </button>
            </div>
        );

    return (
        <button
            onClick={issue}
            disabled={busy}
            className={`${hasKey ? 'btn-key' : 'btn-primary'} inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm disabled:opacity-50`}>
            <KeyRound className='size-4' />
            {busy ? 'Creating…' : hasKey ? 'Rotate key' : 'Create key'}
        </button>
    );
}
