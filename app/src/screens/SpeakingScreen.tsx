import { useEffect, useMemo, useRef, useState } from 'react'
import { getDB } from '../db/db'
import { applyEdits } from '../db/edits'
import { recordPractice } from '../db/practice'
import { fmtElapsed, latestRecording, useRecorder } from '../recorder/useRecorder'
import { substitute, TOPIC_PRESETS, type Topic } from '../topic'
import type { StoredScript } from '../types'

interface Prompt {
  script: StoredScript
  topic: Topic
}

/** 직전 문제와 같은 스크립트가 연달아 나오지 않게 뽑는다 */
function draw(scripts: StoredScript[], prevScriptId?: string): Prompt {
  const pool = scripts.length > 1 ? scripts.filter((s) => s.id !== prevScriptId) : scripts
  const script = pool[Math.floor(Math.random() * pool.length)]
  const topic = TOPIC_PRESETS[Math.floor(Math.random() * TOPIC_PRESETS.length)]
  return { script, topic }
}

/**
 * 랜덤 스피킹 연습: 카테고리+주제가 OPIc 질문처럼 랜덤으로 나오면
 * 먼저 소리 내어 말해 보고, 그다음에 스크립트·선생님 음성으로 확인한다.
 */
export function SpeakingScreen() {
  const [scripts, setScripts] = useState<StoredScript[]>([])
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [done, setDone] = useState(0)
  const recorder = useRecorder()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    void (async () => {
      const db = await getDB()
      const all = await Promise.all((await db.getAll('scripts')).map(applyEdits))
      setScripts(all)
      if (all.length > 0) setPrompt(draw(all))
    })()
    return () => {
      audioRef.current?.pause()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  /** 녹음 키: 스크립트 단위 연습이므로 문장이 아니라 스크립트 id로 저장 */
  const recKey = prompt ? `speaking-${prompt.script.id}` : ''

  const stopAudio = () => {
    audioRef.current?.pause()
    audioRef.current = null
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }

  const playBlob = (blob: Blob) => {
    stopAudio()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audioRef.current = audio
    urlRef.current = url
    void audio.play()
  }

  const playTeacher = async () => {
    if (!prompt) return
    const db = await getDB()
    const audio = await db.get('audio', prompt.script.id)
    if (audio) playBlob(audio.blob)
  }

  const playMine = async () => {
    const blob = await latestRecording(recKey)
    if (blob) playBlob(blob)
  }

  const next = async (counted: boolean) => {
    if (!prompt) return
    stopAudio()
    if (recorder.state.recording) recorder.stop()
    if (counted) {
      await recordPractice(prompt.script.id)
      setDone((d) => d + 1)
    }
    setRevealed(false)
    setPrompt(draw(scripts, prompt.script.id))
  }

  const question = useMemo(() => {
    if (!prompt) return ''
    // "조깅 — Who · 혼자서" 같은 문제 제시
    return `${prompt.topic.name} — ${prompt.script.categoryTitle} · ${prompt.script.labelKo || prompt.script.labelEn}`
  }, [prompt])

  if (!prompt) {
    return (
      <div className="screen">
        <header className="home-header">
          <h1>랜덤 스피킹</h1>
        </header>
        <p className="dim">먼저 [스크립트] 탭에서 자료를 가져와야 연습할 수 있습니다.</p>
      </div>
    )
  }

  return (
    <div className="screen">
      <header className="home-header">
        <h1>랜덤 스피킹</h1>
        <span className="dim">이번 세션 {done}개 완료</span>
      </header>

      <div className="speak-question">
        <span className="speak-topic">{prompt.topic.name}</span>
        <span className="speak-detail">
          {prompt.script.categoryTitle} · {prompt.script.labelKo || prompt.script.labelEn}
        </span>
        <p className="dim speak-hint">
          이 조합으로 지금 바로 소리 내어 말해보세요. 주제어: <em>{prompt.topic.en}</em>
        </p>
      </div>

      <div className="speak-actions">
        <button
          className={`btn ${recorder.state.recording ? 'rec-live' : ''}`}
          onClick={() =>
            recorder.state.recording ? recorder.stop() : void recorder.start(recKey)
          }
        >
          {recorder.state.recording
            ? `⏹ 녹음 끝내기 · ${fmtElapsed(recorder.state.elapsed)}`
            : '🎙 말하면서 녹음'}
        </button>
        <button className="btn-outline" onClick={() => void playMine()}>👤 내 녹음</button>
      </div>
      {recorder.state.error && <p className="notice">{recorder.state.error}</p>}

      {!revealed ? (
        <button className="btn-outline speak-reveal" onClick={() => setRevealed(true)}>
          스크립트 확인하기
        </button>
      ) : (
        <div className="speak-script">
          {prompt.script.audio && (
            <button className="btn-outline" onClick={() => void playTeacher()}>
              🔊 선생님 전체 듣기
            </button>
          )}
          {prompt.script.sentences.map((s) => (
            <div className="sentence" key={s.sentenceId}>
              {s.ko && <p className="ko">{substitute(s.ko, prompt.topic)}</p>}
              <p className="en">{substitute(s.en, prompt.topic)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="speak-next">
        <button className="btn" onClick={() => void next(true)}>✓ 완료하고 다음</button>
        <button className="btn-outline" onClick={() => void next(false)}>건너뛰기</button>
      </div>
    </div>
  )
}
