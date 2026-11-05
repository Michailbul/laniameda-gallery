"""Build agent-docs/perf/report-2026-11-01.html from the measurement files.
usage: python3 build_report.py <out.html>"""
import json, base64, io, statistics, sys, html
from PIL import Image

G = '/tmp/gperf'
OUT = sys.argv[1]

def load(p):
    return json.load(open(p))

def strip_b64(lh_path, frames=8, height=300):
    a = load(lh_path)['audits']
    items = a['screenshot-thumbnails']['details']['items'][:frames]
    ims = [Image.open(io.BytesIO(base64.b64decode(t['data'].split(',')[1]))).convert('RGB') for t in items]
    scale = height / ims[0].height
    ims = [im.resize((int(im.width * scale), height)) for im in ims]
    gap = 6
    s = Image.new('RGB', (sum(i.width for i in ims) + gap * (len(ims) - 1), height), (17, 17, 16))
    x = 0
    for im in ims:
        s.paste(im, (x, 0)); x += im.width + gap
    buf = io.BytesIO(); s.save(buf, 'JPEG', quality=72)
    return base64.b64encode(buf.getvalue()).decode(), [round(t['timing'] / 1000, 1) for t in items]

base = load(f'{G}/base.json')['runs']
now = load(f'{G}/now.json')['runs']
final = load(f'{G}/final.json')
fin = final['runs']

ROUTES = [('home', '/'), ('world', '/w/dear-annete'), ('inbox', '/inbox'), ('tasks', '/tasks')]

def score_class(s):
    return 'good' if s >= 90 else 'mid' if s >= 50 else 'bad'

def ms(v):
    return f'{v/1000:.1f} s' if v >= 1000 else f'{v} ms'

def delta(a, b, lower_better=True, fmt=str):
    if a == b: return '<span class="d flat">=</span>'
    better = (b < a) if lower_better else (b > a)
    return f'<span class="d {"up" if better else "down"}">{"▼" if b < a else "▲"}</span>'

route_cards = []
for key, path in ROUTES:
    b, n, f = base[key], now[key], fin[key]
    rows = ''
    for label, k, fmtf, lower in [('Score', 'score', str, False), ('LCP', 'lcpMs', ms, True), ('TBT', 'tbtMs', ms, True), ('CLS', 'cls', lambda v: f'{v:.3f}', True), ('Bytes', 'totalKiB', lambda v: f'{v:,} KiB', True), ('App JS', 'appJsKiB', lambda v: f'{v} KiB', True)]:
        rows += f'<tr><th>{label}</th><td>{fmtf(b[k])}</td><td>{fmtf(n[k])}</td><td class="fin">{fmtf(f[k])} {delta(b[k], f[k], lower)}</td></tr>'
    spread = final['spread'].get(key, '')
    route_cards.append(f'''
    <article class="route">
      <header><span class="mono">{html.escape(path)}</span><span class="badge {score_class(f["score"])}">{f["score"]}</span></header>
      <div class="scoreline"><span class="was">{b["score"]}</span><span class="arrow">→</span><span class="is {score_class(f["score"])}">{f["score"]}</span></div>
      <table><thead><tr><th></th><th>30 Oct</th><th>1 Nov pre</th><th>1 Nov after</th></tr></thead><tbody>{rows}</tbody></table>
      <p class="spread mono">{html.escape(spread)}</p>
    </article>''')

home_before, t_before = strip_b64(f'{G}/lh-now/home.json')
home_after, t_after = strip_b64(final['filmstrip']['home'])
world_bug, t_bug = strip_b64(f'{G}/lh-after/world.json')
world_after, t_wafter = strip_b64(final['filmstrip']['world'])

ws = load(f'{G}/ws-summary.json')

def frame_bar(frame, total_max):
    colors = {'assets:listGalleryAssetsPage': 'var(--coral)', 'skills:listSkills': '#79B791', 'storybooks:listStorybooks': '#E8A838',
              'folders:listFolders': '#8a7b6c', 'tags:listTagVocabulary': '#5c5048', 'assets:folderAssetCounts': '#3a3a3a'}
    segs = ''
    for q, b in sorted(frame['queries'], key=lambda t: -t[1]):
        w = 100 * b / total_max
        if w < 0.4: continue
        c = colors.get(q, '#2a2826')
        segs += f'<span class="seg" style="width:{w:.2f}%;background:{c}" title="{q} {b:,} B"><em>{q.split(":")[1] if w > 9 else ""}</em></span>'
    return segs

mx = max(f['bytes'] for f in ws['frames'])
ws_rows = ''
for f in ws['frames']:
    ws_rows += f'''<div class="wsrow"><div class="wslabel"><b>{html.escape(f["label"])}</b><span class="mono">{f["bytes"]:,} B raw · ~{f["deflatedKB"]} KB on the wire</span></div><div class="wsbar">{frame_bar(f, mx)}</div></div>'''

shipped = [
    ('#110', 'Storybook shelf: 480/960 renditions through srcset'),
    ('#111', 'One copy of framer-motion'),
    ('#112', 'Grid tiles pick 960w on 3x phones (was 1440w): 810 → 432 KB first screen'),
    ('#113', 'Phone mounts only its own sidebar and detail panel'),
    ('#114', 'Tag list without counts: an agent save no longer re-sends 267 KB'),
    ('#115', 'Cards keep identity across page appends'),
    ('#116–117', 'Dashboard modals, tabs and markdown code-split'),
    ('#122', 'Grid page first, sidebar data after; skills and storybooks slimmed; shelf holds its place; 40 shelf previews backfilled'),
    ('#123', 'Cached shelf only on a home address (fixes the CLS #122 caused on /w)'),
]
shipped_html = ''.join(f'<li><span class="mono pr">{p}</span>{html.escape(t)}</li>' for p, t in shipped)

decisions = load(f'{G}/decisions.json')
dec_html = ''.join(f'''<article class="dec"><header><span class="badge {d["kind"]}">{d["verdict"]}</span><h3>{html.escape(d["title"])}</h3></header><p>{html.escape(d["why"])}</p><p class="mono ev">{html.escape(d["evidence"])}</p></article>''' for d in decisions)

pub = ''.join(f'<tr><th class="mono">{p}</th><td>{base[k]["score"]}</td><td class="fin">{fin[k]["score"]}</td><td>{ms(base[k]["lcpMs"])} → {ms(fin[k]["lcpMs"])}</td><td>{ms(base[k]["tbtMs"])} → {ms(fin[k]["tbtMs"])}</td><td>{base[k]["cls"]:.3f} → {fin[k]["cls"]:.3f}</td></tr>' for k, p in [('home-public', '/'), ('world-public', '/w/dear-annete')])

hb, ha = base['home'], fin['home']
page = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gallery speed — before / after — 1 Nov 2026</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;800;900&family=Geist+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
:root{{--bg:#111110;--s1:#1a1918;--s2:#1f1e1c;--s3:#2a2826;--ink:#f0e8e0;--t2:#bfb0a0;--t3:#8a7b6c;--ghost:#5c5048;--border:rgba(240,232,224,.10);--strong:rgba(240,232,224,.18);--coral:#ff7a64;--teal:#79B791;--amber:#E8A838;--sans:Geist,system-ui,sans-serif;--mono:"Geist Mono",ui-monospace,"SF Mono",monospace}}
*{{box-sizing:border-box;margin:0}}
body{{background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:48px 48px;background-attachment:fixed}}
.wrap{{max-width:1240px;margin:0 auto;padding:40px 24px 96px}}
.mono{{font-family:var(--mono)}}
.kicker{{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3)}}
h1{{font-weight:900;font-size:clamp(34px,6vw,72px);letter-spacing:-.02em;text-transform:uppercase;line-height:.95;margin:14px 0 18px}}
h1 b{{color:var(--coral)}}
h2{{font-weight:800;font-size:13px;letter-spacing:.18em;text-transform:uppercase;margin:64px 0 18px;display:flex;align-items:center;gap:12px}}
h2::before{{content:"";width:10px;height:10px;border-radius:3px;background:var(--coral)}}
h3{{font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}}
p{{color:var(--t2);line-height:1.6;font-size:15px}}
.lede{{max-width:760px;font-size:17px}}
.hero{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:34px}}
.stat{{background:var(--s1);border:2px solid var(--border);border-radius:18px;padding:20px}}
.stat .k{{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--t3)}}
.stat .v{{font-size:44px;font-weight:900;letter-spacing:-.02em;margin-top:10px;display:flex;align-items:baseline;gap:10px}}
.stat .v s{{color:var(--ghost);font-size:26px;text-decoration-thickness:3px}}
.stat .v .good{{color:var(--teal)}}
.badge{{font-family:var(--mono);font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;border:2px solid currentColor;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}}
.good{{color:var(--teal)}} .mid{{color:var(--amber)}} .bad{{color:var(--coral)}} .skip{{color:var(--t3)}} .done{{color:var(--teal)}} .note{{color:var(--amber)}}
.film{{background:var(--s1);border:2px solid var(--border);border-radius:18px;padding:16px;margin-bottom:12px}}
.film header{{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px;flex-wrap:wrap}}
.film img{{width:100%;display:block;border-radius:10px}}
.film .times{{display:grid;grid-template-columns:repeat(8,1fr);margin-top:8px;font-family:var(--mono);font-size:10px;color:var(--t3);text-align:center}}
.routes{{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}}
.route{{background:var(--s1);border:2px solid var(--border);border-radius:18px;padding:18px}}
.route header{{display:flex;justify-content:space-between;align-items:center;font-size:14px}}
.scoreline{{display:flex;align-items:baseline;gap:12px;margin:10px 0 14px;font-weight:900;letter-spacing:-.02em}}
.scoreline .was{{font-size:34px;color:var(--ghost)}} .scoreline .arrow{{color:var(--t3);font-size:22px}} .scoreline .is{{font-size:56px}}
table{{width:100%;border-collapse:collapse;font-size:13px}}
th,td{{padding:7px 6px;border-top:1px solid var(--border);text-align:right;font-variant-numeric:tabular-nums}}
th:first-child{{text-align:left;color:var(--t3);font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:500}}
thead th{{color:var(--t3);font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:500;border-top:none}}
td{{color:var(--t2)}} td.fin{{color:var(--ink);font-weight:700}}
.d{{font-size:9px;margin-left:4px}} .d.up{{color:var(--teal)}} .d.down{{color:var(--coral)}} .d.flat{{color:var(--t3)}}
.spread{{font-size:10px;color:var(--t3);margin-top:10px;line-height:1.5}}
.wsrow{{margin-bottom:14px}} .wslabel{{display:flex;justify-content:space-between;gap:12px;margin-bottom:6px;font-size:13px;flex-wrap:wrap}} .wslabel .mono{{color:var(--t3);font-size:11px}}
.wsbar{{display:flex;height:38px;border-radius:10px;overflow:hidden;background:var(--s2);border:1px solid var(--border)}}
.seg{{display:flex;align-items:center;padding-left:8px;border-right:2px solid var(--bg);overflow:hidden}} .seg em{{font-style:normal;font-family:var(--mono);font-size:10px;color:#111;font-weight:700;white-space:nowrap}}
.legend{{display:flex;gap:16px;flex-wrap:wrap;font-family:var(--mono);font-size:10px;color:var(--t3);margin-top:6px}} .legend i{{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}}
.panel{{background:var(--s1);border:2px solid var(--border);border-radius:18px;padding:20px}}
ul.shipped{{list-style:none;padding:0;display:grid;grid-template-columns:repeat(2,1fr);gap:8px}}
ul.shipped li{{background:var(--s1);border:2px solid var(--border);border-radius:14px;padding:12px 14px;font-size:14px;color:var(--t2);display:flex;gap:12px;align-items:baseline}}
.pr{{color:var(--coral);font-weight:700;font-size:12px;min-width:64px}}
.decs{{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}}
.dec{{background:var(--s1);border:2px solid var(--border);border-radius:18px;padding:18px}} .dec header{{display:flex;gap:12px;align-items:center;margin-bottom:10px}}
.dec p{{font-size:14px}} .dec .ev{{font-size:11px;color:var(--t3);margin-top:10px;line-height:1.55}}
footer{{margin-top:64px;color:var(--t3);font-family:var(--mono);font-size:11px;line-height:1.7}}
@media(max-width:820px){{.hero,.routes,.decs,ul.shipped{{grid-template-columns:1fr}} .film .times{{display:none}}}}
</style></head><body><div class="wrap">
<div class="kicker">laniameda.gallery · speed · report · 1 Nov 2026</div>
<h1>Home went from <b>{hb["score"]}</b> to <b>{ha["score"]}</b>.<br>The page no longer jumps.</h1>
<p class="lede">Lighthouse mobile (simulated Moto G, slow 4G) through Michael's signed-in Chrome, the same way as the 30 Oct baseline. The after numbers are the median of three runs per route on the live site after PR #123. The big remaining cost on the signed-in runs is script time from the two Chrome extensions, which Lighthouse counts as "Unattributable".</p>
<section class="hero">
  <div class="stat"><div class="k">Home score</div><div class="v"><s>{hb["score"]}</s><span class="good">{ha["score"]}</span></div></div>
  <div class="stat"><div class="k">Home layout shift</div><div class="v"><s>{hb["cls"]:.3f}</s><span class="good">{ha["cls"]:.3f}</span></div></div>
  <div class="stat"><div class="k">Home blocking time</div><div class="v"><s>{hb["tbtMs"]/1000:.1f}s</s><span class="good">{ha["tbtMs"]/1000:.1f}s</span></div></div>
  <div class="stat"><div class="k">First data frame, home</div><div class="v"><s>{ws["frames"][0]["bytes"]//1000}K</s><span class="good">{ws["frames"][1]["bytes"]//1000}K</span></div></div>
</section>

<h2>Home, the first seconds on a phone</h2>
<div class="film"><header><span class="kicker">Before · 1 Nov, live before #122</span><span class="badge bad">CLS {now["home"]["cls"]:.3f}</span></header><img alt="home filmstrip before" src="data:image/jpeg;base64,{home_before}"><div class="times">{''.join(f'<span>{t}s</span>' for t in t_before)}</div>
<p style="margin-top:10px;font-size:13px">Grid skeletons paint at about 1.4 s. The storybook shelf arrives about 5 s in, above them, and pushes the whole grid down.</p></div>
<div class="film"><header><span class="kicker">After · #122 + #123</span><span class="badge good">CLS {fin["home"]["cls"]:.3f}</span></header><img alt="home filmstrip after" src="data:image/jpeg;base64,{home_after}"><div class="times">{''.join(f'<span>{t}s</span>' for t in t_after)}</div>
<p style="margin-top:10px;font-size:13px">The shelf opens from the books of the last visit, so it has its final height from the first frame. The grid fills in under it.</p></div>

<h2>The regression #122 caused, and the fix</h2>
<div class="film"><header><span class="kicker">/w/dear-annete after #122 · fixed in #123</span><span class="badge bad">CLS {load(G + "/after.json")["runs"]["world"]["cls"]:.3f}</span></header><img alt="world filmstrip regression" src="data:image/jpeg;base64,{world_bug}"><div class="times">{''.join(f'<span>{t}s</span>' for t in t_bug)}</div>
<p style="margin-top:10px;font-size:13px">The cached home shelf painted on the world address too, then the world replaced it. The cache now applies only when the page opens on home.</p></div>
<div class="film"><header><span class="kicker">/w/dear-annete after #123</span><span class="badge good">CLS {fin["world"]["cls"]:.3f}</span></header><img alt="world filmstrip after" src="data:image/jpeg;base64,{world_after}"><div class="times">{''.join(f'<span>{t}s</span>' for t in t_wafter)}</div></div>

<h2>Four routes, three measurements</h2>
<section class="routes">{''.join(route_cards)}</section>

<h2>What the phone downloads before the first tiles</h2>
<div class="panel">{ws_rows}
<div class="legend"><span><i style="background:var(--coral)"></i>grid page</span><span><i style="background:#79B791"></i>skills (grid cards)</span><span><i style="background:#E8A838"></i>storybooks (shelf)</span><span><i style="background:#8a7b6c"></i>folder tree</span><span><i style="background:#5c5048"></i>tag vocabulary</span><span><i style="background:#2a2826"></i>other</span></div>
<p style="margin-top:14px;font-size:13px">{html.escape(ws["note"])}</p></div>

<h2>Signed out, clean headless Chrome</h2>
<div class="panel"><table><thead><tr><th>Route</th><th>30 Oct</th><th>1 Nov</th><th>LCP</th><th>TBT</th><th>CLS</th></tr></thead><tbody>{pub}</tbody></table>
<p style="margin-top:12px;font-size:13px">These runs have no extensions and no account. They show the app's own cost: both public pages are now in the 90s.</p></div>

<h2>Shipped in the speed thread</h2>
<ul class="shipped">{shipped_html}</ul>

<h2>Decided, with the measurement</h2>
<section class="decs">{dec_html}</section>

<footer>Sources: agent-docs/perf/baseline-2026-10-30.md · lighthouse-2026-10-30.json · lighthouse-2026-11-01-before.json · lighthouse-2026-11-01-after.json · websocket-2026-11-01.json · raw reports in agent-docs/perf/raw/. Lighthouse 13.6, mobile, simulated throttling, performance only.</footer>
</div></body></html>'''
open(OUT, 'w').write(page)
print('wrote', OUT, len(page) // 1024, 'KB')
