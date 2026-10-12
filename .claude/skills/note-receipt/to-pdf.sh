#!/bin/zsh
# 使い方: to-pdf.sh <領収書の HTML> <保存先の PDF>
# Mac の Google Chrome を画面なし（ヘッドレス）で動かし、HTML を PDF に印刷する。
# Chrome は PDF を書き終えても終わらないことがあるので、PDF ができたら止める。
# 保存先に同じ名前のファイルがあれば、上書きせずに止まる。
set -eu

html="$1"
out="$2"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

[ -f "$html" ] || { echo "HTML が見つからない: $html" >&2; exit 1; }
[ -e "$out" ] && { echo "同じ名前のファイルがある（上書きしない）: $out" >&2; exit 2; }

profile="$(mktemp -d)"
tmp_pdf="$profile/out.pdf"
"$chrome" --headless=new --disable-gpu --disable-extensions --no-pdf-header-footer \
  --user-data-dir="$profile" --print-to-pdf="$tmp_pdf" "file://$html" >/dev/null 2>&1 &
pid=$!

for _ in {1..40}; do
  [ -s "$tmp_pdf" ] && break
  sleep 1
done
sleep 1
kill "$pid" 2>/dev/null || true
pkill -f "$profile" 2>/dev/null || true

[ -s "$tmp_pdf" ] || { rm -rf "$profile"; echo "PDF ができなかった" >&2; exit 3; }
mv -n "$tmp_pdf" "$out"
rm -rf "$profile"
echo "$out"
