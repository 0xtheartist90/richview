'use client';

// Richie's controls on a card opened from the board: move it, rename it, give it to someone else, change its
// priority, say why; archive it, or delete it for good. The owner and the project's lead hear about every change.
import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { DESK_ORDER, STATUS_META, type Task, type TaskStatus } from '@/lib/task-types';
import { cn } from '@/lib/utils';

import { Archive, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export type Member = { id: string; name: string };

/** Saves a change to a card; true when it went through. */
export async function saveTask(id: string, body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).catch(() => null);
    if (res?.ok) return true;
    const { error } = ((await res?.json().catch(() => null)) ?? {}) as { error?: string };
    toast.error(error ?? 'No connection');

    return false;
}

const field =
    'track h-11 w-full rounded-xl px-3 text-[15px] text-white outline-none focus:ring-2 focus:ring-[var(--ring)]';

export function TaskEditor({ task, team, onDone }: { task: Task; team: Member[]; onDone: () => void }) {
    const router = useRouter();
    const [status, setStatus] = useState<TaskStatus>(task.status);
    const [title, setTitle] = useState(task.title);
    const [priority, setPriority] = useState(task.priority);
    const [owner, setOwner] = useState(team.find((m) => m.name === task.owner)?.id ?? '');
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState(false);

    const changed: Record<string, unknown> = {};
    if (status !== task.status) changed.status = status;
    if (title.trim() && title.trim() !== task.title) changed.title = title.trim();
    if (priority !== task.priority) changed.priority = priority;
    if (owner && owner !== team.find((m) => m.name === task.owner)?.id) changed.owner = owner;
    if (comment.trim()) changed.comment = comment.trim();
    const needsWhy = status === 'changes_requested' && status !== task.status && !comment.trim();

    const done = (message: string) => {
        toast(message, { description: task.title });
        onDone();
        router.refresh();
    };
    const save = async () => {
        if (needsWhy) return void toast.error('Say what should change');
        setBusy(true);
        const ok = await saveTask(task.id, changed);
        setBusy(false);
        if (ok) done('Saved');
    };
    const archive = async () => {
        if (!window.confirm('Archive this card? It leaves the board; the agents hear about it.')) return;
        setBusy(true);
        const ok = await saveTask(task.id, {
            status: 'rejected',
            ...(comment.trim() ? { comment: comment.trim() } : {})
        });
        setBusy(false);
        if (ok) done('Archived');
    };
    const remove = async () => {
        if (!window.confirm('Delete this card for good, with its comments? This can’t be undone.')) return;
        setBusy(true);
        const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' }).catch(() => null);
        setBusy(false);
        if (res?.ok) return done('Deleted');
        toast.error('Could not delete the card');
    };

    return (
        <section className='bg-card panel flex flex-col gap-3 rounded-2xl border p-4 shadow-[var(--shadow-card)]'>
            <p className='label-hud'>manage</p>

            <div>
                <p className='label-xs mb-1.5 text-white/45'>status</p>
                <div className='flex flex-wrap gap-1.5'>
                    {DESK_ORDER.filter((s) => s !== 'peer_review' || task.reviewer).map((s) => (
                        <button
                            key={s}
                            onClick={() => setStatus(s)}
                            aria-pressed={status === s}
                            className={cn(
                                'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm',
                                status === s ? 'text-white' : 'border-white/[0.08] text-white/55'
                            )}
                            style={
                                status === s
                                    ? { borderColor: `${STATUS_META[s].hex}99`, background: `${STATUS_META[s].hex}26` }
                                    : undefined
                            }>
                            <span className='size-1.5 rounded-full' style={{ background: STATUS_META[s].hex }} />
                            {STATUS_META[s].label}
                        </button>
                    ))}
                </div>
            </div>

            <label className='flex flex-col gap-1.5'>
                <span className='label-xs text-white/45'>title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={field} />
            </label>

            <div className='grid grid-cols-2 gap-2'>
                <label className='flex flex-col gap-1.5'>
                    <span className='label-xs text-white/45'>owner</span>
                    <select value={owner} onChange={(e) => setOwner(e.target.value)} className={field}>
                        {!owner && <option value=''>Nobody</option>}
                        {team.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='flex flex-col gap-1.5'>
                    <span className='label-xs text-white/45'>priority</span>
                    <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as Task['priority'])}
                        className={field}>
                        {(['urgent', 'high', 'normal', 'low'] as const).map((p) => (
                            <option key={p} value={p}>
                                {p[0].toUpperCase() + p.slice(1)}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <label className='flex flex-col gap-1.5'>
                <span className='label-xs text-white/45'>
                    comment{status === 'changes_requested' ? ' · what should change?' : ' (optional)'}
                </span>
                <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    maxLength={5000}
                    placeholder='Tell the agent why…'
                    className='track w-full resize-none rounded-xl p-3 text-[16px] text-white outline-none placeholder:text-white/35 focus:ring-2 focus:ring-[var(--ring)]'
                />
            </label>

            <div className='flex flex-wrap gap-2'>
                <button
                    onClick={save}
                    disabled={busy || !Object.keys(changed).length}
                    className='btn-primary inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm disabled:opacity-40'>
                    <Save className='size-4' /> {busy ? 'Saving…' : 'Save'}
                </button>
                <button
                    onClick={archive}
                    disabled={busy}
                    className='btn-key inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm disabled:opacity-40'>
                    <Archive className='size-4' /> Archive
                </button>
                <button
                    onClick={remove}
                    disabled={busy}
                    aria-label='Delete for good'
                    className='btn-key inline-flex size-11 items-center justify-center rounded-xl text-rose-300 disabled:opacity-40'>
                    <Trash2 className='size-4' />
                </button>
            </div>
        </section>
    );
}
