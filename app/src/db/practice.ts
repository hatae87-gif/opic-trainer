import { getDB } from './db'

/** 연습 1회 기록. 전체 재생 완주 또는 스피킹 연습 완료가 1회다 */
export async function recordPractice(scriptId: string): Promise<void> {
  const db = await getDB()
  const prev = await db.get('practice', scriptId)
  await db.put('practice', {
    scriptId,
    count: (prev?.count ?? 0) + 1,
    lastAt: Date.now(),
  })
}

/** 스크립트 id → 연습 횟수 */
export async function practiceCounts(): Promise<Map<string, number>> {
  const db = await getDB()
  const all = await db.getAll('practice')
  return new Map(all.map((p) => [p.scriptId, p.count]))
}
