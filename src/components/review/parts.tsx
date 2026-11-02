// The pieces a task is drawn with on /review: its domain colour, the owner badge, the chips and the hero image.
import { STATUS_META, type Task } from '@/lib/task-types';
import { cn } from '@/lib/utils';

import { Sparkles } from 'lucide-react';

/** One colour per domain: the card's glow, its chip and the hero when there's no image. */
const DOMAIN_HEX: Record<string, string> = {
    planning: '#38bdf8',
    onboarding: '#a78bfa',
    dashboard: '#f5b942',
    finance: '#34d399',
    reports: '#fb7185',
    platforms: '#22d3ee',
    ops: '#f97316'
};
const SPARE = ['#38bdf8', '#a78bfa', '#f5b942', '#34d399', '#fb7185', '#22d3ee', '#f97316'];

/** A known domain's colour; any other domain (other projects) gets a steady one from its name. */
export function domainHex(d: string) {
    if (!d) return '#94a3b8';
    if (DOMAIN_HEX[d]) return DOMAIN_HEX[d];
    let h = 0;
    for (const c of d) h = (h * 31 + c.charCodeAt(0)) >>> 0;

    return SPARE[h % SPARE.length];
}

const IMPACT_ICON: Record<string, string> = { revenue: '$', 'time saved': '⏱', quality: '★' };
const PRIORITY_HEX: Record<string, string> = { urgent: '#f43f5e', high: '#f59e0b' };

export function Chip({ children, hex, className }: { children: React.ReactNode; hex?: string; className?: string }) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap backdrop-blur-md',
                !hex && 'border-white/15 bg-black/35 text-white/85',
                className
            )}
            style={hex ? { borderColor: `${hex}66`, background: `${hex}26`, color: hex } : undefined}>
            {children}
        </span>
    );
}

/** Project, priority (when it stands out), domain, impact and effort as chips; `status` adds where it stands. */
export function TaskChips({ task, status, className }: { task: Task; status?: boolean; className?: string }) {
    return (
        <div className={cn('flex flex-wrap gap-1.5', className)}>
            {status && <Chip hex={STATUS_META[task.status].hex}>{STATUS_META[task.status].label}</Chip>}
            <Chip>{task.project.name}</Chip>
            {PRIORITY_HEX[task.priority] && <Chip hex={PRIORITY_HEX[task.priority]}>{task.priority}</Chip>}
            {task.returned && <Chip hex='#f59e0b'>returned</Chip>}
            {task.domain && <Chip hex={domainHex(task.domain)}>{task.domain}</Chip>}
            {task.impact && (
                <Chip>
                    <span aria-hidden>{IMPACT_ICON[task.impact] ?? '•'}</span> {task.impact}
                </Chip>
            )}
            {task.effort && <Chip>Effort {task.effort}</Chip>}
        </div>
    );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
    const hex = domainHex(name.toLowerCase());

    return (
        <span
            aria-hidden
            className={cn(
                'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-black',
                className
            )}
            style={{ background: hex }}>
            {name.slice(0, 1).toUpperCase()}
        </span>
    );
}

export function OwnerBadge({ owner, className }: { owner: string; className?: string }) {
    if (!owner) return null;

    return (
        <span
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 py-0.5 pr-2.5 pl-0.5 text-xs font-medium text-white backdrop-blur-md',
                className
            )}>
            <Avatar name={owner} />
            {owner}
        </span>
    );
}

/** The first preview image, or a glow in the domain's colour when there is none. */
export function Hero({ task, className }: { task: Task; className?: string }) {
    const img = task.images[0];
    const hex = domainHex(task.domain);

    return img ? (
        // Images from anywhere (Supabase storage, agents' own links): a plain img, no Next image optimisation.

        <img
            src={img}
            alt=''
            draggable={false}
            className={cn('pointer-events-none size-full object-cover select-none', className)}
        />
    ) : (
        <div
            className={cn('flex size-full items-center justify-center', className)}
            style={{
                background: `radial-gradient(120% 80% at 30% 20%, ${hex}55, transparent 60%), radial-gradient(90% 70% at 80% 90%, ${hex}33, transparent 60%), var(--hero)`
            }}>
            <Sparkles className='size-16 opacity-60' style={{ color: hex }} strokeWidth={1.25} />
        </div>
    );
}
