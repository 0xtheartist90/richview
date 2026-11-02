import { Suspense } from 'react';
import type { ReactNode } from 'react';

import type { Metadata, Viewport } from 'next';
import { Montserrat } from 'next/font/google';

import { ThemeProvider } from 'next-themes';

import '@/app/globals.css';
import { Shell } from '@/components/shell';
import { adminOpen } from '@/lib/admin';
import { type ProjectSummary, getProjects } from '@/lib/tasks';
import { Toaster } from '@/registry/new-york-v4/ui/sonner';

// Montserrat, SRE's typeface: light, geometric, generously spaced.
const montserrat = Montserrat({
    subsets: ['latin'],
    weight: ['300', '400', '500', '600', '700'],
    variable: '--font-montserrat',
    display: 'swap'
});

export const metadata: Metadata = {
    title: 'RichView',
    description: 'Tasks and reviews for Richie and his agents',
    appleWebApp: { capable: true, title: 'RichView', statusBarStyle: 'black-translucent' }
};

export const viewport: Viewport = {
    themeColor: '#1b1c20',
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover'
};

/** The projects for the sidebar and the review count; none while locked or when the database can't be read. */
async function sidebarProjects(): Promise<ProjectSummary[]> {
    if (!(await adminOpen())) return [];
    try {
        return await getProjects();
    } catch {
        return [];
    }
}

export default async function Layout({ children }: Readonly<{ children: ReactNode }>) {
    const projects = await sidebarProjects();

    return (
        // ? https://github.com/pacocoursey/next-themes?tab=readme-ov-file#with-app
        <html suppressHydrationWarning lang='en' className='dark'>
            <body className={`${montserrat.variable} overscroll-none antialiased`}>
                {/* Dark only, as SRE: the cards and the gold are made for it. */}
                <ThemeProvider attribute='class' forcedTheme='dark'>
                    <Suspense>
                        <Shell projects={projects}>{children}</Shell>
                    </Suspense>
                    <Toaster position='top-center' />
                </ThemeProvider>
            </body>
        </html>
    );
}
