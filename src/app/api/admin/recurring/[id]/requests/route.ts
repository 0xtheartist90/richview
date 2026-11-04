import { NextResponse } from 'next/server';

import { adminOpen } from '@/lib/admin';
import { isUuid } from '@/lib/agent-api';
import { RECURRING_SELECT, type RecurringRow, addRequest } from '@/lib/recurring';
import { db } from '@/lib/supabase';

import { z } from 'zod';

/** Richie asks for a change to a routine: it stays open on the routine, and goes to its owner and the project's lead. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    if (!(await adminOpen())) return NextResponse.json({ error: 'RichView is locked' }, { status: 403 });
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Unknown routine' }, { status: 400 });
    const parsed = z
        .strictObject({ request: z.string().trim().min(1).max(2000) })
        .safeParse(await req.json().catch(() => null));
    if (!parsed.success)
        return NextResponse.json({ error: 'Say what should change (at most 2000 characters)' }, { status: 400 });
    const { data, error } = await db().from('recurring').select(RECURRING_SELECT).eq('id', id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    if (!data) return NextResponse.json({ error: 'No such routine' }, { status: 404 });
    try {
        await addRequest(data as RecurringRow, parsed.data.request);

        return NextResponse.json({ ok: true }, { status: 201 });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
}
