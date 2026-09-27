# Wedding Floor Planner

Sims-style 3D placement tool for planning our reception layout in the venue's
open-space room (45'5" × 49'11"). Place the tables, snap them into blocks, and
drop either linen on top — the cloth drapes with real physics so you can see
exactly how far it hangs and where it pools.

- Oak table: 47.5" × 31.5" × 29.5"h
- Square oak table: 35.5" × 35.5" × 29.5"h
- QCC table (teak): 72" × 36" × 30.5"h
- Rental linen: 108" × 156"
- C&B linen: 104" × 144"

## Run

```sh
npm install
npm run dev
```

## Controls

| Action | Desktop | Touch |
|---|---|---|
| Orbit / pan / zoom | drag / right-drag / wheel | 1-finger / 2-finger / pinch |
| Place item | click palette card, click floor | drag card onto floor |
| Move item | drag it | drag it |
| Rotate | R / Q / E / scroll while holding | brass ring handle |
| Fine rotate | hold Shift | toggle 15° off |
| Duplicate / delete | Ctrl+D / Del | selection buttons |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z | toolbar |
| Plan view / eye level | T / V | toolbar |
| Ceiling on/off | C | toolbar |

Presets menu has both sticky-note layouts. Layouts autosave locally; use
Export/Import to move them between devices.

## Single-file build

```sh
npm run build:single   # emits dist-single/index.html — fully self-contained
```

## Notes

- Two overlapping cloths don't collide with each other (known limitation).
- Cloth drape re-simulates whenever a table under it moves.

## Mac app

**Wedding Venue Studio** is the same planner as a native macOS app (Electron),
built for Intel Macs such as the MacBook Pro 16" (2019), macOS 12 or later.

### Install

1. Download the `.dmg` — from the latest
   [GitHub Release](https://github.com/djkim9031-research/wedding-floor-planner/releases), or from the
   **Mac app** workflow run under
   [Actions](https://github.com/djkim9031-research/wedding-floor-planner/actions/workflows/mac-app.yml)
   (artifact `Wedding-Venue-Studio-mac-x64`, kept 14 days).
2. Open the `.dmg` and drag **Wedding Venue Studio** onto **Applications**.
3. First launch: the app is ad-hoc signed, not notarized, so macOS 15+ blocks it once.
   Open it, dismiss the warning, then go to **System Settings → Privacy & Security** and click
   **Open Anyway** (then confirm). After that it opens normally.
   If macOS says the app is "damaged", clear the download quarantine flag instead:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/Wedding Venue Studio.app"
   ```

### Render in Blender

**File → Render in Blender…** path-traces the current view with Cycles. It needs
[Blender 4.5 LTS](https://www.blender.org/download/lts/4-5/) (the last release with an Intel Mac
build; 4.2–4.5 work, 5.x is not supported) installed in **Applications**. The app finds it
automatically (also `~/Applications` and Spotlight), or pick it in **Settings… (⌘,)**. Renders go
to `~/Library/Application Support/Wedding Venue Studio/renders/<date-time>/` (**Help → Reveal
Renders Folder**), each with the image, a `.blend` and `blender.log`.

### Settings and troubleshooting

- **Settings… (⌘,)**: WebGPU (used by the Photo mode denoiser) and the graphics backend
  (Metal, or OpenGL if the 3D view glitches) — both apply after a restart.
- **Help → GPU Info** shows Chromium's GPU report; **Help → Open Logs Folder** opens
  `~/Library/Logs/Wedding Venue Studio/`.

### Layouts move via Export → Import

The app keeps its own saved layouts, separate from the browser version. To bring a layout over,
use **Layouts → Export file…** in the browser, then **File → Open Layout… (⌘O)** (or
**Layouts → Import file…**) in the app — and the same the other way round.

### Build it yourself

On a Mac with Node 22:

```sh
npm ci
npm run dist:mac        # → release/Wedding-Venue-Studio-<version>-x64.dmg
npm run electron:start  # or run it unpackaged
```

`npm run dist:mac` builds the web app (`dist/`), bundles `electron/` with esbuild
(`dist-electron/`) and packages with electron-builder (`electron-builder.yml`). CI does the same on
`macos-15-intel` for every push that touches the app and attaches the dmg to a release for `v*` tags.
