import { NextResponse } from 'next/server';

import { adminOpen } from '@/lib/admin';
import { runRecurring } from '@/lib/recurring';

/** Richie's "Run now": makes what's due today right away (what already ran today isn't made again). */
export async function POST() {
    if (!(await adminOpen())) return NextResponse.json({ error: 'RichView is locked' }, { status: 403 });
    try {
        return NextResponse.json(await runRecurring());
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
}
