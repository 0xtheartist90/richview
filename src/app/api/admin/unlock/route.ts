import { NextResponse } from 'next/server';

import { ADMIN_COOKIE, ADMIN_MAX_AGE, adminKey, adminPasswordMatches } from '@/lib/admin';

/** The admin password, typed once per browser: right sets the cookie, wrong waits a second (no fast guessing). */
export async function POST(req: Request) {
    const { password } = ((await req.json().catch(() => null)) ?? {}) as { password?: unknown };
    const key = adminKey();
    if (!key) return NextResponse.json({ error: 'ADMIN_PASSWORD is not set' }, { status: 503 });
    if (typeof password !== 'string' || !adminPasswordMatches(password)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, key, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: ADMIN_MAX_AGE
    });

    return res;
}
