import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { RecordingEntry, SrsEntry, StoredScript } from '../types'

interface OpicDB extends DBSchema {
  /** 스크립트 본문 + 문장 + 구간. 임포트 때마다 통째로 교체된다 */
  scripts: { key: string; value: StoredScript }
  /** 선생님 녹음 원본. key = scriptId */
  audio: { key: string; value: { scriptId: string; blob: Blob } }
  /** 학습 기록. 임포트해도 지워지지 않는다 */
  srs: { key: string; value: SrsEntry; indexes: { byDue: number } }
  /** 내 목소리 녹음. 임포트해도 지워지지 않는다 */
  recordings: {
    key: string
    value: RecordingEntry
    indexes: { bySentence: string }
  }
  meta: { key: string; value: { key: string; value: string } }
}

let dbPromise: Promise<IDBPDatabase<OpicDB>> | null = null

export function getDB(): Promise<IDBPDatabase<OpicDB>> {
  dbPromise ??= openDB<OpicDB>('opic-trainer', 1, {
    upgrade(db) {
      db.createObjectStore('scripts', { keyPath: 'id' })
      db.createObjectStore('audio', { keyPath: 'scriptId' })
      const srs = db.createObjectStore('srs', { keyPath: 'sentenceId' })
      srs.createIndex('byDue', 'dueAt')
      const rec = db.createObjectStore('recordings', { keyPath: 'id' })
      rec.createIndex('bySentence', 'sentenceId')
      db.createObjectStore('meta', { keyPath: 'key' })
    },
  })
  return dbPromise
}

/**
 * 브라우저가 저장소를 임의로 비우지 않도록 영속성을 요청한다.
 * 홈 화면에 추가된 PWA는 대부분 허용된다.
 */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.()
  } catch {
    // 지원하지 않는 브라우저면 그냥 넘어간다
  }
}
