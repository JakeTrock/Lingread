const STORAGE_KEY_PREFIX = 'lingread:annotations:'

export interface Annotation {
  chunkIndex: number
  text: string
  createdAt: string
}

export function getStoredAnnotations(fileHash: string): Annotation[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${fileHash}`)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is Annotation =>
        item &&
        typeof item === 'object' &&
        typeof (item as Annotation).chunkIndex === 'number' &&
        typeof (item as Annotation).text === 'string' &&
        typeof (item as Annotation).createdAt === 'string'
    )
  } catch {
    return []
  }
}

export function saveAnnotations(fileHash: string, annotations: Annotation[]): void {
  localStorage.setItem(`${STORAGE_KEY_PREFIX}${fileHash}`, JSON.stringify(annotations))
}

const EXCERPT_MAX_LEN = 60

export function exportAnnotationsAsText(
  filename: string,
  annotations: Annotation[],
  getChunkWords: (chunkIndex: number) => string[]
): string {
  const exported = new Date().toLocaleString()
  const lines: string[] = [
    `Lingread Annotations — ${filename}`,
    `Exported: ${exported}`,
    '',
  ]

  const sorted = [...annotations].sort((a, b) => a.chunkIndex - b.chunkIndex)
  for (const ann of sorted) {
    const chunkWords = getChunkWords(ann.chunkIndex)
    const excerpt = chunkWords.join(' ').trim().slice(0, EXCERPT_MAX_LEN)
    const excerptSuffix = excerpt.length >= EXCERPT_MAX_LEN ? '...' : ''
    lines.push(`--- Chunk ${ann.chunkIndex + 1} ---`)
    if (excerpt) lines.push(`${excerpt}${excerptSuffix}`)
    lines.push(`Note: ${ann.text}`)
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

export function sanitizeExportFilename(originalName: string): string {
  const base = originalName.replace(/^.*[/\\]/, '').trim() || 'annotations'
  const safe = base.replace(/[^\w\s.-]/gi, '-').replace(/\s+/g, '-')
  const name = safe || 'annotations'
  const withoutExt = name.replace(/\.txt$/i, '')
  return `annotations-${withoutExt}.txt`
}
