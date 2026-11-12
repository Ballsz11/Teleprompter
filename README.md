# Teleprompter

A zero-dependency, responsive teleprompter that runs in any browser — on a phone,
tablet, laptop, or a big studio monitor. Just open `index.html`.

## Features

- **Works on every screen size** — responsive layout from small phones (portrait
  and landscape) up to 4K displays, with touch-friendly controls and safe-area padding.
- **Script input** — type manually or paste (the **Paste** button uses the
  clipboard API, with a `Ctrl/⌘+V` fallback).
- **Font size control** — slider or keyboard, 20px–160px.
- **Text alignment** — left, center, or right, switchable live with the
  segmented control or the `A` key.
- **Speed control** — measured in real words-per-minute (60–400 wpm). The scroll
  speed automatically adapts to font size and screen width, so the reading pace
  stays accurate.
- **Mirror mode** — flip the text horizontally for beam-splitter glass rigs.
- **Fullscreen + dark mode** — distraction-free black background by default,
  with a light/dark toggle. Fullscreen has a CSS fallback for iOS Safari.
- **Keyboard / play controls** — play, pause, restart, progress bar, and a
  time-remaining readout.
- **Everything is saved** — script and settings persist in `localStorage`;
  close the tab and your work is still there.
- **Reading guide line** — a marker near the top of the screen shows exactly
  which line to read.

## Run it

No build step, no install:

```bash
# Option 1: just open the file
start index.html          # Windows
open index.html           # macOS

# Option 2: serve it (needed for clipboard access on some browsers)
npx serve .
python -m http.server 8000
```

Then open <http://localhost:3000> (or :8000).

> Clipboard *reading* requires a secure context (`https://` or `localhost`).
> Typing and `Ctrl/⌘+V` work everywhere, including `file://`.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `R` | Restart from the top |
| `↑` / `↓` | Speed up / down (±5 wpm) |
| `←` / `→` (or `+` / `-`) | Font smaller / larger |
| `A` | Cycle text alignment (left → center → right) |
| `M` | Mirror text |
| `F` | Fullscreen |
| `E` / `Esc` | Back to the editor |

While playing **in fullscreen**, the control bar auto-hides after a few seconds
and reappears as soon as you move, tap, or press a key.

## Files

```
index.html   markup: editor + prompter views
styles.css   theming, layout, responsive rules
app.js       scrolling engine, controls, persistence
```

## Customization

- **Colors** — edit the CSS variables at the top of `styles.css`
  (`--accent`, `--bg`, `--surface`, …). Dark and light themes are both defined there.
- **Guide line position** — `--guide-offset` (how far from the top the reading
  marker sits).
- **Speed range** — the `min`/`max`/`step` on `#speed-slider` in `index.html`,
  and the clamp in `setWpm()` in `app.js`.

## Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari 15.4+).
