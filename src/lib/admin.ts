// Richie's pages sit behind the admin password (ADMIN_PASSWORD, set in .env.local and in Vercel, never in git). A
// browser that typed it keeps a key in a cookie; changing the password locks every browser out again. Server only.
import 'server-only';

import { cookies } from 'next/headers';

import { createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'richview-admin';
export const ADMIN_MAX_AGE = 60 * 60 * 24 * 30;

export function sameSecret(a: string, b: string) {
    const x = Buffer.from(a);
    const y = Buffer.from(b);

    return x.length === y.length && timingSafeEqual(x, y);
}

/** What the admin cookie holds: derived from the password. Null when no password is set (the pages stay shut). */
export function adminKey(): string | null {
    const password = process.env.ADMIN_PASSWORD;

    return password ? createHmac('sha256', password).update('richview-admin-v1').digest('hex') : null;
}

export function adminPasswordMatches(input: string): boolean {
    const password = process.env.ADMIN_PASSWORD;

    return !!password && sameSecret(input, password);
}

/** Whether this browser unlocked the app. */
export async function adminOpen(): Promise<boolean> {
    const key = adminKey();
    const got = (await cookies()).get(ADMIN_COOKIE)?.value;

    return !!key && !!got && sameSecret(got, key);
}
