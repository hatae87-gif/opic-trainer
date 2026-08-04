import { getDB } from '../db/db'
import type { Grade, SrsEntry } from '../types'

const DAY = 24 * 60 * 60 * 1000

/**
 * SM-2를 간소화한 간격 반복.
 * - again: 처음부터 (10분 뒤 다시)
 * - hard: 간격 유지, ease 감소
 * - good: 간격 확대
 */
export function nextEntry(prev: SrsEntry | undefined, sentenceKey: string, grade: Grade): SrsEntry {
  const now = Date.now()
  const e: SrsEntry = prev ?? {
    sentenceId: sentenceKey,
    ease: 2.5,
    interval: 0,
    dueAt: now,
    reps: 0,
    lapses: 0,
  }

  if (grade === 'again') {
    return {
      ...e,
      reps: e.reps + 1,
      lapses: e.lapses + 1,
      ease: Math.max(1.3, e.ease - 0.2),
      interval: 0,
      dueAt: now + 10 * 60 * 1000,
    }
  }
  if (grade === 'hard') {
    const interval = Math.max(1, e.interval)
    return {
      ...e,
      reps: e.reps + 1,
      ease: Math.max(1.3, e.ease - 0.15),
      interval,
      dueAt: now + interval * DAY,
    }
  }
  const interval = e.interval === 0 ? 1 : Math.round(e.interval * e.ease)
  return { ...e, reps: e.reps + 1, ease: e.ease + 0.05, interval, dueAt: now + interval * DAY }
}

export async function grade(sentenceKey: string, g: Grade): Promise<void> {
  const db = await getDB()
  const prev = await db.get('srs', sentenceKey)
  await db.put('srs', nextEntry(prev, sentenceKey, g))
}

export async function dueSentenceIds(limit = 50): Promise<string[]> {
  const db = await getDB()
  const due = await db.getAllFromIndex('srs', 'byDue', IDBKeyRange.upperBound(Date.now()))
  return due
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, limit)
    .map((e) => e.sentenceId)
}

/** 자주 틀리는 문장 순위 */
export async function hardestSentences(limit = 20): Promise<SrsEntry[]> {
  const db = await getDB()
  const all = await db.getAll('srs')
  return all
    .filter((e) => e.lapses > 0)
    .sort((a, b) => b.lapses - a.lapses || a.ease - b.ease)
    .slice(0, limit)
}
