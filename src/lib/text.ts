export function splitIntoWords(raw: string): string[] {
  const text = raw.replace(/^\uFEFF/, '').replace(/\s+/g, ' ').trim()
  if (!text) return []
  return text.split(' ')
}

