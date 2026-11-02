import { NextResponse } from 'next/server';

import { adminOpen } from '@/lib/admin';
import { isUuid } from '@/lib/agent-api';
import { RECURRING_SELECT, type RecurringRow, reportRun } from '@/lib/recurring';
import { db } from '@/lib/supabase';

import { z } from 'zod';

/** Richie logs a run by hand (he did it himself, or saw it done): ok, or failed with a note. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    if (!(await adminOpen())) return NextResponse.json({ error: 'RichView is locked' }, { status: 403 });
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Unknown routine' }, { status: 400 });
    const parsed = z
        .strictObject({ status: z.enum(['ok', 'failed']), note: z.string().trim().max(5000).optional() })
        .safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Send { "status": "ok" | "failed" }' }, { status: 400 });
    const { data, error } = await db().from('recurring').select(RECURRING_SELECT).eq('id', id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    if (!data) return NextResponse.json({ error: 'No such routine' }, { status: 404 });
    try {
        await reportRun(data as RecurringRow, { ...parsed.data, note: parsed.data.note || undefined, agentId: null });

        return NextResponse.json({ ok: true });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
}
