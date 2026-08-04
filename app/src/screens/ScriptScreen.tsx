import { useEffect, useMemo, useState } from 'react'
import { getDB } from '../db/db'
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

  useEffect(() => {
    void (async () => {
      const db = await getDB()
      const s = await db.get('scripts', scriptId)
      setScript(s ?? null)
      const audio = await db.get('audio', scriptId)
      setAudioBlob(audio?.blob ?? null)
    })()
  }, [scriptId])

  const segments = useMemo(
    () => script?.sentences.map((s) => ({ order: s.order, start: s.start, end: s.end })) ?? [],
    [script],
  )
  const player = usePlayer(audioBlob, segments)
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

  const renderSentence = (s: StoredSentence) => {
    const isPlaying = player.state.playing === s.order
    const hidden =
      hide !== 'none' && !revealed.has(s.sentenceId)
        ? hide
        : 'none'
    return (
      <li key={s.sentenceId} className={`sentence ${isPlaying ? 'active' : ''}`}>
        <div className="sentence-text" onClick={() => hide !== 'none' && toggleReveal(s.sentenceId)}>
          {s.ko && (
            <p className={`ko ${hidden === 'ko' ? 'blurred' : ''}`}>{renderText(s.ko)}</p>
          )}
          <p className={`en ${hidden === 'en' ? 'blurred' : ''}`}>
            {renderText(s.en)}
            {s.needsReview && <span className="review-flag" title="구간 확인 필요"> ⚠</span>}
          </p>
        </div>
        <div className="sentence-actions">
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
