import { useEffect, useRef, useState } from 'react'
import { getDB } from '../db/db'
import { applyEdits } from '../db/edits'
import { recordPractice } from '../db/practice'
import { useMyVoice } from '../recorder/useMyVoice'
import { fmtElapsed, useRecorder } from '../recorder/useRecorder'
import type { MockSection, StoredScript } from '../types'

interface Props {
  onBack: () => void
  onOpenScript: (id: string) => void
}

/** 질문 유형. 어떤 스크립트를 연결할지 결정한다 */
type QType = 'description' | 'experience' | 'comparison' | 'person' | 'roleplay'

const TYPE_LABEL: Record<QType, string> = {
  description: '묘사·습관',
  experience: '경험',
  comparison: '비교·변화',
  person: '인물',
  roleplay: '상황극',
}

/**
 * 도입부(외우지 않는 부분)는 세 문장을 조합해 만든다:
 * ① 질문 유형에 맞는 리액션 → ② 이어주는 문장 → ③ 첫 연결 스크립트로 넘어가는 예고.
 * 그래야 도입이 질문과 어울리고, 뒤의 스크립트 연결도 자연스럽다.
 */
const REACTIONS: Record<QType, string[]> = {
  description: [
    'Oh, (주제)? Wow, that’s a good question…',
    'Ah yeah, (주제)! Actually I have a lot to say about this.',
    'Hmm, (주제)… okay, sure, let me tell you about it.',
  ],
  experience: [
    'Oh wow, that really takes me back…',
    'Hmm, let me think… when was that…',
    'Oh yeah! Actually, something does come to mind.',
  ],
  comparison: [
    'Oh, that’s an interesting question, actually…',
    'Hmm, comparing now and then… let me see.',
    'Wow, yeah… things have really changed a lot.',
  ],
  person: [
    'Oh, there’s definitely one person that comes to mind…',
    'Hmm, a person… okay, yeah, I know exactly who to talk about.',
  ],
  roleplay: ['Hi, hello?'],
}

const FILLERS = [
  'Honestly, I wasn’t expecting this question, but it’s actually something I really enjoy talking about.',
  'You know, this is something pretty close to my everyday life.',
  'Actually, I could talk about this for hours, but let me keep it simple.',
  'It’s funny you ask, because I was just thinking about this the other day.',
]

/** 첫 연결 스크립트의 카테고리로 자연스럽게 넘어가는 예고 문장 */
const LEADINS: Record<string, string[]> = {
  who: [
    'And I guess the first thing I should tell you is who I usually enjoy it with.',
    'So, let me start with the people I do it with.',
  ],
  'when how often': [
    'Let me start with when I usually get to enjoy it.',
    'First of all, about how often I do it…',
  ],
  why: [
    'And there’s a clear reason why I love it so much.',
    'Let me tell you why I’m so into it first.',
  ],
  where: [
    'And there’s a specific place that comes to mind.',
    'So first, let me tell you about where I usually go.',
  ],
  'what kind': [
    'And when it comes to what kind, well, let me explain.',
    'First, let me tell you about my taste.',
  ],
  장소묘사: [
    'Let me describe the place for you first.',
    'So, picture this place with me…',
  ],
  최근경험: ['Actually, the most recent time was not that long ago.'],
  특별경험: ['There’s one time I will never forget, actually.'],
  과거비교: ['Now that I think about it, it used to be so different back then.'],
  계기변화: ['It all started a while ago, actually.'],
  인물묘사: ['Let me tell you about them.'],
  시간순묘사: ['Let me walk you through it from the beginning.'],
}
const LEADIN_DEFAULT = ['So… let me just walk you through it.']

/** 스크립트 사이 전환 멘트 예시 */
const BRIDGES = [
  'Well, speaking of that,',
  'And you know what,',
  'Actually, now that I think about it,',
  'Oh, and also…',
  'But the thing is,',
  'Anyways, as I was saying,',
  'And to be honest,',
]

/** 마무리 멘트 예시 */
const OUTROS = [
  'So yeah… that’s pretty much it!',
  'So, that’s why I enjoy (주제) so much.',
  'Yeah… so that’s all I can think of right now!',
  'So anyways, that’s my story about (주제).',
]

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

/** 문항 텍스트에서 유형을 추정한다 */
function classify(q: string): QType {
  const t = q.toLowerCase()
  if (/call |ask .{0,20}questions|explain the situation|act it out|ask him|ask her|tell the/.test(t))
    return 'roleplay'
  if (
    /last time|recently|memorable|unforgettable|experience|what happened|think back|childhood|first time|have you ever/.test(
      t,
    )
  )
    return 'experience'
  if (/compare|changed|change[sd]? in|different from|over the years|in the past|used to/.test(t))
    return 'comparison'
  if (/person you|people you know|someone you|favorite musician|healthy person|neighbors/.test(t))
    return 'person'
  return 'description'
}

interface PlanItem {
  bridge: string
  script: StoredScript
}

interface Plan {
  type: QType
  intro: string
  items: PlanItem[]
  outro: string
  note?: string
}

interface Question {
  secName: string
  testNo: number
  qIdx: number
  text: string
  audio: string | null
}

/**
 * 스크립트 연결 연습: 모의고사 문항을 듣고, 즉흥 도입 → 외운 스크립트 연결 →
 * 마무리의 플랜을 여러 조합으로 시뮬레이션하며 말하는 연습을 한다.
 */
export function ConnectScreen({ onBack, onOpenScript }: Props) {
  const [scripts, setScripts] = useState<StoredScript[]>([])
  const [pool, setPool] = useState<Question[]>([])
  const [q, setQ] = useState<Question | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [done, setDone] = useState(0)
  const [playing, setPlaying] = useState<string | null>(null)
  const lastQRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const recorder = useRecorder()
  const myVoice = useMyVoice(() => stopAudio())

  const stopAudio = () => {
    audioRef.current?.pause()
    audioRef.current = null
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    setPlaying(null)
  }

  useEffect(() => {
    void (async () => {
      const db = await getDB()
      const all = await Promise.all((await db.getAll('scripts')).map(applyEdits))
      const ordered = all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      setScripts(ordered)

      const raw = await db.get('meta', 'mockExam')
      const mock = raw ? (JSON.parse(raw.value) as MockSection[]) : []
      const qs: Question[] = []
      for (const sec of mock) {
        for (const t of sec.tests) {
          // 1번(자기소개)은 연결 연습 대상이 아니다
          for (let i = 1; i < t.questions.length; i++) {
            qs.push({
              secName: sec.name,
              testNo: t.no,
              qIdx: i,
              text: t.questions[i],
              audio: t.audio?.[i] ?? null,
            })
          }
        }
      }
      setPool(qs)
      if (qs.length > 0) {
        const first = qs[Math.floor(Math.random() * qs.length)]
        setQ(first)
        setPlan(makePlan(first.text, ordered))
      }
    })()
    return stopAudio
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 카테고리 키로 스크립트 찾기 (여러 변형 중 랜덤) */
  const randomOf = (all: StoredScript[], key: string, exclude?: Set<string>): StoredScript | null => {
    const own = all.filter(
      (s) =>
        s.categoryKey === key &&
        !(exclude?.has(s.id) ?? false) &&
        // tip·예시류는 연결 플랜의 주역이 아니다
        !/tip|예시/.test(s.labelKo),
    )
    return own.length > 0 ? pick(own) : null
  }

  function makePlan(text: string, all: StoredScript[]): Plan {
    const type = classify(text)
    const items: PlanItem[] = []
    const used = new Set<string>()
    const add = (s: StoredScript | null) => {
      if (!s || used.has(s.id)) return
      used.add(s.id)
      items.push({ bridge: pick(BRIDGES), script: s })
    }

    if (type === 'description') {
      // 육하원칙에서 2~3개를 섞어 뽑는다. 장소 질문이면 장소묘사를 우선 넣는다
      if (/place|where /i.test(text)) add(randomOf(all, '장소묘사'))
      const pool = ['who', 'when how often', 'why', 'where', 'what kind'].sort(
        () => Math.random() - 0.5,
      )
      for (const key of pool) {
        if (items.length >= 3) break
        add(randomOf(all, key, used))
      }
    } else if (type === 'experience') {
      add(randomOf(all, pick(['최근경험', '특별경험'])))
      // 경험 뒤에 육하원칙 하나를 붙여 살을 찌우는 패턴
      add(randomOf(all, pick(['who', 'why', 'where']), used))
    } else if (type === 'comparison') {
      add(randomOf(all, '과거비교'))
      add(randomOf(all, '계기변화', used))
    } else if (type === 'person') {
      add(randomOf(all, '인물묘사'))
      add(randomOf(all, 'why', used))
    }

    let note: string | undefined
    if (type === 'roleplay') {
      note =
        '상황극 유형입니다. 스크립트 연결보다는 [인사 → 용건 → 질문 3~4개 → 마무리 인사] 구조로 즉흥 연습하세요.'
    } else if (items.length === 0) {
      note = '이 유형에 연결할 스크립트가 아직 없습니다. 도입과 마무리 위주로 연습하세요.'
    }

    // 도입 = 리액션 + 이어주는 문장 + 첫 스크립트 예고 (2~3문장)
    const parts = [pick(REACTIONS[type])]
    if (type !== 'roleplay') parts.push(pick(FILLERS))
    const firstCat = items[0]?.script.categoryKey
    if (firstCat) parts.push(pick(LEADINS[firstCat] ?? LEADIN_DEFAULT))
    const intro = parts.join(' ')

    return { type, intro, items, outro: pick(OUTROS), note }
  }

  const playBlobKeyed = async (key: string, getBlob: () => Promise<Blob | null>) => {
    if (playing === key) {
      stopAudio()
      return
    }
    const blob = await getBlob()
    if (!blob) return
    stopAudio()
    myVoice.stop()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.onended = () => setPlaying(null)
    audioRef.current = audio
    urlRef.current = url
    setPlaying(key)
    void audio.play()
  }

  const playQuestion = () => {
    if (!q) return
    void playBlobKeyed('question', async () => {
      if (!q.audio) return null
      const db = await getDB()
      return (await db.get('audio', q.audio))?.blob ?? null
    })
  }

  const playScript = (s: StoredScript) => {
    void playBlobKeyed(`script-${s.id}`, async () => {
      const db = await getDB()
      return (await db.get('audio', s.id))?.blob ?? null
    })
  }

  const reroll = () => {
    if (!q) return
    stopAudio()
    setExpanded(null)
    setPlan(makePlan(q.text, scripts))
  }

  const nextQuestion = () => {
    if (pool.length === 0) return
    stopAudio()
    myVoice.stop()
    if (recorder.state.recording) recorder.stop()
    setExpanded(null)
    for (let i = 0; i < 20; i++) {
      const cand = pool[Math.floor(Math.random() * pool.length)]
      const key = `${cand.secName}-${cand.testNo}-${cand.qIdx}`
      if (key === lastQRef.current && i < 19) continue
      lastQRef.current = key
      setQ(cand)
      setPlan(makePlan(cand.text, scripts))
      return
    }
  }

  const recKey = q ? `connect-${q.secName}-t${q.testNo}-q${q.qIdx}` : ''

  const complete = async () => {
    if (recorder.state.recording) recorder.stop()
    // 연결에 쓴 스크립트들이 이번 연습의 실체이므로 각각 기록한다
    for (const item of plan?.items ?? []) {
      await recordPractice(item.script.id)
    }
    setDone((d) => d + 1)
    nextQuestion()
  }

  if (!q) {
    return (
      <div className="screen">
        <header className="bar">
          <button className="btn-icon" onClick={onBack} aria-label="뒤로">←</button>
          <div className="bar-title"><strong>스크립트 연결 연습</strong></div>
        </header>
        <p className="dim">모의고사 자료를 먼저 가져와야 연습할 수 있습니다.</p>
      </div>
    )
  }

  return (
    <div className="screen">
      <header className="bar">
        <button className="btn-icon" onClick={onBack} aria-label="뒤로">←</button>
        <div className="bar-title">
          <strong>스크립트 연결 연습</strong>
          <span className="dim">이번 세션 {done}개 완료</span>
        </div>
      </header>

      <div className="connect-q">
        <div className="connect-q-head">
          <span className="type-badge">{TYPE_LABEL[plan?.type ?? 'description']}</span>
          <span className="dim">{q.secName} Test {q.testNo} · Q{q.qIdx + 1}</span>
        </div>
        <p className="exam-text">{q.text}</p>
        {q.audio && (
          <button className="btn-outline" onClick={playQuestion}>
            {playing === 'question' ? '⏹ 정지' : '🔈 질문 듣기'}
          </button>
        )}
      </div>

      {plan?.note && <p className="notice">{plan.note}</p>}

      {plan && plan.type !== 'roleplay' && (
        <div className="connect-plan">
          <div className="plan-step plan-free">
            <span className="plan-role">도입 (즉흥)</span>
            <p className="plan-phrase">“{plan.intro}”</p>
            <p className="dim plan-hint">
              리액션 → 이어주기 → 첫 스크립트 예고 순서 — 그대로 읽지 말고 느낌만 살려 매번 다르게
            </p>
          </div>

          {plan.items.map((item, i) => (
            <div className="plan-step" key={item.script.id}>
              <p className="plan-bridge">🔗 “{item.bridge}”</p>
              <div className="plan-script">
                <span className="plan-role">연결 {i + 1}</span>
                <button className="plan-name" onClick={() => setExpanded(expanded === item.script.id ? null : item.script.id)}>
                  {item.script.categoryTitle} · {item.script.labelKo || item.script.labelEn}
                  <span className="dim"> {expanded === item.script.id ? '▲' : '▼'}</span>
                </button>
                <span className="plan-actions">
                  {item.script.audio && (
                    <button className="btn-icon" onClick={() => playScript(item.script)}>
                      {playing === `script-${item.script.id}` ? '⏹' : '▶'}
                    </button>
                  )}
                  <button className="btn-icon" onClick={() => onOpenScript(item.script.id)} aria-label="스크립트 열기">
                    ↗
                  </button>
                </span>
              </div>
              {expanded === item.script.id && (
                <div className="plan-preview">
                  {item.script.sentences.slice(0, 3).map((s) => (
                    <p key={s.sentenceId} className="en dim">{s.en}</p>
                  ))}
                  {item.script.sentences.length > 3 && <p className="dim">… (↗ 로 전체 보기)</p>}
                </div>
              )}
            </div>
          ))}

          <div className="plan-step plan-free">
            <span className="plan-role">마무리 (즉흥)</span>
            <p className="plan-phrase">“{plan.outro}”</p>
          </div>
        </div>
      )}

      <div className="speak-actions">
        <button className="btn-outline" onClick={reroll}>🎲 다른 연결 조합</button>
        <button className="btn-outline" onClick={nextQuestion}>⏭ 다음 질문</button>
      </div>

      <div className="speak-actions">
        <button
          className={`btn ${recorder.state.recording ? 'rec-live' : ''}`}
          onClick={() =>
            recorder.state.recording ? recorder.stop() : (stopAudio(), void recorder.start(recKey))
          }
        >
          {recorder.state.recording
            ? `⏹ 녹음 끝내기 · ${fmtElapsed(recorder.state.elapsed)}`
            : '🎙 플랜대로 말해보기'}
        </button>
        {myVoice.state.key === recKey && myVoice.state.paused ? (
          <>
            <button className="btn-outline" onClick={myVoice.resume}>▶ 이어</button>
            <button className="btn-outline" onClick={myVoice.restart}>⏮ 처음</button>
          </>
        ) : (
          <button className="btn-outline" onClick={() => myVoice.toggle(recKey)}>
            {myVoice.state.key === recKey ? '⏸' : '👤 내 녹음'}
          </button>
        )}
      </div>
      {recorder.state.error && <p className="notice">{recorder.state.error}</p>}

      <div className="speak-next">
        <button className="btn" onClick={() => void complete()}>
          ✓ 연습 완료 — 연결한 스크립트 기록 +1
        </button>
      </div>
    </div>
  )
}
