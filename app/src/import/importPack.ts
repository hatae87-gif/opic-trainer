import { unzipSync } from 'fflate'
import { getDB } from '../db/db'
import type { Manifest, StoredScript } from '../types'

/**
 * 정규화된 영어 문장의 FNV-1a 해시.
 * 재임포트해도 같은 문장이면 같은 id가 나와 SRS·녹음 기록이 유지된다.
 */
export function sentenceId(en: string): string {
  const normalized = en.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim()
  let h = 0x811c9dc5
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export interface ImportSummary {
  student: string
  scripts: number
  sentences: number
  withAudio: number
  /** 문장별 재생 구간이 있는 문장 수. 0이면 Whisper 정렬 전 번들이다 */
  withTiming: number
  /** 기존 학습 기록이 이어지는 문장 수 */
  carriedOver: number
  /** 이 번들에 든 모의고사 문항 수. 0이면 모의고사 없는 번들 */
  mockQuestions: number
}

export async function importPack(file: File): Promise<ImportSummary> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new Error('파일을 열 수 없습니다. .opicpack 파일이 맞는지 확인해주세요.')
  }

  const manifestRaw = entries['manifest.json']
  if (!manifestRaw) throw new Error('manifest.json이 없습니다. prep 도구로 만든 번들이 맞나요?')
  const manifest: Manifest = JSON.parse(new TextDecoder().decode(manifestRaw))
  if (manifest.version !== 1) throw new Error(`지원하지 않는 번들 버전입니다: ${manifest.version}`)

  const db = await getDB()
  const existingSrs = new Set(await db.getAllKeys('srs'))

  // 스크립트·오디오는 통째로 교체 (누적 갱신 파일이므로 항상 최신 전체가 들어온다)
  const tx = db.transaction(['scripts', 'audio', 'meta'], 'readwrite')
  await tx.objectStore('scripts').clear()
  await tx.objectStore('audio').clear()

  let sentences = 0
  let withAudio = 0
  let withTiming = 0
  let carriedOver = 0

  for (const s of manifest.scripts) {
    const stored: StoredScript = {
      ...s,
      sentences: s.sentences.map((sent) => {
        const id = sentenceId(sent.en)
        sentences++
        if (sent.start !== undefined) withTiming++
        if (existingSrs.has(id)) carriedOver++
        return { ...sent, sentenceId: id }
      }),
    }
    await tx.objectStore('scripts').put(stored)

    if (s.audio && entries[s.audio]) {
      withAudio++
      await tx
        .objectStore('audio')
        .put({ scriptId: s.id, blob: new Blob([entries[s.audio].slice()], { type: 'audio/mp4' }) })
    }
  }
  await tx
    .objectStore('meta')
    .put({ key: 'lastImport', value: `${manifest.createdAt}|${manifest.student}` })
  if (manifest.mockExam) {
    await tx.objectStore('meta').put({ key: 'mockExam', value: JSON.stringify(manifest.mockExam) })
  }
  await tx.done

  const mockQuestions =
    manifest.mockExam?.reduce(
      (n, s) => n + s.tests.reduce((m, t) => m + t.questions.length, 0),
      0,
    ) ?? 0

  return {
    student: manifest.student,
    scripts: manifest.scripts.length,
    sentences,
    withAudio,
    withTiming,
    carriedOver,
    mockQuestions,
  }
}
