import { useEffect, useMemo, useState } from 'react'
import { getDB } from '../db/db'
import { practiceHistory } from '../db/practice'
import type { PracticeDayEntry, StoredScript } from '../types'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function toDayString(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function todayString(): string {
  const now = new Date()
  return toDayString(now.getFullYear(), now.getMonth(), now.getDate())
}

/**
 * 연습 기록: 달력에서 날짜를 고르면 그날 연습한 스크립트를
 * 홈 화면과 같은 카테고리 카드 구조로 ×N 과 함께 보여준다.
 */
export function StatsScreen() {
  const [history, setHistory] = useState<Map<string, PracticeDayEntry[]>>(new Map())
  const [scripts, setScripts] = useState<StoredScript[]>([])
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [selected, setSelected] = useState<string>(todayString())

  useEffect(() => {
    void (async () => {
      const db = await getDB()
      setScripts(await db.getAll('scripts'))
      setHistory(await practiceHistory())
    })()
  }, [])

  /** 날짜 → 그날 총 연습 횟수 */
  const dayTotals = useMemo(() => {
    const m = new Map<string, number>()
    for (const [day, list] of history) {
      m.set(day, list.reduce((n, e) => n + e.count, 0))
    }
    return m
  }, [history])

  const moveMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }

  // 달력 칸: 1일 앞의 빈 칸 + 말일까지
  const firstWeekday = new Date(year, month, 1).getDay()
  const lastDate = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: lastDate }, (_, i) => i + 1),
  ]

  // 선택한 날의 스크립트별 횟수
  const selectedCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of history.get(selected) ?? []) m.set(e.scriptId, e.count)
    return m
  }, [history, selected])

  // 홈 화면과 같은 순서·구조로 카테고리를 묶되, 그날 연습한 카테고리만 보여준다
  const ordered = useMemo(
    () => [...scripts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [scripts],
  )
  const categories = useMemo(() => {
    const withCount = ordered.filter((s) => (selectedCounts.get(s.id) ?? 0) > 0)
    return [...new Map(withCount.map((s) => [s.categoryKey, s.categoryTitle])).entries()]
  }, [ordered, selectedCounts])

  const selectedTotal = dayTotals.get(selected) ?? 0
  const today = todayString()

  return (
    <div className="screen">
      <header className="home-header">
        <h1>연습 기록</h1>
      </header>

      <div className="cal">
        <div className="cal-head">
          <button className="btn-icon" onClick={() => moveMonth(-1)} aria-label="이전 달">‹</button>
          <strong>{year}년 {month + 1}월</strong>
          <button className="btn-icon" onClick={() => moveMonth(1)} aria-label="다음 달">›</button>
        </div>
        <div className="cal-grid">
          {WEEKDAYS.map((w) => (
            <span key={w} className="cal-weekday">{w}</span>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <span key={`empty-${i}`} />
            const day = toDayString(year, month, d)
            const total = dayTotals.get(day) ?? 0
            return (
              <button
                key={day}
                className={
                  `cal-day ${selected === day ? 'selected' : ''} ` +
                  `${day === today ? 'today' : ''} ${total > 0 ? 'has-data' : ''}`
                }
                onClick={() => setSelected(day)}
              >
                <span>{d}</span>
                {total > 0 && <span className="cal-badge">{total}</span>}
              </button>
            )
          })}
        </div>
      </div>

      <h2 className="stats-day-title">
        {selected}
        {selected === today ? ' (오늘)' : ''} — {selectedTotal > 0 ? `${selectedTotal}회 연습` : '기록 없음'}
      </h2>

      {categories.length === 0 && (
        <p className="dim">
          이날은 연습 기록이 없습니다. 전체 재생 완주, 전체 녹음 완료, 스피킹 완료가 기록으로 쌓입니다.
        </p>
      )}

      <div className="cat-grid">
        {categories.map(([key, title]) => {
          const own = ordered.filter(
            (s) => s.categoryKey === key && (selectedCounts.get(s.id) ?? 0) > 0,
          )
          const total = own.reduce((n, s) => n + (selectedCounts.get(s.id) ?? 0), 0)
          return (
            <section className="cat-card" key={key}>
              <h2>
                {title}
                <span className="cat-count">{total}회</span>
              </h2>
              <div className="chip-list">
                {own.map((s) => (
                  <span key={s.id} className="chip stat-chip">
                    {s.labelKo || s.labelEn}
                    <span className="chip-count">×{selectedCounts.get(s.id)}</span>
                  </span>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
