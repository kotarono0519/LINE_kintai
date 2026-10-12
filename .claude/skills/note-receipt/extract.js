// note の領収書ページ（https://note.com/receipt/<取引ID>?t=receipt）で実行する。
// 領収書の部分だけを、ページの見た目（style）ごと 1 枚の HTML にして、ダウンロードフォルダへ保存させる。
// 印刷ボタンは消し、白地にする。戻り値は保存したファイル名と、名前付けに使う購入日・取引ID。
(() => {
  const src = document.querySelector('.o-receipt');
  if (!src) return { error: '領収書の部分（.o-receipt）が見つからない' };
  const c = src.cloneNode(true);
  c.querySelectorAll('button').forEach(b => {
    if (b.textContent.includes('印刷')) (b.parentElement?.tagName === 'DIV' ? b.parentElement : b).remove();
  });
  const styles = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
  const text = src.innerText;
  const id = (text.match(/取引ID\s*:\s*([0-9a-f]+)/) || [])[1] || 'unknown';
  const d = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const month = d ? `${d[1]}-${d[2].padStart(2, '0')}` : null;
  const html = `<!doctype html><html lang="ja-JP" class="theme-light"><head><meta charset="utf-8">` +
    `<base href="https://note.com/"><title>note 領収書 ${id}</title><style>${styles}</style>` +
    `<style>html,body{background:#fff!important;margin:0} @page{margin:12mm}</style></head>` +
    `<body>${c.outerHTML}</body></html>`;
  const file = `note_receipt_${id}.html`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = file;
  document.body.append(a);
  a.click();
  a.remove();
  return { file, id, month, text: text.replace(/\s+/g, ' ').trim() };
})()
