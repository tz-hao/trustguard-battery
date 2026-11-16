import { NextResponse } from 'next/server';
import { runAttackScenario, type AttackId } from '@/lib/server/attack-runner';
import { verifyCsrf } from '@/lib/server/session';

const ALL_ATTACKS: AttackId[] = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];

export async function POST(request: Request) {
  const csrf = verifyCsrf(request);
  if (csrf) return csrf;
  const body = (await request.json().catch(() => ({}))) as { attackId?: AttackId | 'ALL' };
  try {
    if (body.attackId === 'ALL') {
      const results = [];
      for (const id of ALL_ATTACKS) {
        results.push(await runAttackScenario(id));
      }
      return NextResponse.json({ results });
    }
    if (!body.attackId || !ALL_ATTACKS.includes(body.attackId)) {
      return NextResponse.json({ code: 'INVALID_ATTACK_ID' }, { status: 400 });
    }
    const result = await runAttackScenario(body.attackId);
    return NextResponse.json({ results: [result] });
  } catch (error) {
    return NextResponse.json(
      { code: 'LAB_EXECUTION_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
