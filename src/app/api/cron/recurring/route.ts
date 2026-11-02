import { NextResponse } from 'next/server';

import { sameSecret } from '@/lib/admin';
import { runRecurring } from '@/lib/recurring';

/**
 * The morning run (Vercel Cron, see vercel.json): makes today's recurring tasks. Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; without CRON_SECRET set, nothing runs.
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set' }, { status: 503 });
    const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!got || !sameSecret(got, secret)) return NextResponse.json({ error: 'Not allowed' }, { status: 401 });
    try {
        return NextResponse.json(await runRecurring());
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
}
