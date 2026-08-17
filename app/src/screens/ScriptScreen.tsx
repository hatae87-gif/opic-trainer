import { useEffect, useMemo, useState } from 'react'
import { getDB } from '../db/db'
import { applyEdits, clearEdit, editedIds, saveEdit } from '../db/edits'
import { recordPractice } from '../db/practice'
import { usePlayer, type Speed } from '../player/usePlayer'
import { latestRecording, useRecorder } from '../recorder/useRecorder'
import { substitute, tokenize, TOPIC_PRESETS, type Topic } from '../topic'
import type { StoredScript, StoredSentence } from '../types'

const SPEEDS: Speed[] = [0.6, 0.8, 1, 1.2]

interface Props {
  scriptId: string
  onBack: () => void
}

type HideMode = 'none' | 'en' | 'ko'

export function ScriptScreen({ scriptId, onBack }: Props) {
  const [script, setScript] = useState<StoredScript | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [topic, setTopic] = useState<Topic | null>(null)
  const [hide, setHide] = useState<HideMode>('none')
  /** 가리기 모드에서 개별적으로 열어본 문장들 */
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  /** 지금 편집 중인 문장 id와 입력값 */
  const [editing, setEditing] = useState<{ id: string; ko: string; en: string } | null>(null)
  const [edited, setEdited] = useState<Set<string>>(new Set())

  const reload = async () => {
    const db = await getDB()
    const s = await db.get('scripts', scriptId)
    setScript(s ? await applyEdits(s) : null)
    setEdited(await editedIds())
    const audio = await db.get('audio', scriptId)
    setAudioBlob(audio?.blob ?? null)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptId])

  const segments = useMemo(
    () => script?.sentences.map((s) => ({ order: s.order, start: s.start, end: s.end })) ?? [],
    [script],
  )
  // 전체 재생을 끝까지 들으면 연습 1회로 기록한다
  const player = usePlayer(audioBlob, segments, () => void recordPractice(scriptId))
  const recorder = useRecorder()
  const [myVoiceUrl, setMyVoiceUrl] = useState<string | null>(null)

  useEffect(() => () => {
    if (myVoiceUrl) URL.revokeObjectURL(myVoiceUrl)
  }, [myVoiceUrl])

  if (!script) return <div className="screen"><p>불러오는 중…</p></div>

  const playMine = async (sentenceKey: string) => {
    const blob = await latestRecording(sentenceKey)
    if (!blob) return
    player.stop()
    if (myVoiceUrl) URL.revokeObjectURL(myVoiceUrl)
    const url = URL.createObjectURL(blob)
    setMyVoiceUrl(url)
    void new Audio(url).play()
  }

  const toggleReveal = (id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const renderText = (text: string) => {
    const substituted = substitute(text, topic)
    return tokenize(substituted).map((t, i) =>
      t.isPlaceholder ? <mark key={i}>{t.text}</mark> : <span key={i}>{t.text}</span>,
    )
  }

  const startEdit = (s: StoredSentence) => {
    player.stop()
    setEditing({ id: s.sentenceId, ko: s.ko, en: s.en })
  }

  const submitEdit = async () => {
    if (!editing) return
    await saveEdit(editing.id, editing.ko, editing.en)
    setEditing(null)
    await reload()
  }

  const restoreOriginal = async () => {
    if (!editing) return
    await clearEdit(editing.id)
    setEditing(null)
    await reload()
  }

  const renderEditForm = (s: StoredSentence) => (
    <li key={s.sentenceId} className="sentence editing" onClick={(e) => e.stopPropagation()}>
      <label className="edit-label">한국어</label>
      <textarea
        className="edit-area"
        rows={3}
        value={editing!.ko}
        onChange={(e) => setEditing((p) => p && { ...p, ko: e.target.value })}
      />
      <label className="edit-label">영어</label>
      <textarea
        className="edit-area"
        rows={3}
        value={editing!.en}
        onChange={(e) => setEditing((p) => p && { ...p, en: e.target.value })}
      />
      <div className="edit-actions">
        <button className="btn" onClick={() => void submitEdit()}>저장</button>
        <button className="btn-outline" onClick={() => setEditing(null)}>취소</button>
        {edited.has(s.sentenceId) && (
          <button className="btn-outline restore" onClick={() => void restoreOriginal()}>
            원본 복원
          </button>
        )}
      </div>
      <p className="dim edit-hint">
        수정본은 이 폰에만 저장되며, 새 자료를 가져와도 유지됩니다.
      </p>
    </li>
  )

  const renderSentence = (s: StoredSentence) => {
    if (editing?.id === s.sentenceId) return renderEditForm(s)
    const isPlaying = player.state.playing === s.order
    const hidden =
      hide !== 'none' && !revealed.has(s.sentenceId)
        ? hide
        : 'none'
    // 카드 아무 곳이나 탭 → 그 문장 재생 (이동 중 큰 터치 영역).
    // 가리기 모드에서는 먼저 열어 보여주면서 같이 재생한다.
    const canPlay = player.hasAudio && s.start !== undefined
    const onCardTap = () => {
      if (hide !== 'none' && !revealed.has(s.sentenceId)) toggleReveal(s.sentenceId)
      if (!canPlay) return
      if (isPlaying && !player.state.loop) player.stop()
      else player.playSegment(s.order)
    }
    return (
      <li
        key={s.sentenceId}
        className={`sentence ${isPlaying ? 'active' : ''} ${canPlay ? 'tappable' : ''}`}
        onClick={onCardTap}
      >
        <div className="sentence-text">
          {s.ko && (
            <p className={`ko ${hidden === 'ko' ? 'blurred' : ''}`}>{renderText(s.ko)}</p>
          )}
          <p className={`en ${hidden === 'en' ? 'blurred' : ''}`}>
            {renderText(s.en)}
            {s.needsReview && <span className="review-flag" title="구간 확인 필요"> ⚠</span>}
          </p>
        </div>
        <div className="sentence-actions" onClick={(e) => e.stopPropagation()}>
          {player.hasAudio && s.start !== undefined && (
            <>
              <button
                className={`btn-icon ${isPlaying && !player.state.loop ? 'on' : ''}`}
                onClick={() => (isPlaying ? player.stop() : player.playSegment(s.order))}
                aria-label="재생"
              >
                {isPlaying && !player.state.loop ? '⏸' : '▶'}
              </button>
              <button
                className={`btn-icon ${isPlaying && player.state.loop ? 'on' : ''}`}
                onClick={() =>
                  isPlaying && player.state.loop
                    ? player.stop()
                    : player.playSegment(s.order, { loop: true })
                }
                aria-label="반복 재생"
              >
                🔁
              </button>
            </>
          )}
          <button
            className={`btn-icon ${recorder.state.recording === s.sentenceId ? 'rec' : ''}`}
            onClick={() =>
              recorder.state.recording === s.sentenceId
                ? recorder.stop()
                : void recorder.start(s.sentenceId)
            }
            aria-label="내 목소리 녹음"
          >
            {recorder.state.recording === s.sentenceId ? '⏹' : '🎙'}
          </button>
          <button className="btn-icon" onClick={() => void playMine(s.sentenceId)} aria-label="내 녹음 듣기">
            👤
          </button>
          <button
            className={`btn-icon ${edited.has(s.sentenceId) ? 'on' : ''}`}
            onClick={() => startEdit(s)}
            aria-label="문장 수정"
          >
            ✏️
          </button>
        </div>
      </li>
    )
  }

  return (
    <div className="screen">
      <header className="bar">
        <button className="btn-icon" onClick={onBack} aria-label="뒤로">←</button>
        <div className="bar-title">
          <strong>{script.no}) {script.labelEn}</strong>
          <span className="dim">{script.categoryTitle} · {script.labelKo}</span>
        </div>
      </header>

      {recorder.state.error && <p className="notice error">{recorder.state.error}</p>}

      <div className="controls">
        {player.hasAudio && (
          <button
            className="btn"
            onClick={() => (player.state.wholeMode ? player.stop() : player.playWhole())}
          >
            {player.state.wholeMode ? '⏹ 정지' : '▶ 전체 재생'}
          </button>
        )}
        <div className="speed-group">
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              className={`chip ${player.state.speed === sp ? 'on' : ''}`}
              onClick={() => player.setSpeed(sp)}
            >
              {sp}x
            </button>
          ))}
        </div>
      </div>

      <div className="controls">
        <div className="speed-group">
          <button className={`chip ${hide === 'none' ? 'on' : ''}`} onClick={() => { setHide('none'); setRevealed(new Set()) }}>
            전체 보기
          </button>
          <button className={`chip ${hide === 'en' ? 'on' : ''}`} onClick={() => { setHide('en'); setRevealed(new Set()) }}>
            영어 가리기
          </button>
          <button className={`chip ${hide === 'ko' ? 'on' : ''}`} onClick={() => { setHide('ko'); setRevealed(new Set()) }}>
            한국어 가리기
          </button>
        </div>
      </div>

      <div className="controls">
        <div className="speed-group">
          <button className={`chip ${topic === null ? 'on' : ''}`} onClick={() => setTopic(null)}>
            (주제) 원문
          </button>
          {TOPIC_PRESETS.map((t) => (
            <button
              key={t.name}
              className={`chip ${topic?.name === t.name ? 'on' : ''}`}
              onClick={() => setTopic(t)}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {!script.koAligned && script.ko && (
        <details className="ko-block">
          <summary>한국어 전문 (문장별 정렬 안 됨)</summary>
          <p>{renderText(script.ko)}</p>
        </details>
      )}

      <ul className="sentence-list">{script.sentences.map(renderSentence)}</ul>

      {script.vocabHints.length > 0 && (
        <section className="vocab">
          <h3>++ 어휘</h3>
          {script.vocabHints.map((v, i) => (
            <p key={i}>{v}</p>
          ))}
        </section>
      )}
    </div>
  )
}
