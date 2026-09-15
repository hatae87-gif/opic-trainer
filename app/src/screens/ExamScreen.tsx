import { useEffect, useRef, useState } from 'react'
import { getDB } from '../db/db'
import { useMyVoice } from '../recorder/useMyVoice'
import { fmtElapsed, latestRecordingEntry, useRecorder } from '../recorder/useRecorder'
import type { MockSection, MockTest } from '../types'

type Phase = 'pick' | 'browse' | 'exam' | 'done'

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

/**
 * OPIc 콤보 구조. 1번(자기소개)만 단독이고 나머지는 주제 묶음으로 나온다.
 * 랜덤 연습은 1번을 뺀 5개 묶음에서 뽑는다.
 */
const GROUPS: number[][] = [[1], [2, 3, 4], [5, 6, 7], [8, 9, 10], [11, 12, 13], [14, 15]]
const RANDOM_POOL = GROUPS.slice(1)

const groupLabel = (g: number[]) =>
  g.length === 1 ? `${g[0]}번` : `${g[0]}~${g[g.length - 1]}번`

/** 지금 진행 중인 시험/연습 단위 */
interface Run {
  secName: string
  testNo: number
  /** 이 런에서 풀 문항의 0-기준 인덱스 목록 */
  indices: number[]
  label: string
  mode: 'full' | 'random'
}

/**
 * 모의고사: 전체 세트 응시(실전처럼 음성 출제·자동 녹음), 문제 눈으로 보기,
 * 그리고 콤보 묶음 단위 랜덤 연습.
 */
export function ExamScreen() {
  const [mock, setMock] = useState<MockSection[] | null>(null)
  const [phase, setPhase] = useState<Phase>('pick')
  const [run, setRun] = useState<Run | null>(null)
  /** run.indices 안에서의 위치 */
  const [pos, setPos] = useState(0)
  const [replaysLeft, setReplaysLeft] = useState(1)
  const [showText, setShowText] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [totalSec, setTotalSec] = useState(0)
  /** 종료 화면용: 문항 인덱스 → 내 답변 길이 */
  const [answerDurs, setAnswerDurs] = useState<Map<number, number>>(new Map())
  /** 문제 보기 대상 */
  const [browsing, setBrowsing] = useState<{ secName: string; testNo: number } | null>(null)
  /** 문제 보기에서 마지막으로 재생 누른 문항 */
  const [browsePlaying, setBrowsePlaying] = useState<number | null>(null)
  const lastRandomRef = useRef<string | null>(null)
  const recorder = useRecorder()
  const myVoice = useMyVoice()

  useEffect(() => {
    void (async () => {
      const db = await getDB()
      const raw = await db.get('meta', 'mockExam')
      setMock(raw ? (JSON.parse(raw.value) as MockSection[]) : null)
    })()
    return () => {
      stopQuestionAudio()
      if (canSpeak) speechSynthesis.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (phase !== 'exam') return
    const t = setInterval(() => setTotalSec(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(t)
  }, [phase, startedAt])

  const findTest = (secName: string, testNo: number): MockTest | undefined =>
    mock?.find((s) => s.name === secName)?.tests.find((t) => t.no === testNo)

  const currentTest = run ? findTest(run.secName, run.testNo) : undefined
  /** 지금 문항의 실제 인덱스(0-기준) */
  const qIdx = run?.indices[pos] ?? 0
  const recKey = (r: Run, i: number) => `exam-${r.secName}-t${r.testNo}-q${i}`

  // ---- 문항 출제 (실제 음성 → TTS 폴백) ----

  const qAudioRef = useRef<HTMLAudioElement | null>(null)
  const qUrlRef = useRef<string | null>(null)
  const stopQuestionAudio = () => {
    qAudioRef.current?.pause()
    qAudioRef.current = null
    if (qUrlRef.current) {
      URL.revokeObjectURL(qUrlRef.current)
      qUrlRef.current = null
    }
    setSpeaking(false)
  }

  const speakQuestion = (text: string, onEnd?: () => void) => {
    if (!canSpeak) {
      setShowText(true)
      onEnd?.()
      return
    }
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = 0.95
    u.onend = () => {
      setSpeaking(false)
      onEnd?.()
    }
    u.onerror = () => {
      setSpeaking(false)
      setShowText(true)
      onEnd?.()
    }
    setSpeaking(true)
    speechSynthesis.speak(u)
  }

  const presentQuestion = async (
    text: string,
    audioPath: string | null | undefined,
    onEnd?: () => void,
  ) => {
    stopQuestionAudio()
    if (canSpeak) speechSynthesis.cancel()
    if (audioPath) {
      const db = await getDB()
      const rec = await db.get('audio', audioPath)
      if (rec) {
        const url = URL.createObjectURL(rec.blob)
        const audio = new Audio(url)
        qAudioRef.current = audio
        qUrlRef.current = url
        audio.onended = () => {
          setSpeaking(false)
          onEnd?.()
        }
        audio.onerror = () => {
          setSpeaking(false)
          setShowText(true)
          onEnd?.()
        }
        setSpeaking(true)
        void audio.play()
        return
      }
    }
    speakQuestion(text, onEnd)
  }

  // ---- 런 진행 ----

  const enterQuestion = (r: Run, p: number) => {
    const test = findTest(r.secName, r.testNo)
    if (!test) return
    const i = r.indices[p]
    setPos(p)
    setReplaysLeft(1)
    setShowText(false)
    // 실전처럼: 질문이 끝나는 즉시 답변 녹음이 시작된다
    void presentQuestion(test.questions[i], test.audio?.[i], () => void recorder.start(recKey(r, i)))
  }

  const beginRun = (r: Run) => {
    myVoice.stop()
    setRun(r)
    setAnswerDurs(new Map())
    setStartedAt(Date.now())
    setTotalSec(0)
    setPhase('exam')
    enterQuestion(r, 0)
  }

  const startFullTest = (sec: MockSection, no: number) => {
    const test = sec.tests.find((t) => t.no === no)
    if (!test) return
    beginRun({
      secName: sec.name,
      testNo: no,
      indices: test.questions.map((_, i) => i),
      label: `${sec.name} Test ${no}`,
      mode: 'full',
    })
  }

  /** 1번을 뺀 콤보 묶음 하나를 아무 세트에서나 뽑는다 (직전 묶음 연속 방지) */
  const startRandom = () => {
    if (!mock || mock.length === 0) return
    for (let attempt = 0; attempt < 20; attempt++) {
      const sec = mock[Math.floor(Math.random() * mock.length)]
      const test = sec.tests[Math.floor(Math.random() * sec.tests.length)]
      const group = RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)]
      const indices = group.map((n) => n - 1).filter((i) => i < test.questions.length)
      if (indices.length === 0) continue
      const key = `${sec.name}-${test.no}-${group[0]}`
      if (key === lastRandomRef.current && attempt < 19) continue
      lastRandomRef.current = key
      beginRun({
        secName: sec.name,
        testNo: test.no,
        indices,
        label: `${sec.name} Test ${test.no} · ${groupLabel(group)}`,
        mode: 'random',
      })
      return
    }
  }

  const replay = () => {
    if (!run || !currentTest || replaysLeft <= 0) return
    setReplaysLeft((r) => r - 1)
    void presentQuestion(currentTest.questions[qIdx], currentTest.audio?.[qIdx])
  }

  const finishRun = () => {
    if (!run) return
    if (recorder.state.recording) recorder.stop()
    stopQuestionAudio()
    if (canSpeak) speechSynthesis.cancel()
    const r = run
    // 녹음 저장(비동기)이 끝난 뒤 길이를 모은다
    setTimeout(() => {
      void (async () => {
        const durs = new Map<number, number>()
        for (const i of r.indices) {
          const e = await latestRecordingEntry(recKey(r, i))
          if (e?.duration) durs.set(i, e.duration)
        }
        setAnswerDurs(durs)
      })()
    }, 600)
    setPhase('done')
  }

  const nextQuestion = () => {
    if (!run) return
    if (recorder.state.recording) recorder.stop()
    if (pos + 1 >= run.indices.length) {
      finishRun()
    } else {
      // stop() 저장이 겹치지 않게 살짝 띄우고 다음 문항으로
      const r = run
      const p = pos + 1
      setTimeout(() => enterQuestion(r, p), 300)
    }
  }

  const quit = () => {
    if (recorder.state.recording) recorder.stop()
    stopQuestionAudio()
    if (canSpeak) speechSynthesis.cancel()
    myVoice.stop()
    setPhase('pick')
    setRun(null)
    setBrowsing(null)
    setBrowsePlaying(null)
  }

  // ---- 화면들 ----

  if (!mock || mock.length === 0) {
    return (
      <div className="screen">
        <header className="home-header"><h1>모의고사</h1></header>
        <div className="empty">
          <p>모의고사 자료가 없습니다.</p>
          <p className="dim">
            PC에서 <code>npm run prep</code> 을 다시 실행해 새 번들을 만들고,
            [스크립트] 탭에서 가져오기 하면 모의고사가 들어옵니다.
          </p>
        </div>
      </div>
    )
  }

  if (phase === 'browse' && browsing) {
    const test = findTest(browsing.secName, browsing.testNo)
    return (
      <div className="screen">
        <header className="bar">
          <button className="btn-icon" onClick={quit} aria-label="뒤로">←</button>
          <div className="bar-title">
            <strong>{browsing.secName} Test {browsing.testNo} 문제 보기</strong>
            <span className="dim">▶ 로 문항 음성을 들을 수 있습니다</span>
          </div>
        </header>
        {GROUPS.map((g) => {
          const indices = g.map((n) => n - 1).filter((i) => i < (test?.questions.length ?? 0))
          if (indices.length === 0) return null
          return (
            <section key={g[0]} className="browse-group">
              <h2>{groupLabel(g)}</h2>
              {indices.map((i) => (
                <div key={i} className="sentence browse-q">
                  <button
                    className={`btn-icon ${browsePlaying === i && speaking ? 'on' : ''}`}
                    aria-label="문항 듣기"
                    onClick={() => {
                      if (browsePlaying === i && speaking) {
                        stopQuestionAudio()
                        if (canSpeak) speechSynthesis.cancel()
                      } else {
                        setBrowsePlaying(i)
                        void presentQuestion(test!.questions[i], test?.audio?.[i])
                      }
                    }}
                  >
                    {browsePlaying === i && speaking ? '⏹' : '▶'}
                  </button>
                  <p className="en">
                    <strong>Q{i + 1}.</strong> {test?.questions[i]}
                  </p>
                </div>
              ))}
            </section>
          )
        })}
      </div>
    )
  }

  if (phase === 'pick') {
    return (
      <div className="screen">
        <header className="home-header"><h1>모의고사</h1></header>

        <button className="speak-banner" onClick={startRandom}>
          🎲 랜덤 묶음 연습 — 아무 세트에서나 콤보(2~4·5~7·8~10·11~13·14~15) 하나 뽑기
        </button>

        <p className="dim exam-guide">
          세트를 누르면 실전처럼 15문항 전체를 응시합니다. 👁 는 문제를 눈으로 봅니다.
        </p>
        {mock.map((sec) => (
          <section className="cat-card exam-pick" key={sec.name}>
            <h2>{sec.name} 모의고사</h2>
            <div className="chip-list">
              {sec.tests.map((t) => (
                <span key={t.no} className="chip-pair">
                  <button className="chip" onClick={() => startFullTest(sec, t.no)}>
                    Test {t.no}
                  </button>
                  <button
                    className="chip chip-eye"
                    aria-label="문제 보기"
                    onClick={() => {
                      setBrowsing({ secName: sec.name, testNo: t.no })
                      setBrowsePlaying(null)
                      setPhase('browse')
                    }}
                  >
                    👁
                  </button>
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  }

  if (phase === 'exam' && run) {
    return (
      <div className="screen">
        <header className="home-header">
          <h1>{run.label}</h1>
          <span className="dim">
            {pos + 1} / {run.indices.length} · {fmtElapsed(totalSec)}
          </span>
        </header>

        <div className="speak-question exam-q">
          <span className="speak-topic">Question {qIdx + 1}</span>
          {speaking && <span className="speak-detail">🔈 질문 재생 중…</span>}
          {!speaking && recorder.state.recording && (
            <span className="exam-rec">● 녹음 중 · {fmtElapsed(recorder.state.elapsed)}</span>
          )}
          {showText ? (
            <p className="exam-text">{currentTest?.questions[qIdx]}</p>
          ) : (
            <p className="dim speak-hint">질문은 음성으로만 나옵니다 (실전 방식)</p>
          )}
        </div>

        <div className="speak-actions">
          <button className="btn-outline" onClick={replay} disabled={replaysLeft <= 0 || speaking}>
            🔈 다시 듣기 ({replaysLeft})
          </button>
          <button className="btn-outline" onClick={() => setShowText((v) => !v)}>
            {showText ? '질문 숨기기' : '질문 보기'}
          </button>
        </div>

        <div className="speak-next">
          <button className="btn" onClick={nextQuestion} disabled={speaking}>
            {pos + 1 >= run.indices.length ? '✓ 마치기' : '답변 끝, 다음 문항 →'}
          </button>
          <button className="btn-outline" onClick={quit}>중단</button>
        </div>
      </div>
    )
  }

  // done
  return (
    <div className="screen">
      <header className="home-header">
        <h1>{run?.mode === 'random' ? '묶음 완료' : '시험 종료'}</h1>
        <span className="dim">{run?.label} · 총 {fmtElapsed(totalSec)}</span>
      </header>
      <p className="dim">문항을 눌러 내 답변을 다시 들어보세요.</p>
      <ul className="exam-review">
        {run &&
          run.indices.map((i) => {
            const key = recKey(run, i)
            const active = myVoice.state.key === key
            return (
              <li
                key={i}
                className={`sentence tappable ${active ? 'active' : ''}`}
                onClick={() => myVoice.toggle(key)}
              >
                <p className="en">
                  <strong>Q{i + 1}.</strong> {currentTest?.questions[i]}
                </p>
                <p className="dim exam-ans">
                  {active && !myVoice.state.paused
                    ? '⏸ 재생 중 — 누르면 일시정지'
                    : answerDurs.has(i)
                      ? `👤 내 답변 · ${fmtElapsed(answerDurs.get(i)!)}`
                      : '답변 녹음 없음'}
                </p>
                {active && myVoice.state.paused && (
                  <div className="sentence-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn-icon on" onClick={myVoice.resume}>▶</button>
                    <button className="btn-icon on" onClick={myVoice.restart}>⏮</button>
                  </div>
                )}
              </li>
            )
          })}
      </ul>
      <div className="speak-next">
        {run?.mode === 'random' && (
          <button className="btn" onClick={() => { myVoice.stop(); startRandom() }}>
            🎲 다음 랜덤 묶음
          </button>
        )}
        <button className={run?.mode === 'random' ? 'btn-outline' : 'btn'} onClick={quit}>
          목록으로
        </button>
      </div>
    </div>
  )
}
