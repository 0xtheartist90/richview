import { NextResponse } from 'next/server';

import { adminOpen } from '@/lib/admin';
import { checkRoutines } from '@/lib/recurring';

/** Richie's "Check now": the late check right away (it also runs each morning and when Review or Routines opens). */
export async function POST() {
    if (!(await adminOpen())) return NextResponse.json({ error: 'RichView is locked' }, { status: 403 });
    try {
        return NextResponse.json(await checkRoutines());
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
}
