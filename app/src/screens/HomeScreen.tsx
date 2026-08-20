import { useEffect, useRef, useState } from 'react'
import { getDB } from '../db/db'
import { importPack, type ImportSummary } from '../import/importPack'
import { dueSentenceIds } from '../srs/srs'
import type { StoredScript } from '../types'

interface Props {
  onOpenScript: (id: string) => void
  onStartReview: () => void
}

export function HomeScreen({ onOpenScript, onStartReview }: Props) {
  const [scripts, setScripts] = useState<StoredScript[]>([])
  const [dueCount, setDueCount] = useState(0)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = async () => {
    const db = await getDB()
    setScripts(await db.getAll('scripts'))
    setDueCount((await dueSentenceIds()).length)
  }

  useEffect(() => {
    void reload()
  }, [])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    setMessage(null)
    try {
      const s: ImportSummary = await importPack(file)
      setMessage(
        `가져오기 완료 — 스크립트 ${s.scripts}개, 문장 ${s.sentences}개 (구간 ${s.withTiming}개), 오디오 ${s.withAudio}개` +
          (s.mockQuestions > 0 ? `, 모의고사 ${s.mockQuestions}문항` : ', 모의고사 없음') +
          (s.carriedOver ? `, 학습기록 유지 ${s.carriedOver}문장` : '') +
          (s.withTiming === 0 ? ' · 구간 정보가 없는 번들입니다 — PC에서 npm run prep을 다시 실행해 주세요' : ''),
      )
      await reload()
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // 문서 등장 순서대로 정렬한 뒤 카테고리로 묶는다 (옛 번들은 order가 없어 저장 순서 유지)
  const ordered = [...scripts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const categories = [...new Map(ordered.map((s) => [s.categoryKey, s.categoryTitle])).entries()]

  return (
    <div className="screen">
      <header className="home-header">
        <h1>OPIc 트레이너</h1>
        <label className="btn btn-outline">
          {importing ? '가져오는 중…' : '자료 가져오기'}
          <input
            ref={fileRef}
            type="file"
            accept=".opicpack,.zip,application/zip"
            hidden
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
      </header>

      {message && <p className="notice">{message}</p>}

      {dueCount > 0 && (
        <button className="due-banner" onClick={onStartReview}>
          오늘 복습할 문장 <strong>{dueCount}개</strong> — 시작하기 →
        </button>
      )}

      {scripts.length === 0 && !message && (
        <div className="empty">
          <p>아직 자료가 없습니다.</p>
          <p className="dim">
            PC에서 <code>npm run prep</code> 으로 만든 .opicpack 파일을 폰으로 보낸 뒤,
            위의 [자료 가져오기]로 불러오세요.
          </p>
        </div>
      )}

      {/* 학원 정리표처럼: 카테고리 카드 안에 변형을 칩으로 배열해 한눈에 고른다 */}
      <div className="cat-grid">
        {categories.map(([key, title]) => (
          <section className="cat-card" key={key}>
            <h2>{title}</h2>
            <div className="chip-list">
              {ordered
                .filter((s) => s.categoryKey === key)
                .map((s) => (
                  <button
                    key={s.id}
                    className={`chip ${s.audio ? '' : 'no-audio'}`}
                    onClick={() => onOpenScript(s.id)}
                  >
                    {s.labelKo || s.labelEn}
                    {s.audio && <span className="chip-dot" aria-label="녹음 있음" />}
                  </button>
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
