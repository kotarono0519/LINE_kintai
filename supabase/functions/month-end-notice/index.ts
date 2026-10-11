// 月の最後の平日の 18:00 に、反映を頼む合図を LINE の push で送る入口。
// 呼ぶのは Supabase の cron（pg_cron）だけ。合言葉（CRON_SECRET）を Bearer で確かめる。
import { createClient } from "@supabase/supabase-js";
import { isLastWeekday } from "../_shared/holiday.ts";
import { makeDate, monthKey, splitDate, toJstNow } from "../_shared/jst.ts";
import { pushText } from "../_shared/line.ts";
import { createSupabaseStore } from "../_shared/store_supabase.ts";
import type { IsoDate, Store } from "../_shared/types.ts";

export interface NoticeEnv {
  cronSecret: string | undefined; // 未設定なら全部断る
  userId: string | undefined; // 本人の LINE ユーザー ID
}

/** 入口が外から受け取るもの。テストでは偽物に差し替える */
export interface NoticeDeps {
  store: Store;
  now: () => number; // エポックミリ秒
  push: (to: string, text: string) => Promise<void>;
}

/** 合図の文。月はその日の月 */
export function noticeText(date: IsoDate, openQuestions: number): string {
  const { month } = splitDate(date);
  const body =
    `今日は今月の最後の平日です。今日の残業を送ってから、Claude Code に『${month}月分を反映して』と頼んでください`;
  return openQuestions > 0
    ? `${body}\n\n答えていない聞き返しが ${openQuestions} 件あります`
    : body;
}

/** 合言葉を時間が一定になる比べ方で照合する（長さが違っても同じ長さの印にして比べる） */
async function secretMatches(given: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all(
    [given, secret].map(async (s) =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))
    ),
  );
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function createHandler(env: NoticeEnv, makeDeps: () => NoticeDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const auth = req.headers.get("authorization") ?? "";
    const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    // 合言葉が未設定のときは、空の Bearer でも通さない
    if (!env.cronSecret || !(await secretMatches(given, env.cronSecret))) {
      return new Response("Unauthorized", { status: 401 });
    }

    // 試し用の "date"（YYYY-MM-DD）。無ければ今の日本時間の日付
    let override: IsoDate | undefined;
    const raw = await req.text();
    if (raw.trim() !== "") {
      let body: { date?: unknown };
      try {
        body = JSON.parse(raw) as { date?: unknown };
      } catch {
        return json({ error: "本文を JSON として読めません" }, 400);
      }
      if (body.date !== undefined) {
        const m = typeof body.date === "string"
          ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(body.date)
          : null;
        const { year, month, day } = m
          ? { year: +m[1], month: +m[2], day: +m[3] }
          : { year: 0, month: 0, day: 0 };
        override = makeDate(year, month, day) ?? undefined;
        if (!override) {
          return json({ error: "date は YYYY-MM-DD で指定してください" }, 400);
        }
      }
    }

    let deps: NoticeDeps;
    try {
      deps = makeDeps();
    } catch (e) {
      console.error(
        "準備に失敗しました（環境変数を確かめてください）",
        e,
      );
      return json({ error: "準備に失敗しました" }, 500);
    }

    const date = override ?? toJstNow(deps.now()).date;
    if (!isLastWeekday(date)) return json({ sent: false, date });

    if (!env.userId) {
      console.error("LINE_USER_ID が未設定のため合図を送れません");
      return json({ error: "LINE_USER_ID が未設定です", date }, 500);
    }
    try {
      const n = await deps.store.countOpenQuestions();
      await deps.push(env.userId, noticeText(date, n));
    } catch (e) {
      console.error("合図の送信に失敗しました", e);
      return json({ error: "合図の送信に失敗しました", date }, 502);
    }
    return json({ sent: true, date, month: monthKey(date) });
  };
}

if (import.meta.main) {
  const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
  const env: NoticeEnv = {
    cronSecret: Deno.env.get("CRON_SECRET") || undefined,
    userId: Deno.env.get("LINE_USER_ID") || undefined,
  };
  Deno.serve(createHandler(env, () => {
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    return {
      store: createSupabaseStore(client),
      now: () => Date.now(),
      push: (to, text) => pushText(to, text, accessToken),
    };
  }));
}
