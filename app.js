/**
 * Multi-track speedreader (no dependencies).
 * - Multiple tracks (text uploads) stacked vertically
 * - Unified WPM (single timer) advances all tracks together
 * - Manual next/prev/reset and play/pause
 */

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function safeInt(value, fallback) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function tokenize(text) {
  // Keep punctuation attached to tokens; collapse whitespace.
  const matches = String(text).match(/\S+/g);
  return matches ? matches : [];
}

function choosePivotIndex(word) {
  // Simple ORP-ish heuristic: highlight around 35% into the word.
  const len = word.length;
  if (len <= 1) return 0;
  return clamp(Math.floor(len * 0.35), 0, len - 1);
}

function renderWordWithPivot(word) {
  if (!word) return "";
  const i = choosePivotIndex(word);
  const left = word.slice(0, i);
  const pivot = word[i] || "";
  const right = word.slice(i + 1);
  return `${escapeHtml(left)}<span class="pivot">${escapeHtml(pivot)}</span>${escapeHtml(right)}`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const PRESET_WPMS = [200, 250, 300, 350, 400, 500, 600, 800];

const els = {
  wpmPreset: document.getElementById("wpmPreset"),
  wpmInput: document.getElementById("wpmInput"),
  prevBtn: document.getElementById("prevBtn"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  nextBtn: document.getElementById("nextBtn"),
  resetBtn: document.getElementById("resetBtn"),
  addTrackBtn: document.getElementById("addTrackBtn"),
  tracksList: document.getElementById("tracksList"),
  readerStack: document.getElementById("readerStack"),
  statusPill: document.getElementById("statusPill"),
};

const state = {
  wpm: 300,
  isPlaying: false,
  timerId: null,
  nextTrackId: 1,
  tracks: [],
};

function createTrack() {
  const id = state.nextTrackId++;
  return {
    id,
    name: `Track ${id}`,
    fileName: null,
    words: [],
    idx: 0,
    loaded: false,
  };
}

function addTrack() {
  state.tracks.push(createTrack());
  render();
}

function removeTrack(trackId) {
  const i = state.tracks.findIndex((t) => t.id === trackId);
  if (i >= 0) state.tracks.splice(i, 1);
  if (state.tracks.length === 0) addTrack();
  render();
  ensurePlaybackStateIsValid();
}

function setTrackWords(trackId, fileName, words) {
  const track = state.tracks.find((t) => t.id === trackId);
  if (!track) return;
  track.fileName = fileName || null;
  track.words = Array.isArray(words) ? words : [];
  track.idx = 0;
  track.loaded = track.words.length > 0;
  render();
  ensurePlaybackStateIsValid();
}

function getAnyLoadedTrack() {
  return state.tracks.some((t) => t.loaded);
}

function getAllAtEnd() {
  const loadedTracks = state.tracks.filter((t) => t.loaded);
  if (loadedTracks.length === 0) return true;
  return loadedTracks.every((t) => t.idx >= t.words.length - 1);
}

function getAllAtStart() {
  const loadedTracks = state.tracks.filter((t) => t.loaded);
  if (loadedTracks.length === 0) return true;
  return loadedTracks.every((t) => t.idx <= 0);
}

function setWpm(nextWpm, { source } = { source: "input" }) {
  const normalized = clamp(safeInt(nextWpm, state.wpm), 50, 1500);
  state.wpm = normalized;

  // Sync UI controls
  els.wpmInput.value = String(state.wpm);
  if (PRESET_WPMS.includes(state.wpm)) {
    els.wpmPreset.value = String(state.wpm);
  } else {
    els.wpmPreset.value = "custom";
  }

  if (state.isPlaying) restartTimer();
  updateStatusPill();
}

function msPerWord() {
  return Math.round(60000 / state.wpm);
}

function ensurePlaybackStateIsValid() {
  if (!getAnyLoadedTrack() && state.isPlaying) pause();
  updateControlsEnabledState();
  updateStatusPill();
}

function updateControlsEnabledState() {
  const anyLoaded = getAnyLoadedTrack();
  els.playPauseBtn.disabled = !anyLoaded;
  els.nextBtn.disabled = !anyLoaded;
  els.prevBtn.disabled = !anyLoaded;
  els.resetBtn.disabled = !anyLoaded;

  if (!anyLoaded) return;
  els.prevBtn.disabled = getAllAtStart();
  els.nextBtn.disabled = getAllAtEnd();
}

function updateStatusPill() {
  const anyLoaded = getAnyLoadedTrack();
  let label = "Idle";
  if (!anyLoaded) {
    label = "Upload text to begin";
  } else if (state.isPlaying) {
    label = `Playing • ${state.wpm} wpm`;
  } else {
    label = `Paused • ${state.wpm} wpm`;
  }

  els.statusPill.textContent = label;
  els.statusPill.classList.toggle("playing", state.isPlaying);
}

function advance(step) {
  const delta = safeInt(step, 1);
  const loadedTracks = state.tracks.filter((t) => t.loaded);
  if (loadedTracks.length === 0) return;

  for (const t of loadedTracks) {
    const next = clamp(t.idx + delta, 0, Math.max(0, t.words.length - 1));
    t.idx = next;
  }

  renderReader();
  updateControlsEnabledState();

  if (state.isPlaying && getAllAtEnd()) {
    pause();
  }
}

function resetAll() {
  for (const t of state.tracks) t.idx = 0;
  renderReader();
  updateControlsEnabledState();
  if (state.isPlaying) pause();
}

function play() {
  if (!getAnyLoadedTrack()) return;
  if (state.isPlaying) return;
  state.isPlaying = true;
  els.playPauseBtn.textContent = "Pause";
  restartTimer();
  updateControlsEnabledState();
  updateStatusPill();
}

function pause() {
  if (!state.isPlaying) return;
  state.isPlaying = false;
  els.playPauseBtn.textContent = "Play";
  stopTimer();
  updateControlsEnabledState();
  updateStatusPill();
}

function togglePlayPause() {
  if (state.isPlaying) pause();
  else play();
}

function stopTimer() {
  if (state.timerId != null) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function restartTimer() {
  stopTimer();
  // Use interval for consistent unified stepping.
  state.timerId = window.setInterval(() => {
    advance(1);
  }, msPerWord());
}

function render() {
  renderTracksList();
  renderReader();
  updateControlsEnabledState();
  updateStatusPill();
}

function renderTracksList() {
  els.tracksList.innerHTML = "";

  for (const track of state.tracks) {
    const wrap = document.createElement("div");
    wrap.className = "track";

    const top = document.createElement("div");
    top.className = "track-top";

    const title = document.createElement("div");
    title.className = "track-title";
    const strong = document.createElement("strong");
    strong.textContent = track.name;
    const meta = document.createElement("span");
    meta.textContent = track.loaded
      ? `${track.fileName || "Loaded"} • ${track.words.length.toLocaleString()} words`
      : "No file loaded";

    title.appendChild(strong);
    title.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "track-actions";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn subtle";
    removeBtn.textContent = "Remove";
    removeBtn.title = "Remove this track";
    removeBtn.addEventListener("click", () => removeTrack(track.id));

    actions.appendChild(removeBtn);
    top.appendChild(title);
    top.appendChild(actions);

    const input = document.createElement("input");
    input.className = "file-input";
    input.type = "file";
    input.accept = ".txt,text/plain";
    input.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const words = tokenize(text);
        setTrackWords(track.id, file.name, words);
      } catch (err) {
        // If read fails, mark as not loaded.
        setTrackWords(track.id, file.name, []);
        // eslint-disable-next-line no-console
        console.error(err);
      }
    });

    wrap.appendChild(top);
    wrap.appendChild(input);
    els.tracksList.appendChild(wrap);
  }
}

function renderReader() {
  els.readerStack.innerHTML = "";

  for (const track of state.tracks) {
    const row = document.createElement("div");
    row.className = "reader-row";

    const header = document.createElement("div");
    header.className = "reader-row-header";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = track.fileName ? `${track.name} • ${track.fileName}` : track.name;

    const progress = document.createElement("div");
    progress.className = "progress";
    if (track.loaded) {
      progress.textContent = `${(track.idx + 1).toLocaleString()} / ${track.words.length.toLocaleString()}`;
    } else {
      progress.textContent = "—";
    }

    header.appendChild(name);
    header.appendChild(progress);

    const wordEl = document.createElement("div");
    wordEl.className = "word";
    if (!track.loaded) {
      wordEl.classList.add("placeholder");
      wordEl.textContent = "Upload a .txt file to load this track";
    } else {
      wordEl.innerHTML = renderWordWithPivot(track.words[track.idx] || "");
    }

    row.appendChild(header);
    row.appendChild(wordEl);
    els.readerStack.appendChild(row);
  }
}

function wireEvents() {
  els.addTrackBtn.addEventListener("click", () => addTrack());

  els.wpmPreset.addEventListener("change", (e) => {
    const v = e.target.value;
    if (v === "custom") {
      setWpm(els.wpmInput.value, { source: "preset" });
      els.wpmInput.focus();
      return;
    }
    setWpm(v, { source: "preset" });
  });

  els.wpmInput.addEventListener("change", (e) => {
    setWpm(e.target.value, { source: "input" });
  });
  els.wpmInput.addEventListener("input", (e) => {
    // Live updates feel nicer; keep it safe/cheap.
    setWpm(e.target.value, { source: "input" });
  });

  els.playPauseBtn.addEventListener("click", () => togglePlayPause());
  els.nextBtn.addEventListener("click", () => advance(1));
  els.prevBtn.addEventListener("click", () => advance(-1));
  els.resetBtn.addEventListener("click", () => resetAll());

  window.addEventListener("keydown", (e) => {
    // Don't steal keystrokes while typing in inputs.
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (e.code === "Space") {
      e.preventDefault();
      togglePlayPause();
      return;
    }
    if (e.code === "ArrowRight") {
      e.preventDefault();
      advance(1);
      return;
    }
    if (e.code === "ArrowLeft") {
      e.preventDefault();
      advance(-1);
      return;
    }
  });
}

function init() {
  // Start with one track; user can add more before beginning.
  state.tracks = [createTrack()];
  wireEvents();
  setWpm(state.wpm);
  render();
}

init();

