import type { ReactNode } from 'react';

import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Link from 'next/link';

import { ThemeProvider } from 'next-themes';

import '@/app/globals.css';
import { Toaster } from '@/registry/new-york-v4/ui/sonner';

const geistSans = localFont({
    src: './fonts/GeistVF.woff',
    variable: '--font-geist-sans',
    weight: '100 900'
});
const geistMono = localFont({
    src: './fonts/GeistMonoVF.woff',
    variable: '--font-geist-mono',
    weight: '100 900'
});

export const metadata: Metadata = {
    title: 'RichView',
    description: 'Tasks and reviews for Richie and his agents',
    appleWebApp: { capable: true, title: 'RichView', statusBarStyle: 'black-translucent' }
};

export const viewport: Viewport = {
    themeColor: '#09090b',
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover'
};

const Layout = ({ children }: Readonly<{ children: ReactNode }>) => {
    return (
        // ? https://github.com/pacocoursey/next-themes?tab=readme-ov-file#with-app
        <html suppressHydrationWarning lang='en'>
            <body
                className={`${geistSans.variable} ${geistMono.variable} bg-[#09090b] text-white overscroll-none antialiased`}>
                {/* Dark only for now: the cards are made for it. */}
                <ThemeProvider attribute='class' forcedTheme='dark'>
                    <header className='mx-auto flex h-14 max-w-md items-center px-4 pt-[env(safe-area-inset-top)]'>
                        <Link href='/review' className='text-lg font-semibold tracking-tight'>
                            RichView
                        </Link>
                    </header>
                    <main className='px-4 pb-[max(1rem,env(safe-area-inset-bottom))]'>{children}</main>
                    <Toaster position='top-center' />
                </ThemeProvider>
            </body>
        </html>
    );
};

export default Layout;
