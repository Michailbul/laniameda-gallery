# DEAR ANNETE wordmark generator. Needs fontTools and Bodoni Moda (OFL) from
# https://github.com/google/fonts/raw/main/ofl/bodonimoda/BodoniModa%5Bopsz,wght%5D.ttf
# Usage: python wordmark.py 800 out.svg BodoniModa.ttf, then paste the path
# into components/world-page/wordmark-dear-annete.ts (decimals rounded).
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
wght = float(sys.argv[1]); out = sys.argv[2]
f = instantiateVariableFont(TTFont('sys.argv[3] if len(sys.argv) > 3 else 'BodoniModa.ttf''), {"wght": wght, "opsz": 96})
gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f['head'].unitsPerEm
def glyph(ch): return gs[cmap[ord(ch)]]
def bounds(ch):
    bp = BoundsPen(gs); glyph(ch).draw(bp); return bp.bounds
cap = bounds('E')[3]
# stem width: thickness of E's vertical stem — measure via N's bounds roughly
eb = bounds('E')
TRACK = 0.16 * cap
paths = []; x = 0
def draw(ch, x):
    pen = SVGPathPen(gs)
    tp = TransformPen(pen, (1, 0, 0, -1, x, cap))
    glyph(ch).draw(tp); return pen.getCommands()
def custom_A(x, adv, stem, hair):
    # Crossbar-less A: hairline left leg, thick right leg, flat serifs, a lozenge in the counter.
    apex_w = stem * 0.55
    L = x + adv * 0.04; R = x + adv * 0.96; top = 0; base = cap
    ax = x + adv * 0.5
    d = []
    # thick right leg
    d.append(f"M{ax - apex_w*0.15:.1f} {top:.1f}L{ax + apex_w*0.85:.1f} {top:.1f}L{R - adv*0.06 + stem*0.5:.1f} {base:.1f}L{R - adv*0.06 - stem*0.5:.1f} {base:.1f}Z")
    # hairline left leg
    d.append(f"M{ax - apex_w*0.15:.1f} {top:.1f}L{ax - apex_w*0.15 + hair:.1f} {top:.1f}L{L + adv*0.06 + hair/2:.1f} {base:.1f}L{L + adv*0.06 - hair/2:.1f} {base:.1f}Z")
    # base serifs (hairline slabs)
    sw = adv * 0.13
    for cx in (L + adv*0.06, R - adv*0.06):
        d.append(f"M{cx - sw:.1f} {base - hair*1.1:.1f}H{cx + sw:.1f}V{base:.1f}H{cx - sw:.1f}Z")
    # lozenge
    ly = cap * 0.66; lr = cap * 0.075; lx = ax + apex_w*0.2
    d.append(f"M{lx:.1f} {ly - lr*1.35:.1f}L{lx + lr:.1f} {ly:.1f}L{lx:.1f} {ly + lr*1.35:.1f}L{lx - lr:.1f} {ly:.1f}Z")
    return "".join(d)
# measure stem/hair from glyph I if present
ib = bounds('I'); stem = (ib[2]-ib[0]) * 0.42
hair = cap * 0.022
text = "DEAR ANNETE"
for ch in text:
    if ch == ' ':
        x += cap * 0.42; continue
    adv = gs[cmap[ord(ch)]].width
    if ch == 'A':
        paths.append(custom_A(x, adv, stem, hair))
    else:
        paths.append(draw(ch, x))
    x += adv + TRACK
width = x - TRACK
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {cap:.0f}"><path fill="#d6aa5c" d="{"".join(paths)}"/></svg>'
open(out, "w").write(svg)
print(out, round(width), round(cap), len(svg))
