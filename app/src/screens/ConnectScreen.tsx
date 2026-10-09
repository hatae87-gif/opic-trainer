import { useEffect, useRef, useState } from 'react'
import { getDB } from '../db/db'
import { applyEdits } from '../db/edits'
import { recordPractice } from '../db/practice'
import { IntroDrill } from '../intro/IntroDrill'
import { useMyVoice } from '../recorder/useMyVoice'
import { describeStats, statsTone } from '../recorder/silence'
import { fmtElapsed, LIVE_PAUSE_WARN_SEC, useRecorder } from '../recorder/useRecorder'
import {
  guessTopic,
  INDUSTRY_CATEGORIES,
  substitute,
  TOPIC_PRESETS,
  type Topic,
} from '../topic'
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
  장소묘사: ['Let me describe the place for you first.', 'So, picture this place with me…'],
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

/**
 * 같은 패턴을 콤보 안에서 한 번 더 쓸 때의 전환 멘트.
 * 교재 규칙: ‘앞에서 말했듯이’를 붙이고, 한 줄 빼고, 단어 한두 개를 바꿔 쓴다.
 */
const REUSE_BRIDGES = [
  'And, as I told you earlier,',
  'Like I said,',
  'As I mentioned before,',
  'And you know, as I said just now,',
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
  /** 콤보 안에서 이미 쓴 패턴을 한 번 더 쓰는 경우 */
  reused: boolean
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

interface ComboStep {
  q: Question
  plan: Plan
}

interface Combo {
  secName: string
  testNo: number
  label: string
  topic: Topic
  steps: ComboStep[]
}

/** 0-기준 문항 인덱스로 본 콤보 묶음. 0번(자기소개)은 뺀다 */
const COMBO_GROUPS: number[][] = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
  [10, 11, 12],
  [13, 14],
]

/** 카테고리 키로 스크립트 찾기. 안 쓴 것 우선, 없으면 재사용 표시를 달아 돌려준다 */
function pickScript(
  all: StoredScript[],
  key: string,
  used: Set<string>,
  allowReuse: boolean,
): { script: StoredScript; reused: boolean } | null {
  const own = all.filter(
    // tip·예시류는 연결 플랜의 주역이 아니다
    (s) => s.categoryKey === key && !/tip|예시/.test(s.labelKo ?? ''),
  )
  if (own.length === 0) return null
  const fresh = own.filter((s) => !used.has(s.id))
  if (fresh.length > 0) return { script: pick(fresh), reused: false }
  if (!allowReuse) return null
  return { script: pick(own), reused: true }
}

/**
 * 한 문항의 플랜을 만든다.
 * used를 바깥에서 넘기면 콤보 전체에 걸쳐 같은 패턴이 겹치지 않는다.
 */
export function buildPlan(
  text: string,
  all: StoredScript[],
  used: Set<string>,
  allowReuse: boolean,
): Plan {
  const type = classify(text)
  const items: PlanItem[] = []
  const add = (key: string | null) => {
    if (!key) return
    const got = pickScript(all, key, used, allowReuse)
    if (!got) return
    if (items.some((i) => i.script.id === got.script.id)) return // 한 답변 안에서는 절대 중복 금지
    used.add(got.script.id)
    items.push({
      bridge: got.reused ? pick(REUSE_BRIDGES) : pick(BRIDGES),
      script: got.script,
      reused: got.reused,
    })
  }

  if (type === 'description') {
    // 육하원칙에서 2~3개를 섞어 뽑는다. 장소 질문이면 장소묘사를 우선 넣는다
    if (/place|where /i.test(text)) add('장소묘사')
    const pool = ['who', 'when how often', 'why', 'where', 'what kind'].sort(
      () => Math.random() - 0.5,
    )
    for (const key of pool) {
      if (items.length >= 3) break
      add(key)
    }
  } else if (type === 'experience') {
    // "어릴 때 / 처음" 을 묻는 문항은 최근·특별경험이 아니라 계기변화가 맞는 자리다
    const origin =
      /childhood|first time|first became|first experience|when you were (a )?(child|young|kid)|who taught you|how did you (first )?(learn|get)/i.test(
        text,
      )
    add(origin ? '계기변화' : pick(['최근경험', '특별경험']))
    // 경험 뒤에 육하원칙 하나를 붙여 살을 찌우는 패턴
    add(pick(['who', 'why', 'where', 'when how often']))
  } else if (type === 'comparison') {
    add('과거비교')
    add(pick(['계기변화', 'why', 'when how often']))
  } else if (type === 'person') {
    add('인물묘사')
    add(pick(['why', 'when how often']))
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

  return { type, intro: parts.join(' '), items, outro: pick(OUTROS), note }
}

/** 콤보 전체를 한 주제로 묶고, 패턴이 겹치지 않게 배분한다 */
export function buildCombo(qs: Question[], all: StoredScript[], forcedTopic?: Topic): Combo {
  const joined = qs.map((q) => q.text).join(' ')
  const topic = forcedTopic ?? guessTopic(joined) ?? pick(TOPIC_PRESETS)
  const used = new Set<string>()
  const steps = qs.map((q) => ({ q, plan: buildPlan(q.text, all, used, true) }))
  return {
    secName: qs[0].secName,
    testNo: qs[0].testNo,
    label: `${qs[0].qIdx + 1}~${qs[qs.length - 1].qIdx + 1}번`,
    topic,
    steps,
  }
}

type RecorderHook = ReturnType<typeof useRecorder>
type MyVoiceHook = ReturnType<typeof useMyVoice>

/**
 * 녹음 버튼 + 말하기 지표.
 * 녹음 중에는 1초마다 부모가 리렌더되므로, 이 컴포넌트와 PlanView는 반드시
 * 모듈 최상위에 있어야 한다. 함수 안에서 정의하면 매 렌더마다 새 타입이 되어
 * IntroDrill이 통째로 다시 마운트되고 입력하던 서론이 날아간다.
 */
function RecorderBar({
  recKey,
  label,
  recorder,
  myVoice,
  stopAudio,
}: {
  recKey: string
  label: string
  recorder: RecorderHook
  myVoice: MyVoiceHook
  stopAudio: () => void
}) {
  const live = recorder.state.recording === recKey
  return (
    <>
      <div className="speak-actions">
        <button
          className={`btn ${live ? 'rec-live' : ''}`}
          onClick={() => {
            if (recorder.state.recording) recorder.stop()
            else {
              stopAudio()
              void recorder.start(recKey)
            }
          }}
        >
          {live ? `⏹ 녹음 끝내기 · ${fmtElapsed(recorder.state.elapsed)}` : `🎙 ${label}`}
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
      {live && recorder.state.pausedFor >= LIVE_PAUSE_WARN_SEC && (
        <p className="pause-live">⏸ {recorder.state.pausedFor}초째 멈춤 — 소리로 채우세요</p>
      )}
      {!recorder.state.recording && recorder.state.lastStats && (
        <p className={`pause-stat tone-${statsTone(recorder.state.lastStats)}`}>
          {describeStats(recorder.state.lastStats)}
        </p>
      )}
    </>
  )
}

function PlanView({
  plan: p,
  topic,
  keyPrefix,
  expanded,
  setExpanded,
  playing,
  playScript,
  onOpenScript,
}: {
  plan: Plan
  topic: Topic | null
  keyPrefix: string
  expanded: string | null
  setExpanded: (k: string | null) => void
  playing: string | null
  playScript: (s: StoredScript) => void
  onOpenScript: (id: string) => void
}) {
  if (p.type === 'roleplay') return null
  const sub = (text: string, industry = false) => substitute(text, topic, { industry })
  return (
    <div className="connect-plan">
      <div className="plan-step plan-free">
        <span className="plan-role">도입 (즉흥)</span>
        <IntroDrill model={sub(p.intro)} resetKey={`${keyPrefix}-${p.intro}`} />
        <p className="dim plan-hint">
          리액션 → 이어주기 → 첫 스크립트 예고 순서 — 그대로 읽지 말고 느낌만 살려 매번 다르게
        </p>
      </div>

      {p.items.map((item, i) => {
        const industry = INDUSTRY_CATEGORIES.has(item.script.categoryKey)
        const openKey = `${keyPrefix}-${item.script.id}`
        return (
          <div className="plan-step" key={openKey}>
            <p className={`plan-bridge ${item.reused ? 'reused' : ''}`}>
              🔗 “{item.bridge}”
              {item.reused && <span className="reuse-tag">재사용 — 한 줄 빼고 단어 바꿔서</span>}
            </p>
            <div className="plan-script">
              <span className="plan-role">연결 {i + 1}</span>
              <button
                className="plan-name"
                onClick={() => setExpanded(expanded === openKey ? null : openKey)}
              >
                {item.script.categoryTitle} · {item.script.labelKo || item.script.labelEn}
                <span className="dim"> {expanded === openKey ? '▲' : '▼'}</span>
              </button>
              <span className="plan-actions">
                {item.script.audio && (
                  <button className="btn-icon" onClick={() => playScript(item.script)}>
                    {playing === `script-${item.script.id}` ? '⏹' : '▶'}
                  </button>
                )}
                <button
                  className="btn-icon"
                  onClick={() => onOpenScript(item.script.id)}
                  aria-label="스크립트 열기"
                >
                  ↗
                </button>
              </span>
            </div>
            {expanded === openKey && (
              <div className="plan-preview">
                {item.script.sentences.slice(0, 3).map((s) => (
                  <p key={s.sentenceId} className="en dim">
                    {sub(s.en, industry)}
                  </p>
                ))}
                {item.script.sentences.length > 3 && <p className="dim">… (↗ 로 전체 보기)</p>}
              </div>
            )}
          </div>
        )
      })}

      <div className="plan-step plan-free">
        <span className="plan-role">마무리 (즉흥)</span>
        <p className="plan-phrase">“{sub(p.outro)}”</p>
      </div>
    </div>
  )
}

export function ConnectScreen({ onBack, onOpenScript }: Props) {
  const [scripts, setScripts] = useState<StoredScript[]>([])
  const [pool, setPool] = useState<Question[]>([])
  const [combos, setCombos] = useState<Question[][]>([])
  const [mode, setMode] = useState<'single' | 'combo'>('combo')

  const [q, setQ] = useState<Question | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [combo, setCombo] = useState<Combo | null>(null)

  const [expanded, setExpanded] = useState<string | null>(null)
  const [done, setDone] = useState(0)
  const [playing, setPlaying] = useState<string | null>(null)
  const lastQRef = useRef<string | null>(null)
  const lastComboRef = useRef<string | null>(null)
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
      const groups: Question[][] = []
      for (const sec of mock) {
        for (const t of sec.tests) {
          const toQ = (i: number): Question => ({
            secName: sec.name,
            testNo: t.no,
            qIdx: i,
            text: t.questions[i],
            audio: t.audio?.[i] ?? null,
          })
          // 1번(자기소개)은 연결 연습 대상이 아니다
          for (let i = 1; i < t.questions.length; i++) qs.push(toQ(i))
          for (const g of COMBO_GROUPS) {
            const inRange = g.filter((i) => i < t.questions.length)
            if (inRange.length >= 2) groups.push(inRange.map(toQ))
          }
        }
      }
      setPool(qs)
      setCombos(groups)
      if (groups.length > 0) {
        const first = groups[Math.floor(Math.random() * groups.length)]
        setCombo(buildCombo(first, ordered))
      }
      if (qs.length > 0) {
        const first = qs[Math.floor(Math.random() * qs.length)]
        setQ(first)
        setPlan(buildPlan(first.text, ordered, new Set(), false))
      }
    })()
    return stopAudio
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- 재생 ----

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

  const playQuestion = (target: Question) =>
    void playBlobKeyed(`question-${target.qIdx}`, async () => {
      if (!target.audio) return null
      const db = await getDB()
      return (await db.get('audio', target.audio))?.blob ?? null
    })

  const playScript = (s: StoredScript) =>
    void playBlobKeyed(`script-${s.id}`, async () => {
      const db = await getDB()
      return (await db.get('audio', s.id))?.blob ?? null
    })

  // ---- 뽑기 ----

  const rerollSingle = () => {
    if (!q) return
    stopAudio()
    setExpanded(null)
    setPlan(buildPlan(q.text, scripts, new Set(), false))
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
      setPlan(buildPlan(cand.text, scripts, new Set(), false))
      return
    }
  }

  const rerollCombo = (keepTopic: boolean) => {
    if (!combo) return
    stopAudio()
    setExpanded(null)
    const qs = combo.steps.map((s) => s.q)
    setCombo(buildCombo(qs, scripts, keepTopic ? combo.topic : undefined))
  }

  const changeTopic = () => {
    if (!combo) return
    const others = TOPIC_PRESETS.filter((t) => t.name !== combo.topic.name)
    setCombo(buildCombo(combo.steps.map((s) => s.q), scripts, pick(others)))
  }

  const nextCombo = () => {
    if (combos.length === 0) return
    stopAudio()
    myVoice.stop()
    if (recorder.state.recording) recorder.stop()
    setExpanded(null)
    for (let i = 0; i < 20; i++) {
      const cand = combos[Math.floor(Math.random() * combos.length)]
      const key = `${cand[0].secName}-${cand[0].testNo}-${cand[0].qIdx}`
      if (key === lastComboRef.current && i < 19) continue
      lastComboRef.current = key
      setCombo(buildCombo(cand, scripts))
      return
    }
  }

  // ---- 완료 기록 ----

  const completeItems = async (items: PlanItem[]) => {
    if (recorder.state.recording) recorder.stop()
    for (const item of items) await recordPractice(item.script.id)
    setDone((d) => d + 1)
  }

  const planProps = { expanded, setExpanded, playing, playScript, onOpenScript }
  const recProps = { recorder, myVoice, stopAudio }

  // ---- 화면 ----

  if (pool.length === 0) {
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

      <div className="mode-switch">
        <button
          className={`chip ${mode === 'combo' ? 'on' : ''}`}
          onClick={() => setMode('combo')}
        >
          콤보 3문항
        </button>
        <button
          className={`chip ${mode === 'single' ? 'on' : ''}`}
          onClick={() => setMode('single')}
        >
          단일 문항
        </button>
      </div>

      {mode === 'combo' && combo && (
        <>
          <div className="combo-head">
            <div>
              <strong>{combo.secName} Test {combo.testNo}</strong>
              <span className="dim"> · {combo.label}</span>
            </div>
            <button className="chip on" onClick={changeTopic}>
              주제: {combo.topic.name} ⟳
            </button>
          </div>
          <p className="dim combo-hint">
            세 문항을 같은 주제로 끌고 가면서 패턴이 겹치지 않게 배분했습니다. 겹칠 수밖에 없는
            자리에는 재사용 멘트를 붙여 두었습니다.
          </p>

          {combo.steps.map((step, n) => {
            const recKey = `connect-${combo.secName}-t${combo.testNo}-q${step.q.qIdx}`
            return (
              <section className="combo-step" key={step.q.qIdx}>
                <div className="connect-q">
                  <div className="connect-q-head">
                    <span className="type-badge">{TYPE_LABEL[step.plan.type]}</span>
                    <span className="dim">Q{step.q.qIdx + 1} · {n + 1}번째</span>
                  </div>
                  <p className="exam-text">{step.q.text}</p>
                  {step.q.audio && (
                    <button className="btn-outline" onClick={() => playQuestion(step.q)}>
                      {playing === `question-${step.q.qIdx}` ? '⏹ 정지' : '🔈 질문 듣기'}
                    </button>
                  )}
                </div>
                {step.plan.note && <p className="notice">{step.plan.note}</p>}
                <PlanView
                  plan={step.plan}
                  topic={combo.topic}
                  keyPrefix={`c${step.q.qIdx}`}
                  {...planProps}
                />
                <RecorderBar
                  recKey={recKey}
                  label={`Q${step.q.qIdx + 1} 말해보기`}
                  {...recProps}
                />
              </section>
            )
          })}

          <div className="speak-actions">
            <button className="btn-outline" onClick={() => rerollCombo(true)}>🎲 다른 연결 조합</button>
            <button className="btn-outline" onClick={nextCombo}>⏭ 다른 콤보</button>
          </div>
          <div className="speak-next">
            <button
              className="btn"
              onClick={() =>
                void completeItems(combo.steps.flatMap((s) => s.plan.items)).then(nextCombo)
              }
            >
              ✓ 콤보 완료 — 쓴 스크립트 전부 기록 +1
            </button>
          </div>
        </>
      )}

      {mode === 'single' && q && plan && (
        <>
          <div className="connect-q">
            <div className="connect-q-head">
              <span className="type-badge">{TYPE_LABEL[plan.type]}</span>
              <span className="dim">{q.secName} Test {q.testNo} · Q{q.qIdx + 1}</span>
            </div>
            <p className="exam-text">{q.text}</p>
            {q.audio && (
              <button className="btn-outline" onClick={() => playQuestion(q)}>
                {playing === `question-${q.qIdx}` ? '⏹ 정지' : '🔈 질문 듣기'}
              </button>
            )}
          </div>

          {plan.note && <p className="notice">{plan.note}</p>}
          <PlanView plan={plan} topic={guessTopic(q.text)} keyPrefix="s" {...planProps} />

          <div className="speak-actions">
            <button className="btn-outline" onClick={rerollSingle}>🎲 다른 연결 조합</button>
            <button className="btn-outline" onClick={nextQuestion}>⏭ 다음 질문</button>
          </div>

          <RecorderBar
            recKey={`connect-${q.secName}-t${q.testNo}-q${q.qIdx}`}
            label="플랜대로 말해보기"
            {...recProps}
          />

          <div className="speak-next">
            <button className="btn" onClick={() => void completeItems(plan.items).then(nextQuestion)}>
              ✓ 연습 완료 — 연결한 스크립트 기록 +1
            </button>
          </div>
        </>
      )}

      {recorder.state.error && <p className="notice error">{recorder.state.error}</p>}
    </div>
  )
}
