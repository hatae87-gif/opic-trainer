import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'
import type { BuiltScript, Manifest, SourceFile } from './types.js'

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'output')

/**
 * manifest + 오디오를 .opicpack(zip) 하나로 묶는다.
 * 이 파일 하나만 폰으로 보내면 앱이 통째로 가져간다.
 */
export function writeBundle(
  student: string,
  scripts: BuiltScript[],
  audioByScript: Map<string, SourceFile>,
): string {
  const entries: Record<string, Uint8Array> = {}
  for (const s of scripts) {
    if (!s.audio) continue
    const file = audioByScript.get(s.id)
    if (!file) continue
    // zip 엔트리 이름은 ASCII로 강제해 폰 쪽 압축 해제에서 한글 인코딩 문제를 피한다
    const safeName = `audio/${s.id}.m4a`
    s.audio = safeName
    entries[safeName] = file.data
  }

  // manifest는 audio 필드가 zip 엔트리 이름으로 바뀐 뒤에 직렬화해야 한다
  const manifest: Manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    student,
    scripts,
  }
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 1))

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const outPath = join(OUTPUT_DIR, `opic-${stamp}.opicpack`)
  writeFileSync(outPath, zipSync(entries, { level: 6 }))
  return outPath
}
