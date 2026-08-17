import { getDB } from './db'
import type { PracticeDayEntry } from '../types'

/** 로컬 기준 YYYY-MM-DD */
function today(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 연습 1회 기록. 전체 재생 완주 또는 스피킹 연습 완료가 1회다 */
export async function recordPractice(scriptId: string): Promise<void> {
  const db = await getDB()
  const prev = await db.get('practice', scriptId)
  await db.put('practice', {
    scriptId,
    count: (prev?.count ?? 0) + 1,
    lastAt: Date.now(),
  })
  const day = today()
  const key = `${day}|${scriptId}`
  const prevDay = await db.get('practiceDays', key)
  await db.put('practiceDays', { key, day, scriptId, count: (prevDay?.count ?? 0) + 1 })
}

/** 스크립트 id → 누적 연습 횟수 (홈 화면 배지용) */
export async function practiceCounts(): Promise<Map<string, number>> {
  const db = await getDB()
  const all = await db.getAll('practice')
  return new Map(all.map((p) => [p.scriptId, p.count]))
}

/** 날짜별 기록 전체. 최근 날짜부터 */
export async function practiceHistory(): Promise<Map<string, PracticeDayEntry[]>> {
  const db = await getDB()
  const all = await db.getAll('practiceDays')
  const byDay = new Map<string, PracticeDayEntry[]>()
  for (const e of all.sort((a, b) => b.day.localeCompare(a.day))) {
    const list = byDay.get(e.day) ?? []
    list.push(e)
    byDay.set(e.day, list)
  }
  return byDay
}
