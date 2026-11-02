'use client';

// The admin password, asked once per browser.
import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { Lock } from 'lucide-react';

export function UnlockForm({ missing }: { missing: boolean }) {
    const router = useRouter();
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    if (missing)
        return (
            <p className='rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200'>
                Set <code>ADMIN_PASSWORD</code> in <code>.env.local</code> (and in Vercel) to open RichView.
            </p>
        );

    return (
        <form
            className='flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5'
            onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                const res = await fetch('/api/admin/unlock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                }).catch(() => null);
                setBusy(false);
                if (res?.ok) return router.refresh();
                setError(res?.status === 401 ? 'Wrong password' : 'Could not unlock, try again');
            }}>
            <p className='flex items-center gap-2 font-semibold'>
                <Lock className='size-4' /> RichView is locked
            </p>
            <input
                type='password'
                autoFocus
                autoComplete='current-password'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder='Admin password'
                aria-label='Admin password'
                className='h-12 rounded-xl border border-white/10 bg-black/30 px-3 text-[16px] outline-none focus:ring-2 focus:ring-white/30'
            />
            {error && <p className='text-sm text-rose-400'>{error}</p>}
            <button
                disabled={!password || busy}
                className='h-12 rounded-xl bg-white font-semibold text-black disabled:opacity-40'>
                {busy ? 'Checking…' : 'Unlock'}
            </button>
        </form>
    );
}
