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
  const [fullscreenMode, setFullscreenMode] = useState<boolean>(false)

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
    }

    window.addEventListener('keydown', onKeyDown, { passive: false })
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chunkCount, hasText, fullscreenMode])

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
              onClick={() => setFullscreenMode(true)}
              disabled={!hasText}
              title="Enter fullscreen mode (Esc to exit)"
            >
              Fullscreen
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
                  <kbd>Space</kbd> or tap to advance
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
