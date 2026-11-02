import { NextResponse } from 'next/server';

import { adminOpen } from '@/lib/admin';
import { isUuid } from '@/lib/agent-api';
import { db } from '@/lib/supabase';

import { z } from 'zod';

type Params = { params: Promise<{ id: string }> };

/** Pauses or resumes a recurring task (Richie only). */
export async function PATCH(req: Request, { params }: Params) {
    if (!(await adminOpen())) return NextResponse.json({ error: 'RichView is locked' }, { status: 403 });
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Unknown recurring task' }, { status: 400 });
    const parsed = z.strictObject({ active: z.boolean() }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Send { "active": true | false }' }, { status: 400 });
    const { data, error } = await db().from('recurring').update(parsed.data).eq('id', id).select('id').maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    if (!data) return NextResponse.json({ error: 'No such recurring task' }, { status: 404 });

    return NextResponse.json({ ok: true });
}

/** Removes a recurring task (Richie only); the tasks it already made stay. */
export async function DELETE(_req: Request, { params }: Params) {
    if (!(await adminOpen())) return NextResponse.json({ error: 'RichView is locked' }, { status: 403 });
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Unknown recurring task' }, { status: 400 });
    const { error } = await db().from('recurring').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });

    return NextResponse.json({ ok: true });
}
