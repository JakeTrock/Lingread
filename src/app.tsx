import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

type Track = {
  id: string;
  name: string;
  rawText: string;
  words: string[];
};

const PRESET_WPMS = [150, 200, 250, 300, 350, 400, 500, 650, 800];

function tokenize(text: string): string[] {
  // Keep it simple: split on whitespace; collapse multiple spaces/newlines.
  return text
    .replace(/\u00a0/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function id(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function renderOrpWord(word: string) {
  if (!word) return null;
  const clean = word.replace(/[^\p{L}\p{N}']/gu, '');
  const len = clean.length || word.length;
  // Rough ORP position heuristic (1-indexed)
  const orp1 = len <= 1 ? 1 : len <= 5 ? 2 : len <= 9 ? 3 : 4;
  const orp = clamp(orp1 - 1, 0, Math.max(0, word.length - 1));
  const left = word.slice(0, orp);
  const mid = word.slice(orp, orp + 1);
  const right = word.slice(orp + 1);
  return (
    <span>
      {left}
      <span class="orp">{mid}</span>
      {right}
    </span>
  );
}

export function App() {
  const [tracks, setTracks] = useState<Track[]>(() => [
    { id: id(), name: 'Track 1', rawText: '', words: [] },
  ]);
  const [wordIndex, setWordIndex] = useState(0);

  const [wpm, setWpm] = useState<number>(300);
  const [isPlaying, setIsPlaying] = useState(false);

  const intervalMs = useMemo(() => Math.round(60000 / clamp(wpm, 60, 2000)), [wpm]);
  const maxLen = useMemo(() => tracks.reduce((m, t) => Math.max(m, t.words.length), 0), [tracks]);
  const canAdvance = wordIndex < Math.max(0, maxLen - 1);
  const canRewind = wordIndex > 0;

  const timerRef = useRef<number | null>(null);

  function addTrack() {
    setTracks((prev) => [...prev, { id: id(), name: `Track ${prev.length + 1}`, rawText: '', words: [] }]);
  }

  function removeTrack(trackId: string) {
    setTracks((prev) => {
      const next = prev.filter((t) => t.id !== trackId);
      return next.length ? next : [{ id: id(), name: 'Track 1', rawText: '', words: [] }];
    });
  }

  async function onFile(trackId: string, file: File | null) {
    if (!file) return;
    const text = await file.text();
    setTracks((prev) =>
      prev.map((t) =>
        t.id === trackId
          ? {
              ...t,
              name: file.name,
              rawText: text,
              words: tokenize(text),
            }
          : t,
      ),
    );
    setWordIndex(0);
  }

  function nextWord() {
    setWordIndex((i) => {
      if (!maxLen) return 0;
      return Math.min(i + 1, Math.max(0, maxLen - 1));
    });
  }

  function prevWord() {
    setWordIndex((i) => Math.max(0, i - 1));
  }

  // Playback timer
  useEffect(() => {
    if (!isPlaying) return;
    if (timerRef.current != null) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setWordIndex((i) => {
        const next = maxLen ? Math.min(i + 1, Math.max(0, maxLen - 1)) : 0;
        // Auto-stop at end
        if (maxLen && next >= maxLen - 1) {
          window.setTimeout(() => setIsPlaying(false), 0);
        }
        return next;
      });
    }, intervalMs);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [isPlaying, intervalMs, maxLen]);

  // Keyboard shortcuts: Space play/pause, ArrowRight next, ArrowLeft prev
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
      if (e.key === 'ArrowRight') nextWord();
      if (e.key === 'ArrowLeft') prevWord();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxLen]);

  const anyLoaded = tracks.some((t) => t.words.length > 0);

  return (
    <div class="container">
      <div class="topbar">
        <div class="brand">
          <h1>Speedreader</h1>
          <span class="badge">multi-track • solarized</span>
        </div>
        <a href="https://github.com/" target="_blank" rel="noreferrer" style={{ display: 'none' }}>
          {/* placeholder */}
        </a>
      </div>

      <div class="panel controls">
        <div class="control-row">
          <button class={`btn ${isPlaying ? '' : 'primary'}`} onClick={() => setIsPlaying((p) => !p)} disabled={!anyLoaded}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button class="btn" onClick={prevWord} disabled={!anyLoaded || !canRewind}>
            Prev
          </button>
          <button class="btn primary" onClick={nextWord} disabled={!anyLoaded || !canAdvance}>
            Next
          </button>
          <button class="btn" onClick={() => setWordIndex(0)} disabled={!anyLoaded || wordIndex === 0}>
            Restart
          </button>
        </div>

        <div class="control-row" style={{ justifyContent: 'flex-start' }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <label for="wpmPreset">WPM preset</label>
            <select
              id="wpmPreset"
              value={String(wpm)}
              onChange={(e) => setWpm(clamp(parseInt((e.currentTarget as HTMLSelectElement).value, 10) || 300, 60, 2000))}
            >
              {PRESET_WPMS.map((p) => (
                <option key={p} value={p}>
                  {p} wpm
                </option>
              ))}
              {!PRESET_WPMS.includes(wpm) ? (
                <option key="custom" value={wpm}>
                  {wpm} wpm (custom)
                </option>
              ) : null}
            </select>
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <label for="wpmNumber">WPM</label>
            <input
              id="wpmNumber"
              type="number"
              inputMode="numeric"
              min={60}
              max={2000}
              step={10}
              value={wpm}
              onInput={(e) => setWpm(clamp((e.currentTarget as HTMLInputElement).valueAsNumber || 300, 60, 2000))}
            />
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <label>Timing</label>
            <div class="badge">{intervalMs} ms/word</div>
          </div>
        </div>
      </div>

      <div class="tracks">
        {tracks.map((t, idx) => {
          const current = t.words[wordIndex] ?? '';
          const progress = t.words.length ? `${Math.min(wordIndex + 1, t.words.length)}/${t.words.length}` : '—';
          return (
            <div class="panel track" key={t.id}>
              <div class="track-head">
                <div class="track-title">
                  <strong>{t.name || `Track ${idx + 1}`}</strong>
                  <span>
                    {t.words.length ? `${t.words.length.toLocaleString()} words` : 'No file loaded'} • progress {progress}
                  </span>
                </div>
                <div class="control-row">
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    onChange={(e) => onFile(t.id, (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
                  />
                  <button class="btn danger" onClick={() => removeTrack(t.id)} title="Remove track">
                    Remove
                  </button>
                </div>
              </div>

              <div class="reader">
                <div class="focus-word" aria-live="polite" aria-atomic="true">
                  {current ? renderOrpWord(current) : <span style={{ color: 'var(--muted)' }}>Load a .txt file…</span>}
                </div>
                <div class="meta">
                  <span>Unified index: {maxLen ? `${wordIndex + 1}/${maxLen}` : '—'}</span>
                  <span>•</span>
                  <span>{isPlaying ? 'Playing' : 'Paused'}</span>
                </div>
              </div>
            </div>
          );
        })}

        <div class="control-row">
          <button class="btn primary" onClick={addTrack} title="Add another track">
            + Add track
          </button>
        </div>

        <div class="hint">
          Tip: press <strong>Space</strong> to play/pause, <strong>→</strong> for next, <strong>←</strong> for previous. All tracks advance
          together at the same WPM.
        </div>
      </div>
    </div>
  );
}

