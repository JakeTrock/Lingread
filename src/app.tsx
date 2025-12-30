import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

type Track = {
  id: string;
  name: string;
  rawText: string;
  words: string[];
  fingerprint?: string; // sha256(rawText) hex
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

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.slice(i, i + chunk));
  }
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(s: string): Uint8Array {
  const padLen = (4 - (s.length % 4)) % 4;
  const padded = (s + '='.repeat(padLen)).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

type ResumePayloadV1 = {
  v: 1;
  fp: string; // sha256 hex of the track text
  i: number; // word index within this track
  n?: string; // filename (optional)
  w?: string; // current word (optional, for human sanity check)
};

function encodeResumeHash(payload: ResumePayloadV1): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  return `sr1.${base64UrlEncode(bytes)}`;
}

function decodeResumeHash(hash: string): ResumePayloadV1 {
  const trimmed = hash.trim();
  if (!trimmed.startsWith('sr1.')) throw new Error('Not a speedreader v1 hash.');
  const b64u = trimmed.slice('sr1.'.length);
  const bytes = base64UrlDecode(b64u);
  const json = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(json) as ResumePayloadV1;
  if (!parsed || parsed.v !== 1) throw new Error('Unsupported hash version.');
  if (typeof parsed.fp !== 'string' || !parsed.fp) throw new Error('Hash missing fingerprint.');
  if (typeof parsed.i !== 'number' || !Number.isFinite(parsed.i)) throw new Error('Hash missing index.');
  return parsed;
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

function ResumeHashDialog(props: {
  track: Track;
  effectiveIndex: number;
  globalMaxLen: number;
  onApplyGlobalIndex: (index: number) => void;
}) {
  const { track, effectiveIndex, globalMaxLen, onApplyGlobalIndex } = props;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [pasteValue, setPasteValue] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const currentWord = track.words[effectiveIndex] ?? '';
  const canHash = Boolean(track.fingerprint && track.words.length);

  const currentHash = useMemo(() => {
    if (!track.fingerprint || !track.words.length) return '';
    return encodeResumeHash({
      v: 1,
      fp: track.fingerprint,
      i: effectiveIndex,
      n: track.name || undefined,
      w: currentWord || undefined,
    });
  }, [track.fingerprint, track.words.length, track.name, effectiveIndex, currentWord]);

  function open() {
    setStatus(null);
    setPasteValue('');
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  async function copyCurrent() {
    if (!currentHash) return;
    try {
      await navigator.clipboard.writeText(currentHash);
      setStatus('Copied to clipboard.');
    } catch {
      setStatus('Could not access clipboard. Select and copy manually.');
    }
  }

  function applyPasted() {
    setStatus(null);
    if (!track.fingerprint) {
      setStatus('Load a .txt file for this track first.');
      return;
    }
    let payload: ResumePayloadV1;
    try {
      payload = decodeResumeHash(pasteValue);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Invalid hash.');
      return;
    }
    if (payload.fp !== track.fingerprint) {
      setStatus('This hash does not match the currently loaded text in this track.');
      return;
    }
    const clamped = clamp(Math.trunc(payload.i), 0, Math.max(0, globalMaxLen - 1));
    onApplyGlobalIndex(clamped);
    setStatus(`Resumed to word index ${clamped + 1}.`);
  }

  return (
    <>
      <button class="btn" onClick={open} disabled={!canHash} title={canHash ? 'Copy/paste a resume hash' : 'Load a .txt file first'}>
        Resume hash
      </button>

      <dialog ref={dialogRef} class="resume-dialog" onClose={() => setStatus(null)}>
        <div class="resume-dialog-inner">
          <div class="resume-dialog-head">
            <strong>Resume hash</strong>
            <button class="btn" onClick={close} title="Close">
              Close
            </button>
          </div>

          <div class="resume-dialog-body">
            <div style={{ display: 'grid', gap: 6 }}>
              <label>Current (updates as you progress)</label>
              <textarea class="mono" rows={3} readOnly value={currentHash || 'Load a .txt file to generate a hash.'} />
              <div class="control-row">
                <button class="btn primary" onClick={copyCurrent} disabled={!currentHash}>
                  Copy
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              <label>Paste a hash to resume this track</label>
              <textarea
                class="mono"
                rows={3}
                placeholder="Paste sr1.… here"
                value={pasteValue}
                onInput={(e) => setPasteValue((e.currentTarget as HTMLTextAreaElement).value)}
              />
              <div class="control-row">
                <button class="btn primary" onClick={applyPasted} disabled={!pasteValue.trim()}>
                  Apply
                </button>
              </div>
            </div>

            {status ? <div class="hint" style={{ marginTop: 0 }}>{status}</div> : null}
          </div>
        </div>
      </dialog>
    </>
  );
}

export function App() {
  const [tracks, setTracks] = useState<Track[]>(() => [
    { id: id(), name: 'Track 1', rawText: '', words: [], fingerprint: undefined },
  ]);
  const [wordIndex, setWordIndex] = useState(0);

  const [wpm, setWpm] = useState<number>(300);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);

  const intervalMs = useMemo(() => Math.round(60000 / clamp(wpm, 60, 2000)), [wpm]);
  const maxLen = useMemo(() => tracks.reduce((m, t) => Math.max(m, t.words.length), 0), [tracks]);
  const canAdvance = wordIndex < Math.max(0, maxLen - 1);
  const canRewind = wordIndex > 0;

  const timerRef = useRef<number | null>(null);

  function addTrack() {
    setTracks((prev) => [
      ...prev,
      { id: id(), name: `Track ${prev.length + 1}`, rawText: '', words: [], fingerprint: undefined },
    ]);
  }

  function removeTrack(trackId: string) {
    setTracks((prev) => {
      const next = prev.filter((t) => t.id !== trackId);
      return next.length ? next : [{ id: id(), name: 'Track 1', rawText: '', words: [], fingerprint: undefined }];
    });
  }

  async function onFile(trackId: string, file: File | null) {
    if (!file) return;
    const text = await file.text();
    const fp = await sha256Hex(text);
    setTracks((prev) =>
      prev.map((t) =>
        t.id === trackId
          ? {
              ...t,
              name: file.name,
              rawText: text,
              words: tokenize(text),
              fingerprint: fp,
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
    if (!isPlaying || isSeeking) return;
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
  }, [isPlaying, isSeeking, intervalMs, maxLen]);

  // Clamp the global index if track set/length changes.
  useEffect(() => {
    setWordIndex((i) => {
      if (!maxLen) return 0;
      return Math.min(i, Math.max(0, maxLen - 1));
    });
  }, [maxLen]);

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

  useEffect(() => {
    if (isPlaying && !anyLoaded) setIsPlaying(false);
  }, [isPlaying, anyLoaded]);

  const progressPct = useMemo(() => {
    if (!maxLen) return 0;
    if (maxLen <= 1) return 100;
    return Math.round((wordIndex / (maxLen - 1)) * 100);
  }, [wordIndex, maxLen]);

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
          const effectiveIndex = t.words.length ? clamp(wordIndex, 0, Math.max(0, t.words.length - 1)) : 0;
          const current = t.words[effectiveIndex] ?? '';
          return (
            <div class="panel track" key={t.id}>
              <div class="track-head">
                <div class="track-title">
                  <strong>{t.name || `Track ${idx + 1}`}</strong>
                  <span>
                    {t.words.length ? `${t.words.length.toLocaleString()} words` : 'No file loaded'}
                  </span>
                </div>
                <div class="control-row">
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    onChange={(e) => onFile(t.id, (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
                  />
                  <ResumeHashDialog
                    track={t}
                    effectiveIndex={effectiveIndex}
                    globalMaxLen={maxLen}
                    onApplyGlobalIndex={(i) => setWordIndex(i)}
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

      <div class="bottom-bar panel" aria-label="Progress">
        <div class="bottom-bar-row">
          <span class="badge">Progress {progressPct}%</span>
          <span class="badge">{isSeeking ? 'Seeking…' : isPlaying ? 'Playing' : 'Paused'}</span>
        </div>
        <input
          class="progress-slider"
          type="range"
          min={0}
          max={Math.max(0, maxLen - 1)}
          step={1}
          value={Math.min(wordIndex, Math.max(0, maxLen - 1))}
          disabled={!anyLoaded || maxLen <= 1}
          onPointerDown={() => setIsSeeking(true)}
          onPointerUp={() => setIsSeeking(false)}
          onPointerCancel={() => setIsSeeking(false)}
          onInput={(e) => setWordIndex((e.currentTarget as HTMLInputElement).valueAsNumber || 0)}
        />
      </div>
    </div>
  );
}

