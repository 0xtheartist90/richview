'use client';

// The app's frame, in SRE's look: on a desktop a dark sidebar (the pages, then every project in its own colour); on a
// phone a slim top bar and a tab bar at the bottom, in thumb reach.
import type { ReactNode } from 'react';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { domainHex } from '@/components/review/parts';
import type { ProjectSummary } from '@/lib/tasks';
import { cn } from '@/lib/utils';

import { Bot, Layers, LayoutList, Repeat } from 'lucide-react';

const PAGES = [
    { href: '/review', label: 'Review', icon: Layers },
    { href: '/board', label: 'Board', icon: LayoutList },
    { href: '/routines', label: 'Routines', icon: Repeat },
    { href: '/agents', label: 'Agents', icon: Bot }
];

/** "richview" as a wordmark: light, lowercase, widely spaced, "view" in gold. */
export function Wordmark({ className }: { className?: string }) {
    return (
        <Link href='/review' aria-label='RichView' className={cn('text-lg tracking-[0.18em] lowercase', className)}>
            <span className='font-light text-white'>rich</span>
            <span className='text-glow font-normal'>view</span>
        </Link>
    );
}

/** How many cards wait for review, as SRE's small red count. */
function CountBadge({ n }: { n: number }) {
    if (!n) return null;

    return (
        <span className='inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] leading-none font-semibold text-white tabular-nums'>
            {n}
        </span>
    );
}

export function Shell({ projects, children }: { projects: ProjectSummary[]; children: ReactNode }) {
    const path = usePathname();
    const params = useSearchParams();
    const toReview = projects.reduce((n, p) => n + p.review, 0);
    // The sidebar's projects open the page you're on (Board or Routines), for that project.
    const page = path.startsWith('/routines') ? '/routines' : '/board';
    const perProject = path.startsWith('/board') || path.startsWith('/routines');
    const current = perProject ? (params.get('project') ?? projects[0]?.slug) : null;

    return (
        <div className='min-h-dvh lg:pl-60'>
            <aside className='dark-panel fixed inset-y-0 left-0 z-30 hidden w-60 flex-col overflow-y-auto border-r border-white/[0.06] bg-[var(--sidebar-bg)] bg-[linear-gradient(180deg,rgb(255_255_255/0.02),transparent_30%)] px-3 py-5 lg:flex'>
                <div className='px-2.5'>
                    <Wordmark />
                </div>
                <p className='label-hud mt-8 mb-3 px-2.5 text-white/40'>Workspace</p>
                <nav aria-label='Pages' className='flex flex-col gap-0.5'>
                    {PAGES.map(({ href, label, icon: Icon }) => {
                        const active = path.startsWith(href);

                        return (
                            <Link
                                key={href}
                                href={href}
                                aria-current={active ? 'page' : undefined}
                                className={cn(
                                    'flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[14.5px] font-medium transition-colors hover:bg-white/[0.04] hover:text-white',
                                    active ? 'bg-white/[0.06] text-white' : 'text-white/55'
                                )}>
                                <Icon
                                    className={cn('size-4 opacity-80', active && 'text-[var(--brand)]')}
                                    strokeWidth={1.75}
                                />
                                {label}
                                {href === '/review' && (
                                    <span className='ml-auto'>
                                        <CountBadge n={toReview} />
                                    </span>
                                )}
                                {active && href !== '/review' && <span className='led mr-1 ml-auto' />}
                            </Link>
                        );
                    })}
                </nav>

                {projects.length > 0 && (
                    <>
                        <p className='label-hud mt-8 mb-3 px-2.5 text-white/40'>Projects</p>
                        <nav aria-label='Projects' className='flex flex-col gap-0.5'>
                            {projects.map((p) => {
                                const active = current === p.slug;

                                return (
                                    <Link
                                        key={p.slug}
                                        href={`${page}?project=${p.slug}`}
                                        aria-current={active ? 'page' : undefined}
                                        className={cn(
                                            'flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[14.5px] font-medium transition-colors hover:bg-white/[0.04] hover:text-white',
                                            active ? 'bg-white/[0.06] text-white' : 'text-white/55'
                                        )}>
                                        <span
                                            className='size-2 rounded-full'
                                            style={{
                                                background: domainHex(p.slug),
                                                boxShadow: `0 0 8px ${domainHex(p.slug)}99`
                                            }}
                                        />
                                        <span className='truncate'>{p.name}</span>
                                        <span className='readout ml-auto text-xs text-white/35'>{p.open}</span>
                                    </Link>
                                );
                            })}
                        </nav>
                    </>
                )}
            </aside>

            <header className='sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-[var(--canvas)]/80 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:hidden'>
                <Wordmark />
            </header>

            <main className='px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pt-5 lg:px-8 lg:pt-8 lg:pb-12'>
                {children}
            </main>

            {/* The pages, one tap away on a phone. */}
            <nav
                aria-label='Pages'
                className='dark-panel fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-white/[0.08] bg-[var(--sidebar-bg)]/95 px-1 pt-1.5 pb-[max(0.4rem,env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden'>
                {PAGES.map(({ href, label, icon: Icon }) => {
                    const on = path.startsWith(href);

                    return (
                        <Link
                            key={href}
                            href={href}
                            aria-current={on ? 'page' : undefined}
                            className={cn(
                                'relative flex flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-medium',
                                on ? 'text-[var(--brand-2)]' : 'text-white/55'
                            )}>
                            <Icon className='size-[22px]' strokeWidth={on ? 2 : 1.6} />
                            {label}
                            {href === '/review' && toReview > 0 && (
                                <span className='absolute top-0 left-1/2 ml-2'>
                                    <CountBadge n={toReview} />
                                </span>
                            )}
                        </Link>
                    );
                })}
            </nav>
        </div>
    );
}
