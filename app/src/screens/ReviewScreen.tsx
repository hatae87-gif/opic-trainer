import { useEffect, useMemo, useRef, useState } from 'react'
import { getDB } from '../db/db'
import { dueSentenceIds, grade } from '../srs/srs'
import type { Grade, StoredScript, StoredSentence } from '../types'

interface Props {
  onDone: () => void
}

interface Card {
  sentence: StoredSentence
  script: StoredScript
}

/**
 * 오늘 복습할 문장을 여러 스크립트에서 모아 순서대로 출제한다.
 * 한국어 → (스스로 말해보기) → 탭하면 영어 공개 + 선생님 음성 → 자기 채점.
 */
export function ReviewScreen({ onDone }: Props) {
  const [cards, setCards] = useState<Card[] | null>(null)
  const [index, setIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    void (async () => {
      const db = await getDB()
      const scripts = await db.getAll('scripts')
      const due = new Set(await dueSentenceIds())

      const pool: Card[] = []
      for (const script of scripts) {
        for (const sentence of script.sentences) {
          if (due.has(sentence.sentenceId)) pool.push({ sentence, script })
        }
      }
      // 아직 한 번도 채점 안 한 문장이 due에 없으므로, due가 비면 새 문장을 출제한다
      if (pool.length === 0) {
        const graded = new Set(await db.getAllKeys('srs'))
        for (const script of scripts) {
          for (const sentence of script.sentences) {
            if (!graded.has(sentence.sentenceId)) pool.push({ sentence, script })
          }
        }
        pool.splice(20) // 새 문장은 한 번에 20개까지만
      }
      // 스크립트가 섞이도록 셔플
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[pool[i], pool[j]] = [pool[j], pool[i]]
      }
      setCards(pool)
    })()
  }, [])

  const current = cards?.[index] ?? null

  const stopAudio = () => {
    audioRef.current?.pause()
    audioRef.current = null
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }
  useEffect(() => stopAudio, [index])

  const playTeacher = async () => {
    if (!current) return
    const { sentence, script } = current
    if (sentence.start === undefined || sentence.end === undefined) return
    const db = await getDB()
    const audio = await db.get('audio', script.id)
    if (!audio) return
    stopAudio()
    const url = URL.createObjectURL(audio.blob)
    urlRef.current = url
    const el = new Audio(url)
    audioRef.current = el
    el.currentTime = sentence.start
    const onTime = () => {
      if (el.currentTime >= sentence.end!) {
        el.pause()
        el.removeEventListener('timeupdate', onTime)
      }
    }
    el.addEventListener('timeupdate', onTime)
    void el.play()
  }

  const reveal = () => {
    setShowAnswer(true)
    void playTeacher()
  }

  const submit = async (g: Grade) => {
    if (!current) return
    await grade(current.sentence.sentenceId, g)
    setShowAnswer(false)
    if (index + 1 < (cards?.length ?? 0)) setIndex(index + 1)
    else {
      stopAudio()
      onDone()
    }
  }

  const progress = useMemo(
    () => (cards ? `${Math.min(index + 1, cards.length)} / ${cards.length}` : ''),
    [cards, index],
  )

  if (!cards) return <div className="screen"><p>불러오는 중…</p></div>

  if (cards.length === 0) {
    return (
      <div className="screen">
        <header className="bar">
          <button className="btn-icon" onClick={onDone} aria-label="뒤로">←</button>
          <div className="bar-title"><strong>복습</strong></div>
        </header>
        <div className="empty"><p>지금 복습할 문장이 없습니다. 🎉</p></div>
      </div>
    )
  }

  return (
    <div className="screen review">
      <header className="bar">
        <button className="btn-icon" onClick={() => { stopAudio(); onDone() }} aria-label="닫기">←</button>
        <div className="bar-title">
          <strong>복습</strong>
          <span className="dim">{progress} · {current?.script.categoryTitle} {current?.script.no}) {current?.script.labelEn}</span>
        </div>
      </header>

      {current && (
        <div className="card">
          <p className="card-ko">{current.sentence.ko || '(한국어 없음 — 영어를 떠올려 보세요)'}</p>

          {!showAnswer ? (
            <button className="btn btn-big" onClick={reveal}>
              영어 확인 + 선생님 음성 ▶
            </button>
          ) : (
            <>
              <p className="card-en">{current.sentence.en}</p>
              <button className="btn btn-outline" onClick={() => void playTeacher()}>
                🔊 다시 듣기
              </button>
              <div className="grade-row">
                <button className="btn grade-again" onClick={() => void submit('again')}>
                  못했어요
                </button>
                <button className="btn grade-hard" onClick={() => void submit('hard')}>
                  애매해요
                </button>
                <button className="btn grade-good" onClick={() => void submit('good')}>
                  잘했어요
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
