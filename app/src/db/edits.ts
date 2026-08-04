import { getDB } from './db'
import type { SentenceEdit, StoredScript } from '../types'

/** 저장된 수정본을 스크립트의 문장에 덧입힌다. 원본은 건드리지 않는다 */
export async function applyEdits(script: StoredScript): Promise<StoredScript> {
  const db = await getDB()
  const edits = await db.getAll('edits')
  if (edits.length === 0) return script
  const byId = new Map(edits.map((e) => [e.sentenceId, e]))
  return {
    ...script,
    sentences: script.sentences.map((s) => {
      const e = byId.get(s.sentenceId)
      if (!e) return s
      return { ...s, ko: e.ko ?? s.ko, en: e.en ?? s.en }
    }),
  }
}

export async function saveEdit(sentenceId: string, ko: string, en: string): Promise<void> {
  const db = await getDB()
  const edit: SentenceEdit = { sentenceId, updatedAt: Date.now() }
  if (ko.trim()) edit.ko = ko.trim()
  if (en.trim()) edit.en = en.trim()
  await db.put('edits', edit)
}

/** 수정본을 지우고 원본으로 되돌린다 */
export async function clearEdit(sentenceId: string): Promise<void> {
  const db = await getDB()
  await db.delete('edits', sentenceId)
}

export async function editedIds(): Promise<Set<string>> {
  const db = await getDB()
  return new Set(await db.getAllKeys('edits'))
}
