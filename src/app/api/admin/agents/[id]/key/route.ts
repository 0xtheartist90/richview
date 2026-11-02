import { NextResponse } from 'next/server';

import { adminOpen } from '@/lib/admin';
import { hashKey, isUuid } from '@/lib/agent-api';
import { db } from '@/lib/supabase';

import { randomBytes } from 'node:crypto';

/**
 * A new API key for a lead agent (Richie only): the old one stops working at once. The key is in this answer and
 * nowhere else; only its SHA-256 is stored.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    if (!(await adminOpen())) return NextResponse.json({ error: 'RichView is locked' }, { status: 403 });
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Unknown agent' }, { status: 400 });

    const key = `rv_${randomBytes(32).toString('base64url')}`;
    const { data, error } = await db()
        .from('agents')
        .update({ api_key_hash: hashKey(key) })
        .eq('id', id)
        .eq('is_lead', true)
        .select('name')
        .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    if (!data) return NextResponse.json({ error: 'Only a lead agent gets a key' }, { status: 404 });

    return NextResponse.json({ agent: data.name, key }, { headers: { 'Cache-Control': 'no-store' } });
}
