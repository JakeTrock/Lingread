import './App.css'
import { useEffect, useMemo, useState } from 'react'
import { BionicChunk } from './lib/bionic'
import { splitIntoWords } from './lib/text'

const DEFAULT_WORDS_PER_CHUNK = 40
const STORAGE_KEY_PREFIX = 'lingread:'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function isTypingIntoInput() {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

function App() {
  const [filename, setFilename] = useState<string | null>(null)
  const [words, setWords] = useState<string[]>([])
  const [wordsPerChunkInput, setWordsPerChunkInput] = useState<string>(String(DEFAULT_WORDS_PER_CHUNK))

  const wordsPerChunk = (() => {
    if (wordsPerChunkInput === '') return DEFAULT_WORDS_PER_CHUNK
    const n = Number(wordsPerChunkInput)
    if (!Number.isFinite(n)) return DEFAULT_WORDS_PER_CHUNK
    return clamp(Math.trunc(n), 5, 200)
  })()
  const [chunkIndex, setChunkIndex] = useState<number>(0)
  const [fullscreenMode, setFullscreenMode] = useState<boolean>(false)
  const [fileHash, setFileHash] = useState<string | null>(null)

  const chunkCount = useMemo(() => {
    if (words.length === 0) return 0
    return Math.max(1, Math.ceil(words.length / wordsPerChunk))
  }, [words.length, wordsPerChunk])

  const currentWords = useMemo(() => {
    const start = chunkIndex * wordsPerChunk
    return words.slice(start, start + wordsPerChunk)
  }, [chunkIndex, words, wordsPerChunk])

  const hasText = words.length > 0
  const hasPrev = hasText && chunkIndex > 0
  const hasNext = hasText && chunkIndex < chunkCount - 1

  useEffect(() => {
    if (!hasText) return
    setChunkIndex((idx) => clamp(idx, 0, Math.max(0, chunkCount - 1)))
  }, [chunkCount, hasText])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Escape exits fullscreen mode
      if (e.code === 'Escape' && fullscreenMode) {
        e.preventDefault()
        setFullscreenMode(false)
        return
      }

      // Space advances chunk
      if (e.code === 'Space' && hasText) {
        if (e.repeat) return
        if (chunkCount <= 1) return
        if (!fullscreenMode && isTypingIntoInput()) return

        e.preventDefault()
        setChunkIndex((idx) => Math.min(idx + 1, chunkCount - 1))
      }

      // Backspace goes back a chunk (same as back arrow)
      if (e.code === 'Backspace' && hasPrev) {
        if (e.repeat) return
        if (!fullscreenMode && isTypingIntoInput()) return

        e.preventDefault()
        setChunkIndex((idx) => Math.max(0, idx - 1))
      }
    }

    window.addEventListener('keydown', onKeyDown, { passive: false })
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chunkCount, hasText, hasPrev, fullscreenMode])

  // Persist position and chunk size to localStorage keyed by file content hash
  useEffect(() => {
    if (!fileHash || !hasText) return
    const key = `${STORAGE_KEY_PREFIX}${fileHash}`
    const value = JSON.stringify({ chunkIndex, wordsPerChunk })
    localStorage.setItem(key, value)
  }, [fileHash, hasText, chunkIndex, wordsPerChunk])

  async function onPickFile(file: File) {
    const text = await file.text()
    const hash = await sha256Hex(text)
    const nextWords = splitIntoWords(text)
    setWords(nextWords)
    setFilename(file.name)
    setFileHash(hash)

    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${hash}`)
    if (raw) {
      try {
        const o = JSON.parse(raw) as { chunkIndex?: number; wordsPerChunk?: number }
        const wpc = (() => {
          const n = Number(o.wordsPerChunk)
          if (!Number.isFinite(n)) return DEFAULT_WORDS_PER_CHUNK
          return clamp(Math.trunc(n), 5, 200)
        })()
        const chunkCount = Math.max(1, Math.ceil(nextWords.length / wpc))
        const idx = clamp(Math.trunc(Number(o.chunkIndex)) || 0, 0, chunkCount - 1)
        setWordsPerChunkInput(String(wpc))
        setChunkIndex(idx)
      } catch {
        setChunkIndex(0)
      }
    } else {
      setChunkIndex(0)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brandTitle">Lingread</div>
          <div className="brandSubtitle">Bionic reading the right way</div>
        </div>

        <div className="controls" role="group" aria-label="Reader controls">
          <label className="control">
            <span className="controlLabel">Words / chunk</span>
            <input
              className="numberInput"
              type="number"
              inputMode="numeric"
              min={5}
              max={200}
              value={wordsPerChunkInput}
              onChange={(e) => setWordsPerChunkInput(e.currentTarget.value)}
            />
          </label>

          <div className="buttons">
            <button
              type="button"
              className="btn"
              onClick={() => setChunkIndex((i) => Math.max(0, i - 1))}
              disabled={!hasPrev}
              title="Previous chunk (Backspace)"
            >
              ‹
            </button>
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => setChunkIndex((i) => Math.min(chunkCount - 1, i + 1))}
              disabled={!hasNext}
              title="Next chunk"
            >
              ›
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setFullscreenMode(true)}
              disabled={!hasText}
              title="Enter fullscreen mode (Esc to exit)"
            >
              ⛶
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        {!hasText ? (
          <div className="empty">
            <h1 className="emptyTitle">Upload a .txt file</h1>
            <p className="emptyBody">
              Set <strong>Words / chunk</strong> above, then tap or press <kbd>Space</kbd> to advance.
            </p>
            <label className="uploadBtn">
              Choose file
              <input
                type="file"
                accept=".txt,text/plain"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0]
                  if (!file) return
                  void onPickFile(file)
                  e.currentTarget.value = ''
                }}
              />
            </label>
          </div>
        ) : (
          <>
            <div className="status">
              <div className="statusLeft">
                <span className="pill">{filename ?? 'Untitled'}</span>
                <span className="muted">
                  {words.length.toLocaleString()} words • chunk {chunkIndex + 1} / {chunkCount}
                </span>
              </div>
              <div className="statusRight">
                <span className="hint">
                  <kbd>Space</kbd> next · <kbd>Backspace</kbd> back · or tap
                </span>
              </div>
            </div>

            <section className="reader" aria-label="Bionic reading area">
              <div
                className="chunk"
                aria-live="polite"
                aria-atomic="true"
                onClick={() => hasNext && setChunkIndex((i) => i + 1)}
                style={{ cursor: hasNext ? 'pointer' : 'default' }}
              >
                <BionicChunk words={currentWords} />
              </div>
            </section>
          </>
        )}
      </main>

      {fullscreenMode && hasText && (
        <div className="fullscreenOverlay" onClick={() => setFullscreenMode(false)}>
          <div
            className="fullscreenContent"
            onClick={(e) => {
              e.stopPropagation()
              if (hasNext) setChunkIndex((i) => i + 1)
            }}
            style={{ cursor: hasNext ? 'pointer' : 'default' }}
          >
            <BionicChunk words={currentWords} />
          </div>
          <div className="fullscreenProgress">
            {chunkIndex + 1} / {chunkCount}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
