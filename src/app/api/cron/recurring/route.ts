import { NextResponse } from 'next/server';

import { sameSecret } from '@/lib/admin';
import { checkRoutines } from '@/lib/recurring';

/**
 * The morning late check (Vercel Cron, see vercel.json): routines that didn't run in time get a card on Review. Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; without CRON_SECRET set, nothing runs.
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set' }, { status: 503 });
    const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!got || !sameSecret(got, secret)) return NextResponse.json({ error: 'Not allowed' }, { status: 401 });
    try {
        return NextResponse.json(await checkRoutines());
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
}
