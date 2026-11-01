#!/bin/bash
export PATH=/Users/eallincreative/.local/node/bin:$PATH
OUT=$1; mkdir -p $OUT
for k in 1 2 3; do
for r in "home|/" "world|/w/dear-annete" "inbox|/inbox" "tasks|/tasks"; do
  n=${r%%|*}; p=${r#*|}
  npx --yes lighthouse "https://gallery.laniameda.space$p" --port=9222 --quiet --form-factor=mobile --screenEmulation.mobile --throttling-method=simulate --only-categories=performance --output=json --output-path=$OUT/$n-$k.json || echo "FAIL $n $k"
done; done
for r in "home-public|/" "world-public|/w/dear-annete"; do
  n=${r%%|*}; p=${r#*|}
  npx --yes lighthouse "https://gallery.laniameda.space$p" --quiet --chrome-flags="--headless=new --disable-extensions" --form-factor=mobile --screenEmulation.mobile --throttling-method=simulate --only-categories=performance --output=json --output-path=$OUT/$n.json || echo "FAIL $n"
done
echo done
