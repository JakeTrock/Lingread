import type { ReactNode } from 'react'

const CORE_WORD_RE = /^([^\p{L}\p{N}]*)((?:[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*)?)([^\p{L}\p{N}]*)$/u

function boldPrefixLength(core: string) {
  // Renato Casutt-style bionic emphasis: bias attention to the word start.
  // 40% prefix, clamped for comfort.
  const desired = Math.ceil(core.length * 0.4)
  const cap = Math.min(6, core.length)
  return Math.max(1, Math.min(cap, desired))
}

function renderBionicToken(token: string): ReactNode {
  const m = token.match(CORE_WORD_RE)
  if (!m) return token

  const [, leading, core, trailing] = m
  if (!core) return token

  const n = boldPrefixLength(core)
  const head = core.slice(0, n)
  const tail = core.slice(n)

  return (
    <span className="token">
      {leading}
      <span className="bionicBold">{head}</span>
      <span className="bionicRest">{tail}</span>
      {trailing}
    </span>
  )
}

export function BionicChunk({ words }: { words: string[] }) {
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          {renderBionicToken(w)}
          {i < words.length - 1 ? ' ' : null}
        </span>
      ))}
    </>
  )
}

