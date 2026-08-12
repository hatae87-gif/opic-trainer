import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import type { Manifest } from './types.js'

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'output')

/**
 * 이전 번들에서 사용자의 `/` 단위 표시를 되찾는다.
 *
 * 학원에서 새 워드를 받으면 사용자가 넣어둔 `/` 가 사라진 채로 저장되기 쉽다.
 * 문장 내용이 그대로라면 단위 표시는 유효하므로, 이전 번들의 단위를 이어받아
 * 폰의 수정본·학습기록이 끊기지 않게 한다.
 *
 * 반환: 스크립트 id → `/` 로 이어붙인 영어 원문
 */
export function loadPreviousAnnotations(): Map<string, string> {
  const annotations = new Map<string, string>()

  let packs: { path: string; mtime: number }[]
  try {
    packs = readdirSync(OUTPUT_DIR)
      .filter((f) => f.endsWith('.opicpack'))
      .map((f) => {
        const path = join(OUTPUT_DIR, f)
        return { path, mtime: statSync(path).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return annotations
  }

  for (const pack of packs) {
    let manifest: Manifest
    try {
      const entries = unzipSync(readFileSync(pack.path))
      const raw = entries['manifest.json']
      if (!raw) continue
      manifest = JSON.parse(new TextDecoder().decode(raw)) as Manifest
    } catch {
      continue
    }
    for (const s of manifest.scripts) {
      if (annotations.has(s.id)) continue // 최신 번들 우선
      // 슬래시 유래 단위만 이어받는다. 플래그가 없는 옛 번들은 단위가 여러 개면 신뢰한다.
      const fromSlash = s.unitSource ? s.unitSource === 'slash' : s.sentences.length > 1
      if (!fromSlash) continue
      annotations.set(s.id, s.sentences.map((x) => x.en).join(' / '))
    }
  }
  return annotations
}

/** `/` 와 공백 차이를 무시하고 두 영어 원문이 같은 내용인지 비교하기 위한 정규화 */
export function normalizeForCompare(en: string): string {
  return en.replace(/\//g, ' ').replace(/…/g, '..').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 단어 비교용 정규화. 문장부호를 걷어내 오타 수정(it→is 등)만 차이로 남게 한다 */
function normWord(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** 이 비율 이상 단어가 일치해야 같은 문장이 바뀐 것으로 본다 */
const MIN_SIMILARITY = 0.85

/**
 * 문장 내용이 조금 바뀌었을 때(오타 수정 등) `/` 위치를 새 문장으로 옮겨 심는다.
 *
 * 이전 단어열과 새 단어열을 Needleman-Wunsch로 정렬한 뒤,
 * 이전 텍스트에서 `/` 가 있던 단어 경계를 새 텍스트의 대응 위치로 옮긴다.
 * 유사도가 낮으면(내용이 실질적으로 바뀌면) null 을 돌려 이어받기를 포기한다.
 */
export function carrySlashes(prevAnnotated: string, newEn: string): string | null {
  const prevUnits = prevAnnotated
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  if (prevUnits.length < 2) return null

  const prevWords: string[] = []
  /** `/` 가 놓였던 위치: 이 인덱스의 단어 "뒤" */
  const boundaries: number[] = []
  for (const unit of prevUnits) {
    prevWords.push(...unit.split(/\s+/))
    boundaries.push(prevWords.length - 1)
  }
  boundaries.pop() // 마지막 단위 끝은 경계가 아니다

  const newTokens = newEn.split(/\s+/).filter(Boolean)
  const P = prevWords.length
  const N = newTokens.length
  if (P === 0 || N === 0) return null

  // 표준 NW 정렬: 일치 +1, 불일치/공백 -1
  const score: Int32Array[] = Array.from({ length: P + 1 }, () => new Int32Array(N + 1))
  for (let i = 1; i <= P; i++) score[i][0] = -i
  for (let j = 1; j <= N; j++) score[0][j] = -j
  for (let i = 1; i <= P; i++) {
    for (let j = 1; j <= N; j++) {
      const match = normWord(prevWords[i - 1]) === normWord(newTokens[j - 1]) ? 1 : -1
      score[i][j] = Math.max(score[i - 1][j - 1] + match, score[i - 1][j] - 1, score[i][j - 1] - 1)
    }
  }

  // 역추적하며 이전 단어 → 새 단어 매핑을 만든다
  const mapTo = new Array<number>(P).fill(-1)
  let matches = 0
  let i = P
  let j = N
  while (i > 0 && j > 0) {
    const match = normWord(prevWords[i - 1]) === normWord(newTokens[j - 1]) ? 1 : -1
    if (score[i][j] === score[i - 1][j - 1] + match) {
      if (match === 1) {
        mapTo[i - 1] = j - 1
        matches++
      }
      i--
      j--
    } else if (score[i][j] === score[i - 1][j] - 1) i--
    else j--
  }

  if (matches / Math.max(P, N) < MIN_SIMILARITY) return null

  // 경계의 새 위치: 경계 단어(또는 그 앞에서 가장 가까운 매칭 단어)의 새 인덱스 뒤
  const cutAfter = new Set<number>()
  for (const b of boundaries) {
    let idx = -1
    for (let k = b; k >= 0; k--) {
      if (mapTo[k] !== -1) {
        idx = mapTo[k]
        break
      }
    }
    if (idx === -1 || idx >= N - 1) return null // 경계를 놓을 곳이 없다
    cutAfter.add(idx)
  }
  if (cutAfter.size !== boundaries.length) return null // 경계 두 개가 한 곳에 겹쳤다

  return newTokens.map((w, k) => (cutAfter.has(k) ? `${w} /` : w)).join(' ')
}
