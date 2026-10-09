import { useMemo, useState } from 'react'
import { CATEGORY_LABEL, checkIntro, reviewStructure, type Issue } from './check'

interface Props {
  /** 앱이 제안하는 도입 — 제출하거나 건너뛰기 전에는 가린다 */
  model: string
  /** 문항이 바뀌면 바뀌는 값. 바뀌면 입력을 비운다 */
  resetKey: string
}

/** 오류 구간에 표시를 입혀 보여준다 */
function Marked({ text, issues }: { text: string; issues: Issue[] }) {
  const parts: React.ReactNode[] = []
  let cursor = 0
  issues.forEach((i, n) => {
    if (i.start > cursor) parts.push(text.slice(cursor, i.start))
    parts.push(
      <mark className={`iss iss-${i.category}`} key={n}>
        {text.slice(i.start, i.end)}
      </mark>,
    )
    cursor = i.end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <p className="drill-marked">{parts}</p>
}

/**
 * 서론 영작 훈련.
 *
 * 앱이 만들어 준 도입을 읽기만 하면 정작 시험에서 만들어야 하는 구간이 연습되지 않는다.
 * 그래서 먼저 가린 채로 직접 쓰게 하고, 제출한 뒤에 상습 오류 체크와 모범 도입을 함께 보여준다.
 */
export function IntroDrill({ model, resetKey }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [lastKey, setLastKey] = useState(resetKey)

  // 문항이 바뀌면 입력과 결과를 초기화한다
  if (lastKey !== resetKey) {
    setLastKey(resetKey)
    setDraft('')
    setSubmitted(false)
    setOpen(false)
  }

  const issues = useMemo(() => (submitted ? checkIntro(draft) : []), [submitted, draft])
  const notes = useMemo(() => (submitted ? reviewStructure(draft) : []), [submitted, draft])

  if (!open) {
    return (
      <button className="btn-outline drill-open" onClick={() => setOpen(true)}>
        ✍️ 서론 직접 써보기
      </button>
    )
  }

  if (!submitted) {
    return (
      <div className="drill">
        <p className="dim drill-hint">
          질문에 즉답 한 줄 + 살 붙이기 2문장 + 패턴으로 넘어갈 연결고리. 모범 도입은 제출하면 보여드립니다.
        </p>
        <textarea
          className="drill-input"
          rows={4}
          value={draft}
          placeholder="Household chores? Uh… well, I do a lot of things at home…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="speak-actions">
          <button className="btn" disabled={draft.trim().length < 5} onClick={() => setSubmitted(true)}>
            제출하고 확인
          </button>
          <button className="btn-outline" onClick={() => setOpen(false)}>
            접기
          </button>
        </div>
      </div>
    )
  }

  const byCategory = new Map<string, Issue[]>()
  for (const i of issues) {
    const list = byCategory.get(i.category) ?? []
    list.push(i)
    byCategory.set(i.category, list)
  }

  return (
    <div className="drill">
      <Marked text={draft} issues={issues} />

      {issues.length === 0 ? (
        <p className="drill-clean">✓ 상습 오류 5종(관사·전치사·수일치·동사형·가산명사) 없음</p>
      ) : (
        <ul className="drill-issues">
          {issues.map((i, n) => (
            <li key={n}>
              <span className={`iss-tag iss-${i.category}`}>{CATEGORY_LABEL[i.category]}</span>
              <code>{i.text}</code>
              {i.fix && <> → <strong>{i.fix}</strong></>}
              <span className="dim"> · {i.message}</span>
            </li>
          ))}
        </ul>
      )}

      <ul className="drill-notes">
        {notes.map((n, i) => (
          <li key={i} className={n.ok ? 'ok' : 'ng'}>
            {n.ok ? '✓' : '△'} {n.text}
          </li>
        ))}
      </ul>

      <div className="drill-model">
        <span className="plan-role">앱이 제안하는 도입</span>
        <p className="plan-phrase">“{model}”</p>
      </div>

      <div className="speak-actions">
        <button
          className="btn-outline"
          onClick={() => {
            setSubmitted(false)
          }}
        >
          ✍️ 고쳐 쓰기
        </button>
        <button
          className="btn-outline"
          onClick={() => {
            setDraft('')
            setSubmitted(false)
          }}
        >
          처음부터
        </button>
      </div>
    </div>
  )
}
