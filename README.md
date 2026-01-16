# Lingread — Solarized Bionic Reading (Vite)

Upload a `.txt` file, set a **words-per-chunk** rate (default **40**), and press **Space** to advance one chunk at a time.

## Run it

```bash
npm install
npm run dev
```

## Controls

- **Upload**: pick a `.txt` file using the “Text file” input
- **Words / chunk**: number input (clamped to 5–200)
- **Advance**: press **Space** to go to the next chunk
- **Buttons**: use **Prev / Next** as needed

## Highlight technique

Words are rendered with a “bionic” emphasis (Renato Casutt–style): the beginning of each word is bolded to guide the eye while keeping the rest lighter.
