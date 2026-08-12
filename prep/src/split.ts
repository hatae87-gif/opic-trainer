import type { SentencePair } from './types.js'

/**
 * 문장 경계로 자른다.
 *
 * 이 자료에서 진짜 호흡 단위는 마침표가 아니라 `..` 와 `…` 다. 선생님도 여기서 쉬고,
 * 한국어 문단과 영어 문단이 같은 지점에 이 표시를 갖고 있다.
 */
export function splitChunks(text: string): string[] {
  const normalized = text.replace(/…/g, '..').replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  return normalized
    .split(/(?<=[.?!]["'’”)\]]?)\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 비-1:1 매칭에 주는 벌점. 값이 클수록 1:1 매칭을 선호한다 */
const SKEW_PENALTY = 1.2
/** 한 그룹에 최대 몇 개 조각까지 묶을지 */
const MOVES: [number, number][] = [
  [1, 1],
  [1, 2],
  [2, 1],
  [2, 2],
]
/**
 * 영어 단위가 사용자 지정(`/`)이라 합칠 수 없을 때 쓰는 이동.
 * 영어는 반드시 1단위씩 소비하고, 한국어만 0~3조각씩 붙인다.
 * [0,1]은 대응하는 한국어 조각이 없는 영어 단위 (문장 중간에 끊긴 경우).
 */
const MOVES_FIXED_EN: [number, number][] = [
  [1, 1],
  [2, 1],
  [3, 1],
  [0, 1],
]

/**
 * 한국어 조각과 영어 조각을 길이 비율로 정렬한다 (Gale-Church 방식의 간소판).
 *
 * 두 언어의 조각 수가 딱 맞아떨어지는 경우는 드물다. 한국어의 `뭐..` 하나가
 * 영어에서는 `well, of course,` 로 다른 조각에 붙어있는 식이다. 그래서 개수를
 * 강제로 맞추는 대신, 길이 비율이 가장 자연스러운 묶음을 동적계획법으로 찾는다.
 *
 * 오디오 구간은 영어 기준으로 잡히므로, 묶인 영어 조각들은 하나의 문장으로 합쳐진다.
 */
function alignByLength(
  koChunks: string[],
  enChunks: string[],
  moves: [number, number][] = MOVES,
): { ko: string; en: string }[] {
  const K = koChunks.length
  const E = enChunks.length
  const totalKo = koChunks.reduce((n, s) => n + s.length, 0) || 1
  const totalEn = enChunks.reduce((n, s) => n + s.length, 0) || 1
  const ratio = totalEn / totalKo

  const cost = (ki: number, kn: number, ei: number, en: number): number => {
    let k = 0
    for (let i = 0; i < kn; i++) k += koChunks[ki + i].length
    let e = 0
    for (let i = 0; i < en; i++) e += enChunks[ei + i].length
    const expected = ratio * k
    const deviation = Math.abs(e - expected) / Math.sqrt(expected + 1)
    return deviation + (kn === 1 && en === 1 ? 0 : SKEW_PENALTY)
  }

  const INF = Number.POSITIVE_INFINITY
  const best: number[][] = Array.from({ length: K + 1 }, () => new Array(E + 1).fill(INF))
  const from: ([number, number] | null)[][] = Array.from({ length: K + 1 }, () =>
    new Array(E + 1).fill(null),
  )
  best[0][0] = 0

  for (let k = 0; k <= K; k++) {
    for (let e = 0; e <= E; e++) {
      if (best[k][e] === INF) continue
      for (const [dk, de] of moves) {
        if (k + dk > K || e + de > E) continue
        const next = best[k][e] + cost(k, dk, e, de)
        if (next < best[k + dk][e + de]) {
          best[k + dk][e + de] = next
          from[k + dk][e + de] = [dk, de]
        }
      }
    }
  }

  if (best[K][E] === INF) return []

  const groups: { ko: string; en: string }[] = []
  let k = K
  let e = E
  while (k > 0 || e > 0) {
    const move = from[k][e]
    if (!move) return []
    const [dk, de] = move
    groups.unshift({
      ko: koChunks.slice(k - dk, k).join(' '),
      en: enChunks.slice(e - de, e).join(' '),
    })
    k -= dk
    e -= de
  }
  return groups
}

export interface SplitResult {
  sentences: SentencePair[]
  koAligned: boolean
  /** 사용자의 `/` 표시로 나눴는지 여부 */
  usedSlash: boolean
}

export function splitScript(ko: string, en: string): SplitResult {
  // 사용자가 영어에 `/` 로 연습 단위를 직접 표시했으면 그것이 최우선 기준이다
  const slashUnits = en
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  if (slashUnits.length > 1) {
    const koSlash = ko
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean)
    if (koSlash.length === slashUnits.length) {
      // 한국어에도 같은 개수의 `/` 가 있으면 그대로 1:1
      return {
        sentences: slashUnits.map((text, i) => ({ order: i, en: text, ko: koSlash[i] })),
        koAligned: true,
        usedSlash: true,
      }
    }
    // 한국어엔 `/` 가 없다: `..` 조각을 길이 비율로 각 영어 단위에 배분한다.
    // 영어 단위는 절대 합치지 않는다 (사용자가 정한 단위이므로).
    const koChunks = splitChunks(ko)
    if (koChunks.length > 0) {
      const groups = alignByLength(koChunks, slashUnits, MOVES_FIXED_EN)
      if (groups.length === slashUnits.length) {
        return {
          sentences: groups.map((g, i) => ({ order: i, en: g.en, ko: g.ko })),
          koAligned: true,
          usedSlash: true,
        }
      }
    }
    return {
      sentences: slashUnits.map((text, i) => ({ order: i, en: text, ko: '' })),
      koAligned: false,
      usedSlash: true,
    }
  }

  const enChunks = splitChunks(en)
  const koChunks = splitChunks(ko)

  if (enChunks.length === 0) return { sentences: [], koAligned: false, usedSlash: false }

  if (koChunks.length > 0) {
    const groups = alignByLength(koChunks, enChunks)
    if (groups.length > 0) {
      return {
        sentences: groups.map((g, i) => ({ order: i, en: g.en, ko: g.ko })),
        koAligned: true,
        usedSlash: false,
      }
    }
  }

  // 한국어를 붙이지 못했다. 영어만으로 문장을 나누고, 한국어는 앱에서 문단 통째로 보여준다.
  return {
    sentences: enChunks.map((text, i) => ({ order: i, en: text, ko: '' })),
    koAligned: false,
    usedSlash: false,
  }
}
