/**
 * 서론 영작 체커.
 *
 * 외운 패턴 안에서는 문법이 틀리지 않는다. 오류는 전부 서론 2~3문장을
 * 즉석에서 만들 때 나온다 — SAIL 리포트 4회분과 모의고사 답변 메모를 맞춰보면
 * 관사 / 전치사 / 수일치 / to부정사 / 가산명사 다섯 갈래로 모인다.
 * 여기 있는 규칙은 그 다섯 갈래만 잡는다. 일반 문법 검사기가 아니다.
 */

export type Category = 'article' | 'preposition' | 'agreement' | 'verb' | 'countable'

export const CATEGORY_LABEL: Record<Category, string> = {
  article: '관사',
  preposition: '전치사',
  agreement: '수일치',
  verb: '동사형',
  countable: '가산명사',
}

export interface Issue {
  rule: string
  category: Category
  /** 원문에서의 위치 */
  start: number
  end: number
  text: string
  message: string
  fix?: string
}

interface Rule {
  id: string
  category: Category
  re: RegExp
  /** 매치를 받아 메시지를 만든다. null을 주면 그 매치는 넘어간다 (예외 처리) */
  build: (m: RegExpMatchArray, full: string) => { message: string; fix?: string } | null
}

/** to + 동사ing 가 정상인 표현들 — 이때 to는 전치사라서 -ing가 맞다 */
const TO_GERUND_OK =
  /(look(?:s|ed|ing)?\s+forward|used|accustomed|when\s+it\s+comes|due|thanks|close|next|prior|related|committed|opposed|addition|back|key|obstacle|objection|lead(?:s|ing)?|according|compared|contribute(?:s|d)?|devoted|adjust(?:ed|ing)?|get(?:s|ting)?\s+used|points?)\s*$/i

/** one of ~ 뒤에 와도 되는 말 */
const ONE_OF_OK = /^(them|these|those|us|you|it|which|many|several|a|the|my|his|her|our|their)$/i

const IRREGULAR_PLURAL =
  /^(people|children|men|women|teeth|feet|mice|geese|criteria|data|media|staff|police)$/i

const UNCOUNTABLE =
  'information|advice|furniture|equipment|homework|news|research|traffic|luggage|baggage|stuff|knowledge|feedback|software|weather'

const PARTICIPLE_CONFUSION = 'interesting|boring|exciting|tiring|confusing|surprising|relaxing|annoying|satisfying|frustrating'

/** 앞에 관사가 필요한 단수 가산명사 — 태용님 답변에 실제로 나온 것들 위주 */
const NEEDS_ARTICLE = 'fan|lover|planner|beginner|expert|member|student|designer|teacher|person|type'

const VOWEL_SOUND_EXCEPTION_AN = /^(hour|honest|honor|heir)/i
const CONSONANT_SOUND_EXCEPTION_A = /^(university|user|unique|uniform|union|european|one|once|ukulele)/i

const BARE_VERBS =
  'go|do|be|get|make|take|see|eat|watch|play|visit|buy|read|cook|run|walk|swim|work|stay|come|meet|listen|study|travel|spend|enjoy'

const RULES: Rule[] = [
  {
    id: 'a-an',
    category: 'article',
    re: /\b(a|an)\s+([a-z]+)\b/gi,
    build: (m) => {
      const art = m[1].toLowerCase()
      const word = m[2]
      const startsVowel = /^[aeiou]/i.test(word)
      const needsAn = CONSONANT_SOUND_EXCEPTION_A.test(word)
        ? false
        : VOWEL_SOUND_EXCEPTION_AN.test(word)
          ? true
          : startsVowel
      if (needsAn && art === 'a') return { message: `모음 소리 앞이라 an`, fix: `an ${word}` }
      if (!needsAn && art === 'an') return { message: `자음 소리 앞이라 a`, fix: `a ${word}` }
      return null
    },
  },
  {
    id: 'to-gerund',
    category: 'verb',
    re: /\bto\s+([a-z]+ing)\b/gi,
    build: (m, full) => {
      const before = full.slice(0, m.index ?? 0)
      if (TO_GERUND_OK.test(before)) return null
      const base = m[1].replace(/ing$/, '')
      return {
        message: 'to 뒤에는 동사원형 — "to listening to music" 같은 실수',
        fix: `to ${base}`,
      }
    },
  },
  {
    id: 'bare-infinitive',
    category: 'verb',
    re: new RegExp(`\\b(like|love|want|need|try|hope|plan|decide|used)\\s+(${BARE_VERBS})\\b`, 'gi'),
    build: (m) => ({
      message: `${m[1]} 뒤에는 to + 동사원형`,
      fix: `${m[1]} to ${m[2]}`,
    }),
  },
  {
    id: 'adverb-gerund',
    category: 'verb',
    re: /\b(i|we|they|you)\s+(really|just|always|usually|often|sometimes|still)\s+([a-z]+ing)\b/gi,
    build: () => ({
      message: "동사가 빠졌습니다 — I'm / I like / I enjoy 중 하나를 넣으세요",
    }),
  },
  {
    id: 'close-to',
    category: 'preposition',
    re: /\b(close|next)\s+(?!to\b)(my|the|a|an|his|her|our|their|this|that)\b/gi,
    build: (m) => ({ message: `${m[1]} 뒤에는 to`, fix: `${m[1]} to ${m[2]}` }),
  },
  {
    id: 'floor',
    category: 'preposition',
    re: /(\w+\s+\w+\s+)?\b(\d+(?:st|nd|rd|th))\s+floor\b/gi,
    build: (m) => {
      if (/on\s+the\s*$/i.test(m[1] ?? '')) return null
      return { message: '층은 on the ~ floor', fix: `on the ${m[2]} floor` }
    },
  },
  {
    id: 'visit-to',
    category: 'preposition',
    re: /\bvisit(ed|ing|s)?\s+to\b/gi,
    build: (m) => ({ message: 'visit은 바로 목적어를 받습니다', fix: `visit${m[1] ?? ''}` }),
  },
  {
    id: 'go-to-home',
    category: 'preposition',
    re: /\b(go|goes|going|went|get|got)\s+to\s+(home|there|here|abroad|downtown|outside|inside|upstairs)\b/gi,
    build: (m) => ({ message: `${m[2]} 앞에는 to를 쓰지 않습니다`, fix: `${m[1]} ${m[2]}` }),
  },
  {
    id: 'in-home',
    category: 'preposition',
    re: /\bin\s+home\b/gi,
    build: () => ({ message: '집에서는 at home', fix: 'at home' }),
  },
  {
    id: 'in-the-weekend',
    category: 'preposition',
    re: /\bin\s+the\s+(weekend|weekends)\b/gi,
    build: (m) => ({ message: '주말에는 on', fix: `on the ${m[1]}` }),
  },
  {
    id: 'prep-last-next',
    category: 'preposition',
    re: /\b(on|in|at)\s+(last|next|this)\s+(week|month|year|weekend|friday|saturday|sunday|monday|tuesday|wednesday|thursday|summer|winter|spring|fall)\b/gi,
    build: (m) => ({
      message: 'last / next / this 앞에는 전치사를 쓰지 않습니다',
      fix: `${m[2]} ${m[3]}`,
    }),
  },
  {
    id: 'discuss-about',
    category: 'preposition',
    re: /\bdiscuss(ed|ing|es)?\s+about\b/gi,
    build: (m) => ({ message: 'discuss는 about 없이', fix: `discuss${m[1] ?? ''}` }),
  },
  {
    id: 'explain-me',
    category: 'preposition',
    re: /\bexplain\s+(me|him|her|us|them)\b/gi,
    build: (m) => ({ message: 'explain 뒤에는 to', fix: `explain to ${m[1]}` }),
  },
  {
    id: 'indefinite-agreement',
    category: 'agreement',
    re: /\b(everyone|everybody|someone|somebody|nobody|anyone|anybody|each)\s+(are|were|have|do|like|use|go|want|think|know|need|take|make|watch|enjoy)\b/gi,
    build: (m) => {
      const fixes: Record<string, string> = { are: 'is', were: 'was', have: 'has', do: 'does' }
      const v = m[2].toLowerCase()
      return {
        message: `${m[1]}는 단수 취급`,
        fix: `${m[1]} ${fixes[v] ?? v + (v.endsWith('h') || v.endsWith('o') ? 'es' : 's')}`,
      }
    },
  },
  {
    id: 'third-person-s',
    category: 'agreement',
    re: /\b(he|she|it)\s+(like|want|go|have|think|know|make|take|use|live|work|enjoy|need|watch|do|say|come|look)\b/gi,
    build: (m) => {
      const fixes: Record<string, string> = { have: 'has', do: 'does', go: 'goes', watch: 'watches' }
      const v = m[2].toLowerCase()
      return { message: '3인칭 단수 -s', fix: `${m[1]} ${fixes[v] ?? v + 's'}` }
    },
  },
  {
    id: 'one-of-singular',
    category: 'countable',
    re: /\bone of (?:my |the |his |her |our |their )?([a-z]+)\b/gi,
    build: (m) => {
      const w = m[1]
      if (ONE_OF_OK.test(w) || IRREGULAR_PLURAL.test(w)) return null
      if (/s$/i.test(w)) return null
      return { message: 'one of 뒤에는 복수형', fix: `one of ... ${w}s` }
    },
  },
  {
    id: 'uncountable-plural',
    category: 'countable',
    re: new RegExp(`\\b(${UNCOUNTABLE})s\\b`, 'gi'),
    build: (m) => ({ message: `${m[1]}는 불가산명사 — 복수형이 없습니다`, fix: m[1] }),
  },
  {
    id: 'uncountable-article',
    category: 'countable',
    re: new RegExp(`\\b(a|an|many)\\s+(${UNCOUNTABLE})\\b`, 'gi'),
    build: (m) => ({
      message: `${m[2]}는 불가산명사 — a / many를 붙이지 않습니다`,
      fix: m[1].toLowerCase() === 'many' ? `much ${m[2]}` : m[2],
    }),
  },
  {
    id: 'missing-article',
    category: 'article',
    re: new RegExp(
      `\\b(i'?m|he'?s|she'?s|is|are|was|were)\\s+((?:very|really|quite|such|pretty)\\s+)?([a-z]+\\s+)?(${NEEDS_ARTICLE})\\b`,
      'gi',
    ),
    build: (m) => {
      const mid = `${m[2] ?? ''}${m[3] ?? ''}`
      if (/\b(a|an|the|my|his|her|our|their|no)\s*$/i.test(mid)) return null
      // "are fans" 처럼 복수면 관사가 필요 없다
      if (/\b(are|were)\b/i.test(m[1]) && !m[3]) return null
      // very / really 는 명사를 꾸미지 못한다 — a huge ~ 로 바꿔야 자연스럽다
      const intensifier = (m[2] ?? '').trim()
      const rest = `${m[3] ?? ''}${m[4]}`.trim()
      return {
        message: intensifier
          ? `단수 가산명사 앞에 관사가 빠졌습니다 (${intensifier}는 명사를 꾸미지 못합니다)`
          : '단수 가산명사 앞에 관사가 빠졌습니다',
        fix: `${m[1]} a ${intensifier ? 'huge ' : ''}${rest}`,
      }
    },
  },
  {
    id: 'participle',
    category: 'verb',
    re: new RegExp(`\\b(i'?m|i am|he'?s|she'?s|we'?re|they'?re)\\s+(${PARTICIPLE_CONFUSION})\\b`, 'gi'),
    build: (m) => ({
      message: '사람이 느끼는 쪽은 -ed',
      fix: `${m[1]} ${m[2].replace(/ing$/, 'ed')}`,
    }),
  },
]

/** 서론 텍스트에서 태용님 상습 오류를 찾는다 */
export function checkIntro(text: string): Issue[] {
  const out: Issue[] = []
  for (const rule of RULES) {
    // 전역 정규식은 lastIndex가 남으므로 매번 새로 만든다
    const re = new RegExp(rule.re.source, rule.re.flags)
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue
      const built = rule.build(m, text)
      if (!built) continue
      out.push({
        rule: rule.id,
        category: rule.category,
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        message: built.message,
        fix: built.fix,
      })
    }
  }
  // 겹치는 매치는 앞선 것만 남긴다
  out.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: Issue[] = []
  for (const i of out) {
    if (kept.length > 0 && i.start < kept[kept.length - 1].end) continue
    kept.push(i)
  }
  return kept
}

export interface StructureNote {
  ok: boolean
  text: string
}

const LEADIN_TAIL =
  /\b(and|so|because|but|anyway|actually|well|first|let me|the reason|the thing is|speaking of)\b[^.?!]*$/i

/**
 * 문법 말고 "서론답게 썼는지"를 본다.
 * 교재 기준: 즉답 한 줄 + 2~3문장 + 육하원칙으로 넘어갈 연결고리.
 */
export function reviewStructure(text: string): StructureNote[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const sentences = trimmed
    .split(/[.?!…]+(?:\s|$)|[.…]{2,}\s*/)
    .filter((s) => s.trim().length > 2)
  const words = trimmed.split(/\s+/).length
  const notes: StructureNote[] = []

  notes.push(
    sentences.length >= 2 && sentences.length <= 4
      ? { ok: true, text: `${sentences.length}문장 — 서론 분량 적절` }
      : {
          ok: false,
          text:
            sentences.length < 2
              ? '서론이 한 문장입니다 — 즉답 + 살 붙이기로 2~3문장'
              : `${sentences.length}문장 — 서론이 깁니다. 본론은 패턴에 맡기세요`,
        },
  )

  notes.push(
    words >= 15 && words <= 60
      ? { ok: true, text: `${words}단어` }
      : { ok: false, text: `${words}단어 — 15~60단어 사이가 적당합니다` },
  )

  notes.push(
    LEADIN_TAIL.test(trimmed)
      ? { ok: true, text: '연결고리로 끝남 — 패턴으로 넘어가기 좋습니다' }
      : {
          ok: false,
          text: '연결고리가 없습니다 — "and the reason why I like it is…" 같은 한 마디로 끝내세요',
        },
  )

  const hasFiller = /\b(uh|um+|well|you know|actually|i mean|hmm)\b/i.test(trimmed)
  notes.push(
    hasFiller
      ? { ok: true, text: '추임새 있음 — 즉흥적으로 들립니다' }
      : { ok: false, text: '추임새가 없습니다 — Uh… / well / actually 를 섞으세요' },
  )

  return notes
}
