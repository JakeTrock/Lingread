# Speedreader (multi-track)

A dependency-free, local web speedreader with:

- Variable **WPM** (preset dropdown + custom number input)
- **Play/Pause**, **Prev/Next**, **Reset**
- **Multiple tracks** (add as many text uploads as you want) displayed in a vertical stack
- **Unified progression**: Next/Play advances all loaded tracks together at the same WPM
- Solarized (dark) theme

## Run

Any static file server works. For example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

You can also open `index.html` directly, but some browsers are stricter with local file permissions.

## Use

1. Click **+ Track** to add multiple tracks.
2. Upload a `.txt` file for each track.
3. Press **Play** (or Space) to auto-advance at the chosen WPM, or press **Next** to step all tracks together.

