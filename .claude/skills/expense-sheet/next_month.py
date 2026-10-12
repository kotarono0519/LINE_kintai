#!/usr/bin/env python3
"""交通費・経費清算書を、最新月のファイルから対象月の分として複製し、右上の年月を直す。

使い方: next_month.py [--dir フォルダ] [--month YYYY-MM]
  --month を省くと今月が対象。
  対象月のファイルが既にあれば、何もせずに終わる（終了コード 0、「既にある」と出す）。

直すのは「旅費交通費清算書」シートの R2（年月。月の 1 日の日付で、表示は「2026年10月」）だけ。
表の日付などは R2 から計算されるので、開いたときに計算し直す設定（fullCalcOnLoad）を入れる。
書式を崩さないよう、Excel のファイル（zip）の中の XML を直接書き換える。
"""
import argparse
import datetime
import os
import re
import shutil
import sys
import tempfile
import zipfile

DEFAULT_DIR = os.path.expanduser("~/Desktop/月末書類とか/交通費")
SHEET_NAME = "旅費交通費清算書"
NAME_RE = re.compile(r"(\d{4})年(\d{1,2})月分")


def serial(d: datetime.date) -> int:
    return (d - datetime.date(1899, 12, 30)).days


def find_latest(folder: str):
    best = None
    for name in os.listdir(folder):
        if name.startswith("~$") or not name.endswith(".xlsx"):
            continue
        m = NAME_RE.search(name)
        if not m:
            continue
        ym = (int(m.group(1)), int(m.group(2)))
        if best is None or ym > best[0] or (ym == best[0] and os.path.getmtime(os.path.join(folder, name)) > os.path.getmtime(os.path.join(folder, best[1]))):
            best = (ym, name)
    return best


def sheet_path(z: zipfile.ZipFile) -> str:
    wb = z.read("xl/workbook.xml").decode("utf-8")
    m = re.search(r'<sheet [^>]*name="%s"[^>]*r:id="([^"]+)"' % SHEET_NAME, wb)
    if not m:
        sys.exit(f"シート「{SHEET_NAME}」が見つからない")
    rels = z.read("xl/_rels/workbook.xml.rels").decode("utf-8")
    t = re.search(r'<Relationship [^>]*Id="%s"[^>]*Target="([^"]+)"' % m.group(1), rels) or \
        re.search(r'<Relationship [^>]*Target="([^"]+)"[^>]*Id="%s"' % m.group(1), rels)
    target = t.group(1).lstrip("/")
    return target if target.startswith("xl/") else "xl/" + target


def rewrite(src: str, out: str, old_v: int, new_v: int, ly: int, lm: int):
    """src を out へ写しながら、R2 の年月と再計算の設定だけを書き換える。"""
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        sp = sheet_path(zin)
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == sp:
                pat = re.compile(rb'(<c r="R2"(?: [^>]*)?>)<v>(\d+)</v>(</c>)')
                m = pat.search(data)
                if not m:
                    sys.exit("R2（年月）の値が見つからない")
                if int(m.group(2)) != old_v:
                    sys.exit(f"R2 が複製元の月（{ly}年{lm}月）の 1 日になっていない（値 {m.group(2).decode()}）。止める")
                data = data[:m.start()] + m.group(1) + f"<v>{new_v}</v>".encode() + m.group(3) + data[m.end():]
            elif item.filename == "xl/workbook.xml":
                data = re.sub(rb' fullCalcOnLoad="[^"]*"', b"", data)
                data, n = re.subn(rb"<calcPr\b", b'<calcPr fullCalcOnLoad="1"', data, count=1)
                if n == 0:
                    sys.exit("再計算の設定（calcPr）が見つからない。止める")
            zout.writestr(item, data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=DEFAULT_DIR)
    ap.add_argument("--month", help="YYYY-MM（省くと今月）")
    a = ap.parse_args()

    today = datetime.date.today()
    if a.month:
        m = re.fullmatch(r"(\d{4})-(\d{1,2})", a.month)
        if not m or not 1 <= int(m.group(2)) <= 12:
            sys.exit(f"--month は YYYY-MM で書く（例 2026-10）: {a.month}")
        y, mo = int(m.group(1)), int(m.group(2))
    else:
        y, mo = today.year, today.month

    latest = find_latest(a.dir)
    if not latest:
        sys.exit("「YYYY年M月分」の付いた .xlsx が見つからない")
    (ly, lm), src_name = latest
    if (ly, lm) == (y, mo):
        print(f"既にある: {src_name}")
        return
    if (ly, lm) > (y, mo):
        sys.exit(f"対象月（{y}年{mo}月）が最新のファイル（{ly}年{lm}月分）より前。過去の月は作らない")

    dst_name = NAME_RE.sub(f"{y}年{mo}月分", src_name, count=1)
    src = os.path.join(a.dir, src_name)
    dst = os.path.join(a.dir, dst_name)
    if os.path.exists(dst):
        print(f"既にある: {dst_name}")
        return

    old_v = serial(datetime.date(ly, lm, 1))
    new_v = serial(datetime.date(y, mo, 1))

    fd, tmp = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    try:
        rewrite(src, tmp, old_v, new_v, ly, lm)
    except BaseException:
        os.remove(tmp)
        raise

    if os.path.exists(dst):  # 書いている間に誰かが作った場合も上書きしない
        os.remove(tmp)
        print(f"既にある: {dst_name}")
        return
    shutil.move(tmp, dst)
    print(f"複製元: {src_name}")
    print(f"作成:   {dst_name}")
    print(f"年月:   {ly}年{lm}月 → {y}年{mo}月")
    lock = os.path.join(a.dir, "~$" + src_name)
    if os.path.exists(lock):
        print("注意: 複製元は今 Excel で開かれている。保存していない変更は複製に入っていない")


if __name__ == "__main__":
    main()
