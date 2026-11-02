'use client';

// A card opened full screen: the images to swipe through, Before / After, the description and the preview link (here
// in a frame, or in a new tab when the site won't be framed).
import { useEffect, useState } from 'react';

import { OwnerBadge, TaskChips } from '@/components/review/parts';
import type { Task } from '@/lib/task-types';
import { cn } from '@/lib/utils';

import { Check, ExternalLink, MonitorPlay, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export function PreviewSheet({
    task,
    onClose,
    onApprove,
    onChanges,
    children
}: {
    task: Task | null;
    onClose: () => void;
    /** Left out (the board): no verdict buttons. */
    onApprove?: () => void;
    onChanges?: () => void;
    /** Under the card's details (the board's Manage panel). */
    children?: React.ReactNode;
}) {
    return (
        <AnimatePresence>
            {task && (
                <motion.div
                    key={task.id}
                    role='dialog'
                    aria-modal
                    aria-label={task.title}
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ type: 'spring', damping: 32, stiffness: 320 }}
                    className='fixed inset-0 z-[60] flex flex-col bg-[var(--canvas)]'>
                    <Body task={task} onClose={onClose} onApprove={onApprove} onChanges={onChanges}>
                        {children}
                    </Body>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function Body({
    task,
    onClose,
    onApprove,
    onChanges,
    children
}: {
    task: Task;
    onClose: () => void;
    onApprove?: () => void;
    onChanges?: () => void;
    children?: React.ReactNode;
}) {
    const [slide, setSlide] = useState(0);
    const [framed, setFramed] = useState(false);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <>
            <header className='flex items-center gap-3 border-b border-white/10 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3'>
                <button
                    onClick={onClose}
                    aria-label='Close'
                    className='btn-key inline-flex size-9 items-center justify-center rounded-full'>
                    <X className='size-4' />
                </button>
                <p className='min-w-0 flex-1 truncate font-semibold'>{task.title}</p>
                <OwnerBadge owner={task.owner} />
            </header>

            <div className={cn('flex-1 overflow-y-auto', onApprove ? 'pb-28' : 'pb-10')}>
                {framed && task.previewUrl ? (
                    <div className='flex h-[75dvh] flex-col'>
                        <iframe
                            src={task.previewUrl}
                            title={`Preview of ${task.title}`}
                            className='w-full flex-1 border-b border-white/10 bg-white'
                            sandbox='allow-scripts allow-same-origin allow-forms allow-popups'
                        />
                        <p className='px-4 py-2 text-xs text-white/50'>
                            Blank? Some sites refuse to show inside another page.{' '}
                            <a href={task.previewUrl} target='_blank' rel='noreferrer' className='underline'>
                                Open in a new tab
                            </a>
                        </p>
                    </div>
                ) : task.images.length ? (
                    <div>
                        <div
                            className='flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]'
                            onScroll={(e) => {
                                const el = e.currentTarget;
                                setSlide(Math.round(el.scrollLeft / el.clientWidth));
                            }}>
                            {task.images.map((img) => (
                                // A tap opens the image at full size.
                                <a
                                    key={img}
                                    href={img}
                                    target='_blank'
                                    rel='noreferrer'
                                    className='w-full shrink-0 snap-center bg-black'>
                                    {}
                                    <img src={img} alt='' className='mx-auto max-h-[60dvh] w-full object-contain' />
                                </a>
                            ))}
                        </div>
                        {task.images.length > 1 && (
                            <div className='flex justify-center gap-1.5 py-2.5'>
                                {task.images.map((img, i) => (
                                    <span
                                        key={img}
                                        className={cn(
                                            'h-1.5 rounded-full transition-all',
                                            i === slide ? 'w-5 bg-[var(--brand)]' : 'w-1.5 bg-white/25'
                                        )}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                ) : null}

                <div className='mx-auto flex max-w-2xl flex-col gap-5 px-4 pt-4'>
                    <div>
                        {task.summary && <p className='text-lg leading-snug font-medium'>{task.summary}</p>}
                        <TaskChips task={task} status={!onApprove} className='mt-3' />
                    </div>

                    {task.previewUrl && (
                        <div className='flex gap-2'>
                            <button
                                onClick={() => setFramed((f) => !f)}
                                className='btn-primary inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm'>
                                <MonitorPlay className='size-4' />
                                {framed ? 'Show images' : 'View preview here'}
                            </button>
                            <a
                                href={task.previewUrl}
                                target='_blank'
                                rel='noreferrer'
                                className='btn-key inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium'>
                                <ExternalLink className='size-4' /> New tab
                            </a>
                        </div>
                    )}

                    {(task.before || task.after) && (
                        <div className='grid grid-cols-1 gap-2.5 sm:grid-cols-2'>
                            {task.before && (
                                <div className='rounded-xl border border-white/10 bg-white/[0.03] p-3.5'>
                                    <p className='label-hud mb-1.5'>before</p>
                                    <p className='text-sm whitespace-pre-wrap text-white/75'>{task.before}</p>
                                </div>
                            )}
                            {task.after && (
                                <div className='rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-3.5'>
                                    <p className='label-hud mb-1.5 text-emerald-400'>after</p>
                                    <p className='text-sm whitespace-pre-wrap'>{task.after}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {task.description && (
                        <div>
                            <p className='label-hud mb-1.5'>description</p>
                            <p className='text-sm leading-relaxed whitespace-pre-wrap text-white/80'>
                                {task.description}
                            </p>
                        </div>
                    )}
                    {task.context && (
                        <div className='rounded-xl border border-white/10 bg-white/[0.03] p-3.5'>
                            <p className='label-hud mb-1.5'>context</p>
                            <p className='text-sm whitespace-pre-wrap text-white/70'>{task.context}</p>
                        </div>
                    )}
                    {children}
                </div>
            </div>

            {/* The verdict, also from here. */}
            {onApprove && onChanges && (
                <div className='fixed inset-x-0 bottom-0 flex gap-3 border-t border-white/10 bg-[var(--canvas)]/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl'>
                    <button
                        onClick={onChanges}
                        className='inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 font-semibold text-rose-400'>
                        <X className='size-5' /> Changes
                    </button>
                    <button
                        onClick={onApprove}
                        className='inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 font-semibold text-emerald-400'>
                        <Check className='size-5' /> Approve
                    </button>
                </div>
            )}
        </>
    );
}
