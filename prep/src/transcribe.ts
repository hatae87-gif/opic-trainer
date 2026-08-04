import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import OpenAI from 'openai'
import type { SourceFile } from './types.js'

export interface Word {
  word: string
  start: number
  end: number
}

export interface Transcription {
  duration: number
  words: Word[]
}

const CACHE_DIR = new URL('../.cache/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

let client: OpenAI | null = null
function getClient(): OpenAI {
  if (!client) {
    const key = process.env.OPENAI_API_KEY
    if (!key) {
      throw new Error(
        'OPENAI_API_KEY가 없습니다. prep/.env 파일에 OPENAI_API_KEY=sk-... 를 넣어주세요.',
      )
    }
    client = new OpenAI({ apiKey: key })
  }
  return client
}

/**
 * 선생님 녹음을 Whisper로 인식해 단어별 타임스탬프를 얻는다.
 * 같은 오디오는 다시 보내지 않도록 내용 해시로 캐싱한다 — 재실행 비용 0.
 */
export async function transcribe(audio: SourceFile): Promise<Transcription> {
  mkdirSync(CACHE_DIR, { recursive: true })
  const cachePath = join(CACHE_DIR, `${audio.sha256}.json`)
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8'))
  }

  const file = new File([audio.data], audio.name, { type: 'audio/m4a' })
  const res = await getClient().audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'en',
    response_format: 'verbose_json',
    timestamp_granularities: ['word'],
  })

  const result: Transcription = {
    duration: res.duration ?? 0,
    words: (res.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
  }
  if (result.words.length === 0) {
    throw new Error(`Whisper가 단어를 하나도 반환하지 않았습니다: ${audio.name}`)
  }
  writeFileSync(cachePath, JSON.stringify(result))
  return result
}
