import './App.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  exportAnnotationsAsText,
  getStoredAnnotations,
  saveAnnotations,
  sanitizeExportFilename,
  type Annotation,
} from './lib/annotations'
import { BionicChunk } from './lib/bionic'
import { splitIntoWords } from './lib/text'

const DEFAULT_WORDS_PER_CHUNK = 40
const STORAGE_KEY_PREFIX = 'lingread:'

// Inline CSS for PiP document (matches fullscreen look)
const PIP_DOCUMENT_STYLES = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px; min-height: 100vh; background: #f5f0e1; font-family: system-ui, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  #pip-root { width: 100%; max-width: 100%; }
  .pipContent { text-align: center; font-size: clamp(18px, 4vw, 28px); line-height: 1.7; letter-spacing: 0.02em;
    word-wrap: break-word; overflow-wrap: break-word; }
  .pipContent:focus { outline: none; }
  .pipContent:focus-visible { outline: none; }
  .pipContent .bionicBold { color: #4a4a4a; font-weight: 700; }
  .pipContent .bionicRest { color: #7a7a7a; font-weight: 400; }
  .token { white-space: pre-wrap; }
  .pipProgress { margin-top: 8px; font-size: 12px; color: #a0a0a0; }
`

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
  const [isPipOpen, setIsPipOpen] = useState<boolean>(false)
  const [fileHash, setFileHash] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [annotationDraft, setAnnotationDraft] = useState('')
  const [isEditingAnnotation, setIsEditingAnnotation] = useState(false)
  const pipWindowRef = useRef<Window | null>(null)
  const pipRootRef = useRef<ReturnType<typeof createRoot> | null>(null)

  const chunkCount = useMemo(() => {
    if (words.length === 0) return 0
    return Math.max(1, Math.ceil(words.length / wordsPerChunk))
  }, [words.length, wordsPerChunk])

  const currentWords = useMemo(() => {
    const start = chunkIndex * wordsPerChunk
    return words.slice(start, start + wordsPerChunk)
  }, [chunkIndex, words, wordsPerChunk])

  const currentChunkAnnotation = useMemo(
    () => annotations.find((a) => a.chunkIndex === chunkIndex),
    [annotations, chunkIndex]
  )

  const hasText = words.length > 0
  const hasPrev = hasText && chunkIndex > 0
  const hasNext = hasText && chunkIndex < chunkCount - 1

  useEffect(() => {
    if (!hasText) return
    setChunkIndex((idx) => clamp(idx, 0, Math.max(0, chunkCount - 1)))
  }, [chunkCount, hasText])

  // Close annotation form when switching chunks
  useEffect(() => {
    setIsEditingAnnotation(false)
  }, [chunkIndex])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Escape exits fullscreen or closes PiP
      if (e.code === 'Escape') {
        const pip = pipWindowRef.current
        if (pip && !pip.closed) {
          e.preventDefault()
          pip.close()
          return
        }
        if (fullscreenMode) {
          e.preventDefault()
          setFullscreenMode(false)
          return
        }
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

  // PiP window sends chunk nav via postMessage
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      const d = e.data as { type?: string; direction?: number } | undefined
      if (d?.type !== 'lingread:chunk' || typeof d.direction !== 'number') return
      setChunkIndex((i) => clamp(i + d.direction!, 0, chunkCount - 1))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [chunkCount])

  // Sync current chunk (and progress) into PiP when open
  useEffect(() => {
    if (!isPipOpen) return
    const pip = pipWindowRef.current
    const root = pipRootRef.current
    if (!pip || pip.closed || !root) return
    const handlePipKeyDown = (e: React.KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        if (hasNext) setChunkIndex((i) => Math.min(i + 1, chunkCount - 1))
      } else if (e.code === 'Backspace') {
        e.preventDefault()
        if (hasPrev) setChunkIndex((i) => Math.max(0, i - 1))
      } else if (e.code === 'Escape') {
        e.preventDefault()
        pipWindowRef.current?.close()
      }
    }
    root.render(
      <>
        <div
          className="pipContent"
          role="button"
          tabIndex={0}
          style={{ cursor: hasNext ? 'pointer' : 'default' }}
          onClick={() => hasNext && setChunkIndex((i) => Math.min(i + 1, chunkCount - 1))}
          onKeyDown={handlePipKeyDown}
        >
          <BionicChunk words={currentWords} />
        </div>
        <div className="pipProgress">
          {chunkIndex + 1} / {chunkCount}
        </div>
      </>
    )
  }, [isPipOpen, currentWords, chunkIndex, chunkCount, hasNext, hasPrev])

  async function openPip() {
    const pip = pipWindowRef.current
    if (pip && !pip.closed) {
      pip.close()
      return
    }
    const api = window.documentPictureInPicture
    if (!api) return
    try {
      const pipWindow = await api.requestWindow({ width: 420, height: 280 })
      pipWindowRef.current = pipWindow
      setIsPipOpen(true)

      pipWindow.document.title = 'Lingread – Speed reading'
      const style = pipWindow.document.createElement('style')
      style.textContent = PIP_DOCUMENT_STYLES
      pipWindow.document.head.appendChild(style)
      const container = pipWindow.document.createElement('div')
      container.id = 'pip-root'
      pipWindow.document.body.appendChild(container)

      const root = createRoot(container)
      pipRootRef.current = root
      root.render(
        <>
          <div
            className="pipContent"
            role="button"
            tabIndex={0}
            style={{ cursor: hasNext ? 'pointer' : 'default' }}
            onClick={() => hasNext && setChunkIndex((i) => Math.min(i + 1, chunkCount - 1))}
            onKeyDown={(e) => {
              if (e.code === 'Space') {
                e.preventDefault()
                if (hasNext) setChunkIndex((i) => Math.min(i + 1, chunkCount - 1))
              } else if (e.code === 'Backspace') {
                e.preventDefault()
                if (hasPrev) setChunkIndex((i) => Math.max(0, i - 1))
              } else if (e.code === 'Escape') {
                e.preventDefault()
                pipWindowRef.current?.close()
              }
            }}
          >
            <BionicChunk words={currentWords} />
          </div>
          <div className="pipProgress">
            {chunkIndex + 1} / {chunkCount}
          </div>
        </>
      )

      // Focus the content div so Space/Backspace work immediately without clicking first
      setTimeout(() => (pipWindow.document.querySelector('.pipContent') as HTMLElement | null)?.focus(), 0)

      // Fallback: document-level keydown in case focus is elsewhere in the PiP window
      const origin = window.location.origin
      pipWindow.document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.code === 'Space') {
          e.preventDefault()
          window.opener?.postMessage({ type: 'lingread:chunk', direction: 1 }, origin)
        } else if (e.code === 'Backspace') {
          e.preventDefault()
          window.opener?.postMessage({ type: 'lingread:chunk', direction: -1 }, origin)
        } else if (e.code === 'Escape') {
          e.preventDefault()
          pipWindow.close()
        }
      })

      pipWindow.addEventListener('pagehide', () => {
        root.unmount()
        pipWindowRef.current = null
        pipRootRef.current = null
        setIsPipOpen(false)
      })
    } catch {
      // Not supported, no user gesture, or user denied
    }
  }

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
    setAnnotations(getStoredAnnotations(hash))
    setIsEditingAnnotation(false)
    setAnnotationDraft('')

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

  function addOrUpdateAnnotation(text: string) {
    if (!fileHash || text.trim() === '') return
    const next: Annotation[] = annotations
      .filter((a) => a.chunkIndex !== chunkIndex)
      .concat({ chunkIndex, text: text.trim(), createdAt: new Date().toISOString() })
    setAnnotations(next)
    saveAnnotations(fileHash, next)
    setAnnotationDraft('')
    setIsEditingAnnotation(false)
  }

  function deleteCurrentAnnotation() {
    if (!fileHash) return
    const next = annotations.filter((a) => a.chunkIndex !== chunkIndex)
    setAnnotations(next)
    saveAnnotations(fileHash, next)
    setAnnotationDraft('')
    setIsEditingAnnotation(false)
  }

  function exportAnnotationsToFile() {
    if (!fileHash || !filename || annotations.length === 0) return
    const getChunkWords = (i: number) =>
      words.slice(i * wordsPerChunk, (i + 1) * wordsPerChunk)
    const text = exportAnnotationsAsText(
      filename,
      annotations,
      getChunkWords
    )
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = sanitizeExportFilename(filename)
    a.click()
    URL.revokeObjectURL(url)
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
            <button
              type="button"
              className="btn"
              onClick={() => void openPip()}
              disabled={!hasText || !('documentPictureInPicture' in window)}
              title="Speed reading window (Picture-in-Picture). Space next, Backspace back, Esc to close."
            >
              PiP
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
                <button
                  type="button"
                  className="pillBtn"
                  onClick={exportAnnotationsToFile}
                  disabled={annotations.length === 0}
                  title="Export all annotations as a text file"
                >
                  Export annotations
                </button>
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
              {!currentChunkAnnotation && !isEditingAnnotation && (
                <button
                  type="button"
                  className="readerCorner"
                  onClick={() => {
                    setAnnotationDraft('')
                    setIsEditingAnnotation(true)
                  }}
                  title="Add note for this chunk"
                  aria-label="Add note for this chunk"
                />
              )}
              <div
                className="chunk"
                aria-live="polite"
                aria-atomic="true"
                onClick={() => hasNext && setChunkIndex((i) => i + 1)}
                style={{ cursor: hasNext ? 'pointer' : 'default' }}
              >
                <BionicChunk words={currentWords} />
              </div>
              {(isEditingAnnotation || currentChunkAnnotation) && (
                <div className="annotationBlock" aria-label="Annotation for current chunk">
                  {isEditingAnnotation ? (
                    <div className="annotationForm">
                      <textarea
                        className="annotationTextarea"
                        value={annotationDraft}
                        onChange={(e) => setAnnotationDraft(e.currentTarget.value)}
                        placeholder="Add a note for this chunk..."
                        rows={3}
                        autoFocus
                      />
                      <div className="annotationFormActions">
                        <button
                          type="button"
                          className="btn btnPrimary"
                          onClick={() => addOrUpdateAnnotation(annotationDraft)}
                          disabled={annotationDraft.trim() === ''}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setIsEditingAnnotation(false)
                            setAnnotationDraft(currentChunkAnnotation?.text ?? '')
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : currentChunkAnnotation ? (
                    <div className="annotationDisplay">
                      <p className="annotationText">{currentChunkAnnotation.text}</p>
                      <div className="annotationFormActions">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setAnnotationDraft(currentChunkAnnotation.text)
                            setIsEditingAnnotation(true)
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={deleteCurrentAnnotation}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
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
