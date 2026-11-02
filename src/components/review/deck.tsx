'use client';

// /review: the agents' finished work as a stack of cards. Swipe right (or ✓, or →) approves, swipe left (or ✕, or ←)
// asks for changes with a comment; a tap opens the card full screen. Nothing is saved for 5 seconds, so Undo really
// takes it back.
import { useCallback, useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { Hero, OwnerBadge, TaskChips, domainHex } from '@/components/review/parts';
import { PreviewSheet } from '@/components/review/preview-sheet';
import type { DecisionAction, Task } from '@/lib/task-types';
import { cn } from '@/lib/utils';

import { Check, CheckCheck, Mic, RotateCcw, X } from 'lucide-react';
import {
    AnimatePresence,
    type MotionValue,
    animate,
    motion,
    useMotionValue,
    useMotionValueEvent,
    useTransform
} from 'motion/react';
import { toast } from 'sonner';

/** How far (px) a card must go, or how fast (px/s), to count as a swipe. */
const SWIPE = 110;
const FLICK = 650;
/** How long a verdict waits before it's saved, so Undo can still take it back. */
const HOLD = 5000;
/** One undo toast at a time: only the last verdict can be undone. */
const UNDO_TOAST = 'review-undo';
/** Set once the swipe hint was seen. */
const HINT_KEY = 'review-swipe-hint';
const QUICK = ['too long', 'wrong data', 'different design', 'not needed'];

const buzz = (ms: number | number[]) => {
    try {
        navigator.vibrate?.(ms);
    } catch {
        // Not on iPhone (no vibrate in Safari); the stamp is the feedback there.
    }
};

type Verdict = { action: DecisionAction; comment?: string };
type Pending = { task: Task; verdict: Verdict; timer: ReturnType<typeof setTimeout> };

const url = (id: string) => `/api/tasks/${id}/verdict`;

/** While the page is open, it reads the queue again this often (new cards show by themselves). */
const POLL_MS = 30_000;
/** A page older than this when it mounts (the browser's copy, from going back) is read again right away. */
const STALE_MS = 5_000;
/**
 * Cards swiped in this tab, and when: kept out of a fresh read for a while, as the read may come from before the
 * save. Outside the component, so going to another page and back doesn't bring them back.
 */
const decided = new Map<string, number>();
const DECIDED_MS = 2 * 60_000;
const isDecided = (id: string) => {
    const at = decided.get(id);
    if (at && Date.now() - at < DECIDED_MS) return true;
    decided.delete(id);

    return false;
};

const TOAST_TEXT: Record<DecisionAction, string> = {
    approved: 'Approved',
    changes_requested: 'Changes requested',
    rejected: 'Rejected',
    started: 'Started · In progress'
};

export function ReviewDeck({ initial, renderedAt }: { initial: Task[]; renderedAt: number }) {
    const router = useRouter();
    const [items, setItems] = useState(() => initial.filter((t) => !isDecided(t.id)));
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState<Task | null>(null);
    const [asking, setAsking] = useState<Task | null>(null);
    const [last, setLast] = useState<Task | null>(null);
    const pending = useRef(new Map<string, Pending>());
    // Which way is which, shown until the first swipe (remembered in this browser).
    const [hint, setHint] = useState(false);
    useEffect(() => {
        try {
            setHint(!localStorage.getItem(HINT_KEY));
        } catch {
            // No storage (private mode): the buttons' captions say it too.
        }
    }, []);
    const hintSeen = () => {
        setHint(false);
        try {
            localStorage.setItem(HINT_KEY, '1');
        } catch {
            // As above.
        }
    };
    const x = useMotionValue(0);
    // Only one agent's cards, when picked.
    const [owner, setOwner] = useState<string | null>(null);
    const owners = [...new Set(items.map((t) => t.owner).filter(Boolean))].sort();
    const stack = owner && owners.includes(owner) ? items.filter((t) => t.owner === owner) : items;
    const top = stack[0] ?? null;

    /** Saves a held verdict now (the project's lead then hears it); back in the stack when it didn't save. */
    const save = useCallback(
        async (id: string) => {
            const p = pending.current.get(id);
            if (!p) return;
            pending.current.delete(id);
            clearTimeout(p.timer);
            setLast((l) => (l?.id === id ? null : l));
            const res = await fetch(url(id), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(p.verdict)
            }).catch(() => null);
            // Already decided (elsewhere): it's gone either way.
            if (res?.ok || res?.status === 409) return router.refresh();
            const { error } = ((await res?.json().catch(() => null)) ?? {}) as { error?: string };
            toast.error(`Not saved: ${error ?? 'no connection'}`, { description: p.task.title });
            decided.delete(id);
            setItems((list) => [p.task, ...list.filter((t) => t.id !== id)]);
        },
        [router]
    );

    // A fresh read from the server (the polling below, a save) replaces the stack: new cards come in, cards decided
    // elsewhere go. Not while a card is open, being answered or flying off; then right after.
    const settled = !open && !asking && !busy;
    useEffect(() => {
        if (!settled) return;
        setItems((list) => {
            const next = initial.filter((t) => !pending.current.has(t.id) && !isDecided(t.id));
            // The card Richie is looking at stays on top.
            const at = list[0] ? next.findIndex((t) => t.id === list[0].id) : -1;
            if (at > 0) next.unshift(...next.splice(at, 1));

            return next;
        });
    }, [initial, settled]);

    // The page as first rendered: a later read's time must not count (a phone's clock off by a few seconds would
    // then refresh after every refresh).
    const firstRender = useRef(renderedAt);
    useEffect(() => {
        const refresh = () => document.visibilityState === 'visible' && router.refresh();
        if (Date.now() - firstRender.current > STALE_MS) refresh();
        const timer = setInterval(refresh, POLL_MS);
        const onShow = (e: PageTransitionEvent) => e.persisted && refresh();
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('pageshow', onShow);

        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', refresh);
            window.removeEventListener('pageshow', onShow);
        };
    }, [router]);

    // Leaving the page (or the app going to the background) saves what's still held, so no swipe is lost.
    useEffect(() => {
        const flush = () => {
            for (const [id, p] of pending.current) {
                clearTimeout(p.timer);
                void fetch(url(id), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(p.verdict),
                    keepalive: true
                });
            }
            pending.current.clear();
        };
        const onHide = () => document.visibilityState === 'hidden' && flush();
        document.addEventListener('visibilitychange', onHide);
        window.addEventListener('pagehide', flush);

        return () => {
            document.removeEventListener('visibilitychange', onHide);
            window.removeEventListener('pagehide', flush);
            flush();
        };
    }, []);

    const fly = (dir: 1 | -1) => animate(x, dir * (window.innerWidth + 240), { duration: 0.32, ease: [0.4, 0, 1, 1] });
    const back = () => animate(x, 0, { type: 'spring', stiffness: 520, damping: 32 });

    /** Takes the last verdict back before it was saved: nothing reached the database or the agent. */
    const undo = useCallback(
        (task: Task) => {
            const p = pending.current.get(task.id);
            if (!p) return;
            clearTimeout(p.timer);
            pending.current.delete(task.id);
            decided.delete(task.id);
            setLast(null);
            toast.dismiss(UNDO_TOAST);
            x.jump(0);
            setItems((list) => [task, ...list.filter((t) => t.id !== task.id)]);
        },
        [x]
    );

    /** The card is off screen: hold the verdict for 5 seconds, then save it. */
    const decide = (task: Task, verdict: Verdict) => {
        decided.set(task.id, Date.now());
        hintSeen();
        setItems((list) => list.filter((t) => t.id !== task.id));
        x.jump(0);
        // A newer swipe saves the one before right away: only the last can be undone.
        for (const id of pending.current.keys()) void save(id);
        pending.current.set(task.id, { task, verdict, timer: setTimeout(() => void save(task.id), HOLD) });
        setLast(task);
        toast(TOAST_TEXT[verdict.action], {
            id: UNDO_TOAST,
            description: task.title,
            duration: HOLD,
            action: { label: 'Undo', onClick: () => undo(task) }
        });
    };

    const approve = async () => {
        if (!top || busy) return;
        setBusy(true);
        setOpen(null);
        buzz(30);
        await fly(1);
        decide(top, { action: 'approved' });
        setBusy(false);
    };

    const askChanges = () => {
        if (!top || busy) return;
        hintSeen();
        setOpen(null);
        buzz([15, 40, 15]);
        // The card stays tilted left, its stamp showing, while the comment is written.
        animate(x, -150, { type: 'spring', stiffness: 420, damping: 30 });
        setAsking(top);
    };

    const cancelAsk = () => {
        setAsking(null);
        back();
    };

    const sendBack = async (comment: string) => {
        if (!asking) return;
        const task = asking;
        setAsking(null);
        setBusy(true);
        await fly(-1);
        decide(task, { action: 'changes_requested', comment });
        setBusy(false);
    };

    // ← and → on a keyboard, Enter opens the card.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (open || asking || (e.target as HTMLElement)?.closest('input, textarea')) return;
            if (e.key === 'ArrowRight') void approve();
            else if (e.key === 'ArrowLeft') askChanges();
            else if (e.key === 'Enter' && top) setOpen(top);
        };
        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    });

    return (
        <div className='mx-auto flex h-[calc(100dvh-3.5rem-1rem-5.5rem-env(safe-area-inset-bottom))] min-h-[28rem] w-full max-w-md flex-col lg:h-[calc(100dvh-4rem-3rem)]'>
            <header className='mb-3 flex items-center gap-3'>
                <h1 className='label-hud text-white/55'>review</h1>
                <span className='readout ml-auto text-sm text-white/45'>
                    <span className='text-glow text-base'>{stack.length}</span> waiting
                </span>
            </header>
            {owners.length > 1 && (
                <div className='no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4'>
                    {[null, ...owners].map((o) => (
                        <button
                            key={o ?? 'all'}
                            onClick={() => setOwner(o)}
                            aria-pressed={(owner ?? null) === o}
                            className={cn(
                                'inline-flex h-8 shrink-0 items-center rounded-full px-3 text-sm',
                                (owner ?? null) === o ? 'btn-key' : 'border border-white/[0.08] text-white/60'
                            )}>
                            {o ?? 'Everyone'}
                        </button>
                    ))}
                </div>
            )}
            <div className='relative flex-1'>
                {top ? (
                    // The next two wait underneath, growing into place as the top one moves away.
                    stack
                        .slice(0, 3)
                        .map((task, i) =>
                            i === 0 ? (
                                <TopCard
                                    key={task.id}
                                    task={task}
                                    x={x}
                                    disabled={busy || !!asking}
                                    onTap={() => setOpen(task)}
                                    onRight={approve}
                                    onLeft={askChanges}
                                    onBack={back}
                                />
                            ) : (
                                <UnderCard key={task.id} task={task} depth={i} x={x} />
                            )
                        )
                        .reverse()
                ) : (
                    <AllCaughtUp />
                )}
                {hint && top && (
                    <span className='pointer-events-none absolute inset-x-0 -bottom-1 z-10 mx-auto flex w-fit items-center gap-3 rounded-full border border-white/15 bg-black/70 px-4 py-2 text-sm font-medium text-white backdrop-blur-md'>
                        <span className='text-rose-300'>← Changes</span>
                        <span className='text-white/30'>·</span>
                        <span className='text-emerald-300'>Approve →</span>
                    </span>
                )}
            </div>

            <div className='flex items-start justify-center gap-5 pt-4'>
                <RoundButton
                    label='Ask for changes'
                    caption='Changes'
                    onClick={askChanges}
                    disabled={!top || busy || !!asking}
                    className='size-16 border-rose-500/40 bg-rose-500/10 text-rose-400'>
                    <X className='size-7' strokeWidth={2.5} />
                </RoundButton>
                <RoundButton
                    label='Undo the last one'
                    caption='Undo'
                    onClick={() => last && undo(last)}
                    disabled={!last}
                    className='btn-key size-11'>
                    <RotateCcw className='size-4' />
                </RoundButton>
                <RoundButton
                    label='Approve'
                    caption='Approve'
                    onClick={() => void approve()}
                    disabled={!top || busy || !!asking}
                    className='size-16 border-emerald-500/40 bg-emerald-500/10 text-emerald-400'>
                    <Check className='size-7' strokeWidth={2.5} />
                </RoundButton>
            </div>

            <PreviewSheet task={open} onClose={() => setOpen(null)} onApprove={approve} onChanges={askChanges} />
            <ChangesSheet task={asking} onCancel={cancelAsk} onSave={(c) => void sendBack(c)} />
        </div>
    );
}

function TopCard({
    task,
    x,
    disabled,
    onTap,
    onRight,
    onLeft,
    onBack
}: {
    task: Task;
    x: MotionValue<number>;
    disabled: boolean;
    onTap: () => void;
    onRight: () => void;
    onLeft: () => void;
    onBack: () => void;
}) {
    const rotate = useTransform(x, [-320, 0, 320], [-14, 0, 14]);
    const approveIn = useTransform(x, [25, SWIPE], [0, 1]);
    const changesIn = useTransform(x, [-SWIPE, -25], [1, 0]);
    // A tick in the hand when the card passes the point where letting go counts.
    const past = useRef(0);
    useMotionValueEvent(x, 'change', (v) => {
        const side = v > SWIPE ? 1 : v < -SWIPE ? -1 : 0;
        if (side && side !== past.current) buzz(12);
        past.current = side;
    });

    return (
        <motion.div
            drag={disabled ? false : 'x'}
            dragElastic={0.9}
            dragMomentum={false}
            style={{ x, rotate, touchAction: 'pan-y' }}
            initial={{ scale: 0.95, y: 14 }}
            animate={{ scale: 1, y: 0 }}
            onDragEnd={(_, info) => {
                if (info.offset.x > SWIPE || info.velocity.x > FLICK) onRight();
                else if (info.offset.x < -SWIPE || info.velocity.x < -FLICK) onLeft();
                else onBack();
            }}
            onTap={() => Math.abs(x.get()) < 6 && onTap()}
            whileTap={{ cursor: 'grabbing' }}
            className='absolute inset-0 cursor-grab'>
            <Card task={task}>
                <Stamp opacity={approveIn} className='top-8 left-6 -rotate-12 border-emerald-400 text-emerald-400'>
                    Approved
                </Stamp>
                <Stamp opacity={changesIn} className='top-8 right-6 rotate-12 border-rose-400 text-rose-400'>
                    Changes
                </Stamp>
            </Card>
        </motion.div>
    );
}

function UnderCard({ task, depth, x }: { task: Task; depth: number; x: MotionValue<number> }) {
    // Moves one step up as the top card leaves.
    const scale = useTransform(x, [-220, 0, 220], [1 - (depth - 1) * 0.05, 1 - depth * 0.05, 1 - (depth - 1) * 0.05]);
    const y = useTransform(x, [-220, 0, 220], [(depth - 1) * 14, depth * 14, (depth - 1) * 14]);

    return (
        <motion.div aria-hidden style={{ scale, y }} className='pointer-events-none absolute inset-0'>
            <Card task={task} dim={depth} />
        </motion.div>
    );
}

function Card({ task, dim = 0, children }: { task: Task; dim?: number; children?: React.ReactNode }) {
    const hex = domainHex(task.domain);

    return (
        <article
            className={cn(
                'relative size-full overflow-hidden rounded-[1.75rem] border border-white/10 bg-[var(--hero)] select-none',
                // A card waiting underneath shows only its edges, none of its content.
                dim > 0 && '*:invisible'
            )}
            style={{ boxShadow: `0 24px 60px -20px ${hex}55, 0 10px 30px rgb(0 0 0 / 0.5)` }}>
            <Hero task={task} className='absolute inset-0' />
            {/* Readable text on any image. */}
            <div className='absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0.35)_0%,transparent_22%,transparent_45%,rgb(0_0_0/0.92)_100%)]' />
            <div className='absolute inset-x-0 top-0 h-1' style={{ background: hex }} />
            <div className='absolute top-4 left-4'>
                <OwnerBadge owner={task.owner} />
            </div>
            <div className='absolute inset-x-0 bottom-0 p-5'>
                <h2 className='text-[1.65rem] leading-tight font-semibold text-white'>{task.title}</h2>
                {task.summary && <p className='mt-1.5 line-clamp-2 text-[15px] text-white/75'>{task.summary}</p>}
                <TaskChips task={task} className='mt-3.5' />
                <p className='mt-3 text-xs text-white/40'>
                    Tap to open{task.images.length > 1 ? ` · ${task.images.length} images` : ''}
                </p>
            </div>
            {dim > 0 && <div className='absolute inset-0' style={{ background: `rgb(0 0 0 / ${0.25 * dim})` }} />}
            {children}
        </article>
    );
}

function Stamp({
    opacity,
    className,
    children
}: {
    opacity: MotionValue<number>;
    className: string;
    children: React.ReactNode;
}) {
    const scale = useTransform(opacity, [0, 1], [1.4, 1]);

    return (
        <motion.span
            style={{ opacity, scale }}
            className={cn(
                'pointer-events-none absolute rounded-xl border-[5px] bg-black/25 px-3.5 py-1 text-3xl font-black tracking-widest uppercase backdrop-blur-sm',
                className
            )}>
            {children}
        </motion.span>
    );
}

function RoundButton({
    label,
    onClick,
    disabled,
    className,
    caption,
    children
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    className: string;
    /** A word under the button, so it's clear what it does. */
    caption: string;
    children: React.ReactNode;
}) {
    return (
        <span className={cn('flex flex-col items-center gap-1.5', disabled && 'opacity-60')}>
            <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={onClick}
                disabled={disabled}
                aria-label={label}
                title={label}
                className={cn(
                    'inline-flex items-center justify-center rounded-full border shadow-[0_8px_24px_rgb(0_0_0/0.4)] transition-opacity disabled:opacity-35',
                    className
                )}>
                {children}
            </motion.button>
            <span className='text-xs font-medium text-white/55'>{caption}</span>
        </span>
    );
}

function AllCaughtUp() {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', damping: 18 }}
            className='flex size-full flex-col items-center justify-center gap-5 rounded-[1.75rem] border border-white/[0.07] bg-[radial-gradient(80%_60%_at_50%_35%,rgb(var(--brand-rgb)/0.16),transparent_70%)] p-8 text-center'>
            <div className='relative'>
                <motion.span
                    className='absolute inset-0 rounded-full bg-[var(--brand)]/30'
                    animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
                />
                <span className='relative flex size-24 items-center justify-center rounded-full border border-[var(--brand)]/40 bg-[var(--brand)]/15'>
                    <CheckCheck className='size-11 text-[var(--brand)]' strokeWidth={2} />
                </span>
            </div>
            <div>
                <p className='text-2xl font-light tracking-wide'>All caught up</p>
                <p className='mt-1.5 text-sm text-white/50'>No work waiting for your review.</p>
            </div>
        </motion.div>
    );
}

type Recognition = {
    lang: string;
    interimResults: boolean;
    onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
    onend: () => void;
    start: () => void;
    stop: () => void;
};

/** Speech to text where the browser has it (Safari, Chrome); else the keyboard's own mic. */
function speech(): (new () => Recognition) | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as Record<string, unknown>;

    return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
}

function ChangesSheet({
    task,
    onCancel,
    onSave
}: {
    task: Task | null;
    onCancel: () => void;
    onSave: (comment: string) => void;
}) {
    return (
        <AnimatePresence>
            {task && (
                <>
                    <motion.button
                        key='shade'
                        aria-label='Cancel'
                        onClick={onCancel}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className='fixed inset-0 z-[70] bg-black/50 backdrop-blur-[2px]'
                    />
                    <motion.div
                        key='sheet'
                        role='dialog'
                        aria-modal
                        aria-label='What should change?'
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', damping: 30, stiffness: 340 }}
                        className='dark-panel fixed inset-x-0 bottom-0 z-[80] mx-auto max-w-lg rounded-t-3xl border border-white/10 bg-[var(--sidebar-bg)] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl'>
                        <ChangesForm task={task} onCancel={onCancel} onSave={onSave} />
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

function ChangesForm({
    task,
    onCancel,
    onSave
}: {
    task: Task;
    onCancel: () => void;
    onSave: (comment: string) => void;
}) {
    const [text, setText] = useState('');
    const [listening, setListening] = useState(false);
    const rec = useRef<Recognition | null>(null);
    const [Speech, setSpeech] = useState<(new () => Recognition) | null>(null);
    useEffect(() => {
        setSpeech(() => speech());

        return () => rec.current?.stop();
    }, []);
    const add = (bit: string) => setText((t) => (t.trim() ? `${t.trim()}, ${bit}` : bit));

    const dictate = () => {
        if (!Speech) return;
        if (listening) return rec.current?.stop();
        const r = new Speech();
        r.lang = navigator.language || 'en-US';
        r.interimResults = false;
        r.onresult = (e) => {
            const said = Array.from(e.results)
                .map((res) => res[0]?.transcript ?? '')
                .join(' ')
                .trim();
            if (said) add(said);
        };
        r.onend = () => setListening(false);
        rec.current = r;
        setListening(true);
        r.start();
    };

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) onSave(text.trim());
            }}>
            <div className='mx-auto mb-3 h-1 w-10 rounded-full bg-white/20' />
            <p className='text-lg font-semibold text-white'>What should change?</p>
            <p className='mb-3 truncate text-sm text-white/50'>{task.title}</p>
            <div className='relative'>
                <textarea
                    autoFocus
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={4}
                    maxLength={5000}
                    placeholder='Tell them what to fix…'
                    className='track w-full resize-none rounded-xl p-3 pr-12 text-[16px] text-white outline-none placeholder:text-white/35 focus:ring-2 focus:ring-[var(--ring)]'
                />
                {Speech && (
                    <button
                        type='button'
                        onClick={dictate}
                        aria-label={listening ? 'Stop dictating' : 'Dictate'}
                        className={cn(
                            'absolute top-2.5 right-2.5 inline-flex size-8 items-center justify-center rounded-full border',
                            listening
                                ? 'animate-pulse border-rose-400/60 bg-rose-500/20 text-rose-300'
                                : 'border-white/15 bg-white/5 text-white/70'
                        )}>
                        <Mic className='size-4' />
                    </button>
                )}
            </div>
            <p className='mt-1.5 flex items-center gap-1.5 text-xs text-white/40'>
                <Mic className='size-3' />
                {Speech ? 'Tap the mic to talk' : 'Use the mic on your keyboard to dictate'}
            </p>
            <div className='mt-3 flex flex-wrap gap-2'>
                {QUICK.map((q) => (
                    <button
                        key={q}
                        type='button'
                        onClick={() => add(q)}
                        className='rounded-full border border-white/15 bg-white/[0.05] px-3 py-1.5 text-sm text-white/80 active:scale-95'>
                        {q}
                    </button>
                ))}
            </div>
            <div className='mt-4 flex gap-3'>
                <button
                    type='button'
                    onClick={onCancel}
                    className='btn-key inline-flex h-12 flex-1 items-center justify-center rounded-xl font-medium'>
                    Cancel
                </button>
                <button
                    type='submit'
                    disabled={!text.trim()}
                    className='inline-flex h-12 flex-[2] items-center justify-center gap-2 rounded-xl border border-rose-500/50 bg-rose-500/20 font-semibold text-rose-300 disabled:opacity-40'>
                    Send back
                </button>
            </div>
        </form>
    );
}
