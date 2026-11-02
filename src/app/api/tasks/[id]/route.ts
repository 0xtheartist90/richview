import { NextResponse, after } from 'next/server';

import { adminOpen } from '@/lib/admin';
import { agentsByName, belongs, issue } from '@/lib/agent-api';
import { runRecurring } from '@/lib/recurring';
import { db } from '@/lib/supabase';
import { TASK_STATUSES } from '@/lib/task-types';
import { deleteTask, editTask } from '@/lib/tasks';
import { notifyChange, notifyDecision } from '@/lib/webhooks';

import { z } from 'zod';

type Params = { params: Promise<{ id: string }> };

const Edit = z
    .strictObject({
        /** rejected = archived. */
        status: z.enum(TASK_STATUSES).optional(),
        title: z.string().trim().min(1, 'Title is required').max(200).optional(),
        summary: z.string().trim().max(300).nullable().optional(),
        priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
        /** The new owner's agent id; must belong to the task's project. */
        owner: z.uuid().optional(),
        comment: z.string().trim().max(5000).optional()
    })
    .refine((e) => Object.keys(e).length > 0, 'Nothing to change');

/**
 * Richie's change to a card from the board (move, rename, new owner, priority, a comment). The owner and the
 * project's lead hear about it by webhook once the answer is out.
 */
export async function PATCH(req: Request, { params }: Params) {
    if (!(await adminOpen())) return NextResponse.json({ error: 'RichView is locked' }, { status: 403 });
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Unknown task' }, { status: 400 });
    const parsed = Edit.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: issue(parsed.error) }, { status: 400 });
    const { owner, comment, ...rest } = parsed.data;
    if (rest.status === 'changes_requested' && !comment)
        return NextResponse.json({ error: 'Say what should change' }, { status: 400 });
    try {
        if (owner) {
            const t = await db().from('tasks').select('project_id').eq('id', id).maybeSingle();
            const agent = [...(await agentsByName()).values()].find((a) => a.id === owner);
            if (!agent) return NextResponse.json({ error: 'No such agent' }, { status: 400 });
            if (t.data && !belongs(agent, t.data.project_id as string))
                return NextResponse.json({ error: `${agent.name} isn't in this project` }, { status: 400 });
        }
        const result = await editTask(id, { ...rest, ownerId: owner, comment: comment || undefined });
        if (!result) return NextResponse.json({ error: 'No such task' }, { status: 404 });
        after(async () => {
            if (result.decision) await notifyDecision(result.decision);
            if (result.change) await notifyChange(result.change);
            // A routine's late run done: today's may be made now instead of tomorrow.
            if (rest.status === 'approved') await runRecurring();
        });

        return NextResponse.json({ ok: true });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
}

/** Deletes a card for good (Richie only); the owner and the lead hear about it. */
export async function DELETE(_req: Request, { params }: Params) {
    if (!(await adminOpen())) return NextResponse.json({ error: 'RichView is locked' }, { status: 403 });
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Unknown task' }, { status: 400 });
    try {
        const change = await deleteTask(id);
        if (!change) return NextResponse.json({ error: 'No such task' }, { status: 404 });
        after(() => notifyChange(change));

        return NextResponse.json({ ok: true });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
}
