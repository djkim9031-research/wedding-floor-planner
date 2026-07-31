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
