import { NextResponse } from 'next/server';

import { adminOpen } from '@/lib/admin';
import { isUuid } from '@/lib/agent-api';
import { db } from '@/lib/supabase';

import { z } from 'zod';

const Change = z.strictObject({
    /** The project the agent belongs to (its slug), or null for none. */
    project: z.string().trim().min(1).nullable()
});

/** Moves an agent to another project (Richie only); it then writes in that project's lead's projects. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    if (!(await adminOpen())) return NextResponse.json({ error: 'RichView is locked' }, { status: 403 });
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Unknown agent' }, { status: 400 });
    const parsed = Change.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

    let projectId: string | null = null;
    if (parsed.data.project) {
        const p = await db().from('projects').select('id').eq('slug', parsed.data.project).maybeSingle();
        if (p.error) return NextResponse.json({ error: p.error.message }, { status: 502 });
        if (!p.data) return NextResponse.json({ error: 'No such project' }, { status: 400 });
        projectId = p.data.id as string;
    }
    const { data, error } = await db()
        .from('agents')
        .update({ project_id: projectId })
        .eq('id', id)
        .select('id')
        .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    if (!data) return NextResponse.json({ error: 'No such agent' }, { status: 404 });

    return NextResponse.json({ ok: true });
}
