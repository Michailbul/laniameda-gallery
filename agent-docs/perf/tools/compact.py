"""Compact Lighthouse summaries: python3 compact.py <label> <dir-or-files...> > out.json"""
import json, sys, os, glob

def app_js(items):
    return sum(i.get('transferSize', 0) for i in items
               if i.get('resourceType') == 'Script' and 'gallery.laniameda.space' in i.get('url', ''))

def summarize(path):
    d = json.load(open(path)); a = d['audits']
    items = a['network-requests']['details']['items']
    shifts = [{'score': round(i.get('score', 0), 3), 'selector': i.get('node', {}).get('selector')}
              for i in a.get('layout-shifts', {}).get('details', {}).get('items', []) if i.get('score', 0) >= 0.001]
    boot = sorted(a.get('bootup-time', {}).get('details', {}).get('items', []), key=lambda i: -i.get('total', 0))[:3]
    return {
        'url': d['finalDisplayedUrl'] if 'finalDisplayedUrl' in d else d.get('finalUrl'),
        'fetchTime': d['fetchTime'],
        'score': round((d['categories']['performance']['score'] or 0) * 100),
        'fcpMs': round(a['first-contentful-paint']['numericValue']),
        'lcpMs': round(a['largest-contentful-paint']['numericValue']),
        'tbtMs': round(a['total-blocking-time']['numericValue']),
        'cls': round(a['cumulative-layout-shift']['numericValue'], 3),
        'speedIndexMs': round(a['speed-index']['numericValue']),
        'totalKiB': round(a['total-byte-weight']['numericValue'] / 1024),
        'appJsKiB': round(app_js(items) / 1024),
        'imageKiB': round(sum(i.get('transferSize', 0) for i in items if i.get('resourceType') == 'Image') / 1024),
        'requests': len(items),
        'shifts': shifts,
        'heaviestScripts': [{'url': i['url'][-70:], 'totalMs': round(i.get('total', 0)), 'scriptingMs': round(i.get('scripting', 0))} for i in boot],
    }

label = sys.argv[1]
out = {'label': label, 'runs': {}}
names = {'home': '/', 'world': '/w/dear-annete', 'inbox': '/inbox', 'tasks': '/tasks', 'home-public': '/ (signed out)', 'world-public': '/w/dear-annete (signed out)'}
for p in sys.argv[2:]:
    key = os.path.basename(p).replace('-mobile.json', '').replace('.json', '')
    out['runs'][key] = {'route': names.get(key, key), **summarize(p)}
print(json.dumps(out, indent=1))
