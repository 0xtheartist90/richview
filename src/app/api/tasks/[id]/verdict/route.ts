import { NextResponse, after } from 'next/server';

import { adminOpen } from '@/lib/admin';
import { DECISION_ACTIONS } from '@/lib/task-types';
import { decide } from '@/lib/tasks';
import { notifyLead } from '@/lib/webhooks';

import { z } from 'zod';

const Verdict = z.object({
    action: z.enum(DECISION_ACTIONS),
    comment: z.string().trim().max(5000).optional()
});

/** Richie's verdict on a card (a swipe); the project's lead hears it by webhook once the answer is out. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    if (!(await adminOpen())) return NextResponse.json({ error: 'RichView is locked' }, { status: 403 });
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Unknown task' }, { status: 400 });
    const parsed = Verdict.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
    const { action, comment } = parsed.data;
    if (action === 'changes_requested' && !comment)
        return NextResponse.json({ error: 'Say what should change' }, { status: 400 });
    try {
        const decision = await decide(id, action, comment || undefined);
        if (!decision) return NextResponse.json({ error: 'Already decided' }, { status: 409 });
        after(() => notifyLead(decision));

        return NextResponse.json({ ok: true, seq: decision.seq });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
}
