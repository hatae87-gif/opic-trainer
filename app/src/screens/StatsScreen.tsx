import { useEffect, useState } from 'react'
import { getDB } from '../db/db'
import { practiceHistory } from '../db/practice'
import type { PracticeDayEntry, StoredScript } from '../types'

/** 날짜별 연습 기록 화면 */
export function StatsScreen() {
  const [history, setHistory] = useState<Map<string, PracticeDayEntry[]>>(new Map())
  const [scripts, setScripts] = useState<Map<string, StoredScript>>(new Map())

  useEffect(() => {
    void (async () => {
      const db = await getDB()
      setScripts(new Map((await db.getAll('scripts')).map((s) => [s.id, s])))
      setHistory(await practiceHistory())
    })()
  }, [])

  const label = (scriptId: string): string => {
    const s = scripts.get(scriptId)
    if (!s) return scriptId
    return `${s.categoryTitle} · ${s.labelKo || s.labelEn}`
  }

  const dayLabel = (day: string): string => {
    const now = new Date()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const todayStr = `${now.getFullYear()}-${mm}-${dd}`
    if (day === todayStr) return `${day} (오늘)`
    return day
  }

  const days = [...history.entries()]
  const grandTotal = days.reduce((n, [, list]) => n + list.reduce((m, e) => m + e.count, 0), 0)

  return (
    <div className="screen">
      <header className="home-header">
        <h1>연습 기록</h1>
        {grandTotal > 0 && <span className="dim">누적 {grandTotal}회</span>}
      </header>

      {days.length === 0 && (
        <div className="empty">
          <p>아직 기록이 없습니다.</p>
          <p className="dim">
            스크립트 전체 재생을 끝까지 듣거나, 랜덤 스피킹에서 [완료하고 다음]을 누르면
            그날의 기록으로 쌓입니다.
          </p>
        </div>
      )}

      {days.map(([day, list]) => {
        const total = list.reduce((n, e) => n + e.count, 0)
        return (
          <section className="day-card" key={day}>
            <h2>
              {dayLabel(day)}
              <span className="cat-count">{total}회</span>
            </h2>
            <ul className="day-list">
              {list
                .sort((a, b) => b.count - a.count)
                .map((e) => (
                  <li key={e.key}>
                    <span>{label(e.scriptId)}</span>
                    <span className="chip-count">×{e.count}</span>
                  </li>
                ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
