import json
X='xmlns="http://www.w3.org/2000/svg"'
def arrow(x1,y,x2,color='var(--accent)'):
    return f'<path d="M {x1} {y} L {x2} {y}" stroke="{color}" stroke-width="2" fill="none"/><path d="M {x2-6} {y-5} L {x2} {y} L {x2-6} {y+5}" stroke="{color}" stroke-width="2" fill="none"/>'
def chip(cx,cy,n):
    return f'<circle cx="{cx}" cy="{cy}" r="9" fill="var(--accent)"/><text x="{cx}" y="{cy+4}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--paper)">{n}</text>'
def box(x,y,w,h,n,name,sub,actor=None,stroke='var(--ink)'):
    s=f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="var(--paper)" stroke="{stroke}" stroke-width="1.5"/>'
    if n: s+=chip(x+16,y+18,n)
    s+=f'<text x="{x+30 if n else x+w/2}" y="{y+22}" {"" if n else "text-anchor=\"middle\""} font-size="12.5" font-weight="700" fill="var(--ink)">{name}</text>'
    s+=f'<text x="{x+12 if n else x+w/2}" y="{y+44}" {"" if n else "text-anchor=\"middle\""} font-size="11" fill="var(--muted)">{sub}</text>'
    if actor: s+=f'<text x="{x+4}" y="{y-8}" font-size="10.5" fill="var(--muted)">{actor}</text>'
    return s
def todo(x,y,lines):
    s=''
    for i,l in enumerate(lines):
        s+=f'<circle cx="{x+4}" cy="{y+i*18-4}" r="3.5" fill="var(--warn)"/><text x="{x+12}" y="{y+i*18}" font-size="10.5" fill="var(--warn)">{l}</text>'
    return s

# 平日の夜
s1=f'<svg {X} viewBox="0 0 700 170" role="img" aria-label="平日の夜の流れ。送る、読み取る、保存する、返信する の 4 手順と、それぞれで決めること">'
xs=[2,178,354,530]; w=166
steps=[('送る','LINE に残業時間','あなた'),('読み取る','Claude が日付と残業分','記録係'),('保存する','反映待ちとして','記録係'),('返信する','記録した内容を LINE へ','記録係')]
for i,(n,sub,a) in enumerate(steps):
    s1+=box(xs[i],24,w,58,i+1,n,sub,a)
    if i<3: s1+=arrow(xs[i]+w+1,53,xs[i+1]-1)
s1+=todo(xs[0]+4,108,['書き方の幅','前の日の分を送れるか'])
s1+=todo(xs[1]+4,108,['読み取れないときの返し方'])
s1+=todo(xs[3]+4,108,['記録を見る・取り消す方法'])
s1+='</svg>'

# 例外 2 つ
s2=f'<svg {X} viewBox="0 0 700 200" role="img" aria-label="流れが分かれる 2 つの場合。休日は時刻を聞き返す。同じ日の送り直しは上書きする">'
for col,(head,a,b,todos) in enumerate([('休日に送った','出勤・退勤を聞き返す','答えた時刻で保存',['休日の範囲（祝日・会社の休み）','聞き返しに答えないとき']),('同じ日に 2 回送った','後の値で上書き','更新を LINE で知らせる',[])]):
    x0=col*356
    s2+=f'<rect x="{x0}" y="0" width="344" height="196" rx="10" fill="var(--paper-dim)" stroke="var(--line)" stroke-width="1"/>'
    s2+=f'<text x="{x0+14}" y="24" font-size="12.5" font-weight="700" fill="var(--ink)">{head}</text>'
    s2+=box(x0+14,42,150,56,None,a,'記録係が LINE で' if col==0 else '前の値は残さない')
    s2+=arrow(x0+166,70,x0+178)
    s2+=box(x0+180,42,150,56,None,b,'反映待ちになる' if col==0 else '返信で気づける')
    s2+=todo(x0+16,130,todos) if todos else f'<text x="{x0+16}" y="130" font-size="10.5" fill="var(--ok)">決めることは残っていない</text>'
s2+='</svg>'

# 月初め
s3=f'<svg {X} viewBox="0 0 700 220" role="img" aria-label="月初めの流れ。知らせる、準備する、反映するの 3 段階と 5 つの手順、それぞれで決めること">'
bx=[0,144,288,432,576]; bw=124
bands=[(0,124,'知らせる'),(144,268,'準備する'),(288,700,'反映する')]
for a,b,t in bands:
    s3+=f'<rect x="{a}" y="0" width="{b-a}" height="22" rx="4" fill="var(--accent)" opacity="0.35"/><text x="{a+8}" y="15" font-size="11" font-weight="700" fill="var(--ink)">{t}</text>'
st=[('通知','LINE に先月の件数','記録係'),('ログイン','Chrome で勤怠へ','あなた'),('依頼する','先月分を反映して','あなた'),('直す','退勤時刻を 1 件ずつ','Claude'),('切り替える','反映済みにする','未定')]
for i,(n,sub,a) in enumerate(st):
    s3+=box(bx[i],50,bw,58,i+1,n,sub,a, 'var(--ok)' if i==4 else 'var(--ink)')
    if i<4: s3+=arrow(bx[i]+bw+1,79,bx[i+1]-1)
s3+=todo(bx[0]+2,134,['送る日時','先月の区切り'])
s3+=todo(bx[2]+2,134,['記録の渡し方','反映前の確認'])
s3+=todo(bx[3]+2,134,['打刻が無い日'])
s3+=todo(bx[4]+2,134,['誰が切り替えるか'])
s3+='</svg>'

# 状態
s4=f'<svg {X} viewBox="0 0 700 170" role="img" aria-label="記録の 3 つの状態。反映待ちから反映済みか失敗へ進む。失敗のあとは未定">'
def st_box(x,y,name,sub,color):
    return f'<rect x="{x}" y="{y}" width="170" height="56" rx="28" fill="var(--paper)" stroke="{color}" stroke-width="2"/><text x="{x+85}" y="{y+24}" text-anchor="middle" font-size="12.5" font-weight="700" fill="{color}">{name}</text><text x="{x+85}" y="{y+42}" text-anchor="middle" font-size="10.5" fill="var(--muted)">{sub}</text>'
s4+=st_box(10,57,'反映待ち','LINE で記録した直後','var(--accent)')
s4+=st_box(300,4,'反映済み','次の依頼では飛ばす','var(--ok)')
s4+=st_box(300,110,'失敗','画面で直せなかった','var(--err)')
s4+='<path d="M 182 74 C 230 60, 250 36, 294 32" stroke="var(--ok)" stroke-width="2" fill="none"/><path d="M 286 27 L 295 32 L 287 38" stroke="var(--ok)" stroke-width="2" fill="none"/>'
s4+='<path d="M 182 96 C 230 110, 250 134, 294 138" stroke="var(--err)" stroke-width="2" fill="none"/><path d="M 286 132 L 295 138 L 287 144" stroke="var(--err)" stroke-width="2" fill="none"/>'
s4+='<text x="196" y="44" font-size="10.5" fill="var(--muted)">直せた</text><text x="196" y="138" font-size="10.5" fill="var(--muted)">直せなかった</text>'
s4+='<path d="M 474 138 L 520 138" stroke="var(--warn)" stroke-width="2" stroke-dasharray="4 4" fill="none"/>'
s4+=todo(530,134,['このあとの扱い'])
s4+='</svg>'

rows=[
 ['毎日','送る文の書き方をどこまで許すか（「2 時間」「1.5h」「21:30 まで」など）'],
 ['毎日','前の日の分を、後から日付を付けて送れるようにするか'],
 ['毎日','日付や残業分を読み取れなかったときの返し方'],
 ['毎日','記録した内容を見る方法と、取り消す方法'],
 ['休日','どの日を休日とみなすか（土日だけか、祝日や会社の休みも含むか）'],
 ['休日','聞き返しに答えなかったときの扱い'],
 ['月初め','通知を送る日時（毎月何日の何時か）'],
 ['月初め','「先月分」の区切り（暦の月か、締め日があるか）'],
 ['月初め','Claude が記録をどう受け取るか'],
 ['月初め','反映の前に、一覧を見て確かめる手順を挟むか'],
 ['月初め','クラウド勤怠に打刻が無い日の扱い（出勤時刻も入れるか）'],
 ['月初め','反映済みへの切り替えを誰がするか'],
 ['月初め','失敗した記録の扱いと、やり直し方'],
]
c={
 "kicker":"使い方の下書き / 細かい仕様を決める前の全体図",
 "title":"kintai は平日の夜に LINE へ 1 通送り、月初めに Claude へ 1 回頼むだけで残業をクラウド勤怠に届ける",
 "conclusion":"使う場面は**毎日**と**月初め**の 2 つ。平日の夜は LINE に残業時間を送り、月初めは Claude in Chrome に先月分の反映を頼む。骨組みは決まっていて、細部に**決めること 13 件**が残っている。",
 "three_lines":[
  "平日の夜は、残業時間を LINE に送ると記録され、**返信で記録内容を確かめられる**。",
  "月初めは通知を受けたら、Claude がクラウド勤怠の**退勤時刻を 1 件ずつ直して**反映する。",
  "図の**橙色の印が決めること**で、最後の表に場面ごとにまとめた。"],
 "hero":{"src":"hero.svg","alt":"kintai の使い方の 2 場面。左は毎日の記録、右は月初めの反映","caption":"左が毎日、右が月初めの流れ。「決めることあり」の印が付いた場面に、まだ決めることが残っている。","width":1200,"height":440},
 "sections":[
  {"heading":"平日の夜は LINE に残業時間を送るだけで記録される",
   "body":["送った文は記録係が受け取る。記録係は、データを預かるクラウドの保管サービス（Supabase）の上で動く受付の仕組みで、Claude に文を読ませて日付と残業分を取り出す。",
           "取り出した値は「反映待ち」の記録として保存され、LINE に「10/2 残業 120 分で記録しました」と返る。返信を見れば、読み取りの間違いにその場で気づける。",
           "この場面で決めることは 4 つある。送る文の書き方の幅、前の日の分の扱い、読み取れないときの返し方、記録を見る・取り消す方法だ。"],
   "svg":s1,"fig_caption":"番号の順に流れる。箱の上は動く人、橙の文字はまだ決めること。"},
  {"heading":"休日と送り直しの 2 つだけは流れが分かれる",
   "body":["休日には定時がないので、残業時間だけでは退勤時刻が決まらない。そのため記録係は、出勤と退勤の時刻を LINE で聞き返す。",
           "同じ日に 2 回送ったときは、後の値で上書きし、更新したことを LINE で知らせる。打ち間違えても、送り直せば直る。",
           "休日の側には決めることが 2 つ残る。どの日を休日とみなすかと、聞き返しに答えなかったときの扱いだ。"],
   "svg":s2,"fig_caption":"左が休日、右が同じ日の送り直し。橙の文字はまだ決めること。"},
  {"heading":"月初めは通知を合図に、Claude がクラウド勤怠の退勤時刻を直していく",
   "body":["クラウド勤怠には、勤怠を書き換える公開の窓口（API）がない。CSV の取り込みは全権管理者専用で、その日の打刻が丸ごと上書きされる。だから本人がログインした画面を Claude in Chrome に操作させる。",
           "画面で直すのは退勤時刻だけで、申請や承認は要らない。退勤時刻は定時の 19:00 に残業時間を足して決め、実際の打刻には足さない。",
           "この場面は決めることが最も多い。Claude が記録をどう受け取るかが決まると、切り替え役と失敗時の扱いも決めやすくなる。"],
   "svg":s3,"fig_caption":"上の帯が段階。5 つの手順のうち 4 つに、まだ決めることがある。",
   "table":{"headers":["その日の状況","クラウド勤怠に入れる退勤時刻"],"rows":[["平日・残業 2 時間","21:00"],["平日・残業 6 時間","翌 1:00（日付をまたぐ）"],["休日","LINE で聞き返した出勤・退勤の時刻"]]},
   "table_caption":"退勤時刻の決め方。定時は平日 10:00〜19:00 で、曜日による差はない。"},
  {"heading":"記録は 1 件ずつ「反映待ち・反映済み・失敗」のどれかを持つ",
   "body":["状態を 1 件ごとに持つのは、反映が途中で止まっても続きから再開するためだ。反映済みの印があれば、同じ日を二重に入力せずに済む。",
           "失敗した記録のその後は決まっていない。次の依頼で失敗分だけやり直すのか、LINE で知らせるのかを決める必要がある。"],
   "svg":s4,"fig_caption":"記録が月初めにたどる状態。失敗のあとだけが、まだ決まっていない。"},
  {"heading":"決めること 13 件を場面ごとに並べた",
   "body":["図の橙の文字を 1 つの表にまとめた。月初めの 7 件は互いにつながっているので、まとめて決めると手戻りが少ない。"],
   "table":{"headers":["場面","決めること"],"rows":rows},
   "table_caption":"まだ決めていないこと。答えが決まったものから設計文書に残していく。"}
 ],
 "callout":{"label":"次の一手","text":"月初めの**記録の渡し方**から決める。反映済みへの切り替え役と失敗時の扱いが、そこから決まっていく。"},
 "meta":{"date":"2026-10-02","source":"kintai の設計メモ（2026-10-02 の決定事項）と、そこから移した設計文書の決定 11 件"}
}
json.dump(c,open('content.json','w'),ensure_ascii=False,indent=1)
