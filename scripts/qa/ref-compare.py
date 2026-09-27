#!/usr/bin/env python3
"""Compare renders against the reference photos of the venue.

  compare mode (one reference vs one or more renders):
    python scripts/qa/ref-compare.py compare --ref reference/quad/02-hall-entry.jpg \
        --render editor=.shots/x/ref2.png --render photo=.shots/x/ref2-photo.png --out .shots/cmp/ref2
    → ref2/side-by-side.png   photo | render(s) at the same height
      ref2/blend-<name>.png   50% blend (misalignment shows as ghosting)
      ref2/edges-<name>.png   Sobel edges: photo in red, render in cyan (aligned → white)

  sheet mode (labelled grid, e.g. the three quality tiers next to the photo):
    python scripts/qa/ref-compare.py sheet --out sheet.png --cols 2 \
        photo=reference/quad/02-hall-entry.jpg editor=a.png "photo mode"=b.png blender=c.png

Renders are resampled to the reference's aspect (letterboxed, never stretched).
Needs Pillow + numpy (pip install pillow numpy).
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

FONT = None
for cand in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"):
    if os.path.exists(cand):
        FONT = cand
        break


def font(size):
    try:
        return ImageFont.truetype(FONT, size) if FONT else ImageFont.load_default()
    except OSError:
        return ImageFont.load_default()


def load(path):
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    return im


def fit(im, w, h, bg=(24, 22, 20)):
    """Scale to fit w×h keeping aspect; letterbox with bg."""
    scale = min(w / im.width, h / im.height)
    nw, nh = max(1, round(im.width * scale)), max(1, round(im.height * scale))
    out = Image.new("RGB", (w, h), bg)
    out.paste(im.resize((nw, nh), Image.LANCZOS), ((w - nw) // 2, (h - nh) // 2))
    return out


def label(im, text, size=22):
    d = ImageDraw.Draw(im, "RGBA")
    f = font(size)
    tw = d.textlength(text, font=f)
    d.rectangle([8, 8, 8 + tw + 16, 8 + size + 14], fill=(0, 0, 0, 150))
    d.text((16, 14), text, fill=(255, 250, 240), font=f)
    return im


def edges(im):
    g = np.asarray(im.convert("L").filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32)
    gx = np.zeros_like(g)
    gy = np.zeros_like(g)
    gx[:, 1:-1] = g[:, 2:] - g[:, :-2]
    gy[1:-1, :] = g[2:, :] - g[:-2, :]
    m = np.hypot(gx, gy)
    m /= max(np.percentile(m, 99.5), 1e-6)
    return np.clip(m, 0, 1)


def parse_pairs(items):
    out = []
    for it in items:
        if "=" in it:
            name, path = it.split("=", 1)
        else:
            name, path = os.path.splitext(os.path.basename(it))[0], it
        out.append((name, path))
    return out


def cmd_compare(a):
    ref = load(a.ref)
    W, H = a.width, round(a.width * ref.height / ref.width)
    ref_f = fit(ref, W, H)
    renders = [(n, fit(load(p), W, H)) for n, p in parse_pairs(a.render)]
    os.makedirs(a.out, exist_ok=True)

    cols = 1 + len(renders)
    sheet = Image.new("RGB", (W * cols, H), (24, 22, 20))
    sheet.paste(label(ref_f.copy(), f"photo · {os.path.basename(a.ref)}"), (0, 0))
    for i, (n, im) in enumerate(renders, 1):
        sheet.paste(label(im.copy(), n), (W * i, 0))
    sheet.save(os.path.join(a.out, "side-by-side.png"))

    e_ref = edges(ref_f)
    for n, im in renders:
        Image.blend(ref_f, im, 0.5).save(os.path.join(a.out, f"blend-{n}.png"))
        e_r = edges(im)
        rgb = np.zeros((H, W, 3), dtype=np.float32)
        rgb[..., 0] = e_ref  # photo → red
        rgb[..., 1] = e_r  # render → cyan
        rgb[..., 2] = e_r
        Image.fromarray((rgb * 255).astype(np.uint8)).save(os.path.join(a.out, f"edges-{n}.png"))
        # a crude alignment score: edge correlation (1 = identical edges)
        num = float((e_ref * e_r).sum())
        den = float(np.sqrt((e_ref**2).sum() * (e_r**2).sum())) or 1.0
        print(f"{n}: edge correlation {num / den:.3f}")
    print(f"wrote {a.out}/side-by-side.png (+ blend/edges per render)")


def cmd_sheet(a):
    pairs = parse_pairs(a.items)
    ims = [(n, load(p)) for n, p in pairs]
    first = ims[0][1]
    W = a.width
    H = round(W * first.height / first.width)
    cols = a.cols or len(ims)
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (W * cols, H * rows), (24, 22, 20))
    for i, (n, im) in enumerate(ims):
        sheet.paste(label(fit(im, W, H), n), ((i % cols) * W, (i // cols) * H))
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    sheet.save(a.out)
    print(f"wrote {a.out} ({sheet.width}×{sheet.height})")


def main(argv):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("compare")
    c.add_argument("--ref", required=True)
    c.add_argument("--render", action="append", required=True, help="name=path (repeatable)")
    c.add_argument("--out", required=True)
    c.add_argument("--width", type=int, default=960)
    c.set_defaults(fn=cmd_compare)
    s = sub.add_parser("sheet")
    s.add_argument("items", nargs="+", help="name=path …")
    s.add_argument("--out", required=True)
    s.add_argument("--cols", type=int, default=0)
    s.add_argument("--width", type=int, default=960)
    s.set_defaults(fn=cmd_sheet)
    a = p.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main(sys.argv[1:])
