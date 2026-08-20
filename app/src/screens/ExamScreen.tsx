import { useEffect, useRef, useState } from 'react'
import { getDB } from '../db/db'
import { useMyVoice } from '../recorder/useMyVoice'
import { fmtElapsed, latestRecordingEntry, useRecorder } from '../recorder/useRecorder'
import type { MockSection } from '../types'

type Phase = 'pick' | 'exam' | 'done'

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

/**
 * 모의고사: 실제 OPIc처럼 문항을 음성으로만 듣고 (텍스트 기본 숨김, 다시 듣기 1회)
 * 바로 녹음하며 답한다. 끝나면 문항별로 내 답변을 되짚어 들을 수 있다.
 */
export function ExamScreen() {
  const [mock, setMock] = useState<MockSection[] | null>(null)
  const [phase, setPhase] = useState<Phase>('pick')
  const [section, setSection] = useState<MockSection | null>(null)
  const [testNo, setTestNo] = useState(0)
  const [qIndex, setQIndex] = useState(0)
  const [replaysLeft, setReplaysLeft] = useState(1)
  const [showText, setShowText] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [totalSec, setTotalSec] = useState(0)
  /** 종료 화면용: 문항별 내 답변 길이 */
  const [answerDurs, setAnswerDurs] = useState<Map<number, number>>(new Map())
  const recorder = useRecorder()
  const myVoice = useMyVoice()

  useEffect(() => {
    void (async () => {
      const db = await getDB()
      const raw = await db.get('meta', 'mockExam')
      setMock(raw ? (JSON.parse(raw.value) as MockSection[]) : null)
    })()
    return () => {
      if (canSpeak) speechSynthesis.cancel()
    }
  }, [])

  // 시험 중 총 경과 시간
  useEffect(() => {
    if (phase !== 'exam') return
    const t = setInterval(() => setTotalSec(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(t)
  }, [phase, startedAt])

  const questions = section?.tests.find((t) => t.no === testNo)?.questions ?? []
  const recKey = (i: number) => `exam-${section?.name}-t${testNo}-q${i}`

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

  const enterQuestion = (i: number) => {
    setQIndex(i)
    setReplaysLeft(1)
    setShowText(false)
    // 실전처럼: 질문이 끝나는 즉시 답변 녹음이 시작된다
    speakQuestion(questions[i], () => void recorder.start(recKey(i)))
  }

  const startTest = (sec: MockSection, no: number) => {
    myVoice.stop()
    setSection(sec)
    setTestNo(no)
    setStartedAt(Date.now())
    setTotalSec(0)
    setPhase('exam')
    // section/testNo state가 아직 안 잡혔으므로 직접 질문을 넘긴다
    const qs = sec.tests.find((t) => t.no === no)?.questions ?? []
    setQIndex(0)
    setReplaysLeft(1)
    setShowText(false)
    speakQuestion(qs[0], () => {
      void recorder.start(`exam-${sec.name}-t${no}-q0`)
    })
  }

  const replay = () => {
    if (replaysLeft <= 0 || !questions[qIndex]) return
    setReplaysLeft((r) => r - 1)
    speakQuestion(questions[qIndex])
  }

  const finishExam = async () => {
    if (recorder.state.recording) recorder.stop()
    if (canSpeak) speechSynthesis.cancel()
    // 녹음 저장(비동기)이 끝난 뒤 길이를 모은다
    setTimeout(() => {
      void (async () => {
        const durs = new Map<number, number>()
        for (let i = 0; i < questions.length; i++) {
          const e = await latestRecordingEntry(recKey(i))
          if (e?.duration) durs.set(i, e.duration)
        }
        setAnswerDurs(durs)
      })()
    }, 600)
    setPhase('done')
  }

  const nextQuestion = () => {
    if (recorder.state.recording) recorder.stop()
    if (qIndex + 1 >= questions.length) {
      void finishExam()
    } else {
      // stop() 저장이 겹치지 않게 살짝 띄우고 다음 문항으로
      setTimeout(() => enterQuestion(qIndex + 1), 300)
    }
  }

  const quit = () => {
    if (recorder.state.recording) recorder.stop()
    if (canSpeak) speechSynthesis.cancel()
    myVoice.stop()
    setPhase('pick')
    setSection(null)
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

  if (phase === 'pick') {
    return (
      <div className="screen">
        <header className="home-header"><h1>모의고사</h1></header>
        <p className="dim">
          실제 시험처럼 문항이 음성으로만 나오고, 질문이 끝나면 바로 녹음이 시작됩니다.
          다시 듣기는 문항당 1회입니다.
        </p>
        {!canSpeak && (
          <p className="notice">이 기기는 음성 출제를 지원하지 않아 질문이 글로 표시됩니다.</p>
        )}
        {mock.map((sec) => (
          <section className="cat-card exam-pick" key={sec.name}>
            <h2>{sec.name} 모의고사</h2>
            <div className="chip-list">
              {sec.tests.map((t) => (
                <button key={t.no} className="chip" onClick={() => startTest(sec, t.no)}>
                  Test {t.no}
                  <span className="dim"> · {t.questions.length}문항</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  }

  if (phase === 'exam') {
    return (
      <div className="screen">
        <header className="home-header">
          <h1>{section?.name} Test {testNo}</h1>
          <span className="dim">
            {qIndex + 1} / {questions.length} · {fmtElapsed(totalSec)}
          </span>
        </header>

        <div className="speak-question exam-q">
          <span className="speak-topic">Question {qIndex + 1}</span>
          {speaking && <span className="speak-detail">🔈 질문 재생 중…</span>}
          {!speaking && recorder.state.recording && (
            <span className="exam-rec">● 녹음 중 · {fmtElapsed(recorder.state.elapsed)}</span>
          )}
          {showText ? (
            <p className="exam-text">{questions[qIndex]}</p>
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
            {qIndex + 1 >= questions.length ? '✓ 시험 마치기' : '답변 끝, 다음 문항 →'}
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
        <h1>시험 종료</h1>
        <span className="dim">
          {section?.name} Test {testNo} · 총 {fmtElapsed(totalSec)}
        </span>
      </header>
      <p className="dim">문항을 눌러 내 답변을 다시 들어보세요.</p>
      <ul className="exam-review">
        {questions.map((q, i) => {
          const key = recKey(i)
          const active = myVoice.state.key === key
          return (
            <li key={i} className={`sentence tappable ${active ? 'active' : ''}`}
                onClick={() => myVoice.toggle(key)}>
              <p className="en">
                <strong>Q{i + 1}.</strong> {q}
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
        <button className="btn" onClick={quit}>목록으로</button>
      </div>
    </div>
  )
}
