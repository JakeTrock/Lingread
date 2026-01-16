import './App.css'
import { useEffect, useMemo, useState } from 'react'
import { BionicChunk } from './lib/bionic'
import { splitIntoWords } from './lib/text'

const DEFAULT_WORDS_PER_CHUNK = 40

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
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
  const [wordsPerChunk, setWordsPerChunk] = useState<number>(DEFAULT_WORDS_PER_CHUNK)
  const [chunkIndex, setChunkIndex] = useState<number>(0)
  const [zenMode, setZenMode] = useState<boolean>(false)

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
      // Escape exits zen mode
      if (e.code === 'Escape' && zenMode) {
        e.preventDefault()
        setZenMode(false)
        return
      }

      // Space advances chunk
      if (e.code === 'Space' && hasText) {
        if (e.repeat) return
        if (chunkCount <= 1) return
        if (!zenMode && isTypingIntoInput()) return

        e.preventDefault()
        setChunkIndex((idx) => Math.min(idx + 1, chunkCount - 1))
      }
    }

    window.addEventListener('keydown', onKeyDown, { passive: false })
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chunkCount, hasText, zenMode])

  async function onPickFile(file: File) {
    const text = await file.text()
    const nextWords = splitIntoWords(text)
    setWords(nextWords)
    setFilename(file.name)
    setChunkIndex(0)
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
            <span className="controlLabel">Text file</span>
            <input
              className="fileInput"
              type="file"
              accept=".txt,text/plain"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0]
                if (!file) return
                void onPickFile(file)
                // allow re-uploading the same file
                e.currentTarget.value = ''
              }}
            />
          </label>

          <label className="control">
            <span className="controlLabel">Words / chunk</span>
            <input
              className="numberInput"
              type="number"
              inputMode="numeric"
              min={5}
              max={200}
              value={wordsPerChunk}
              onChange={(e) => {
                const n = Number(e.currentTarget.value)
                if (!Number.isFinite(n)) return
                setWordsPerChunk(clamp(Math.trunc(n), 5, 200))
              }}
            />
          </label>

          <div className="buttons">
            <button
              type="button"
              className="btn"
              onClick={() => setChunkIndex((i) => Math.max(0, i - 1))}
              disabled={!hasPrev}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => setChunkIndex((i) => Math.min(chunkCount - 1, i + 1))}
              disabled={!hasNext}
            >
              Next
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setZenMode(true)}
              disabled={!hasText}
              title="Enter zen mode (Esc to exit)"
            >
              Zen
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        {!hasText ? (
          <div className="empty">
            <h1 className="emptyTitle">Upload a .txt file</h1>
            <p className="emptyBody">
              Set <strong>Words / chunk</strong> (default {DEFAULT_WORDS_PER_CHUNK}). Press <kbd>Space</kbd> to advance one chunk.
            </p>
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
                  <kbd>Space</kbd> next
                </span>
              </div>
            </div>

            <section className="reader" aria-label="Bionic reading area">
              <div className="chunk" aria-live="polite" aria-atomic="true">
                <BionicChunk words={currentWords} />
              </div>
            </section>
          </>
        )}
      </main>

      {zenMode && hasText && (
        <div className="zenOverlay" onClick={() => setZenMode(false)}>
          <div className="zenContent">
            <BionicChunk words={currentWords} />
          </div>
          <div className="zenProgress">
            {chunkIndex + 1} / {chunkCount}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
