// LINE の Webhook の入口。署名を確かめ、本人の文だけを受付に渡して reply API で返事する。
import { createClient } from "@supabase/supabase-js";
import { handleFollow, handleParsed, handleText } from "../_shared/handle.ts";
import { isHoliday } from "../_shared/holiday.ts";
import { toJstNow } from "../_shared/jst.ts";
import { replyText, verifySignature } from "../_shared/line.ts";
import { createSupabaseStore } from "../_shared/store_supabase.ts";
import type { HandlerDeps, JstNow, Parsed, Store } from "../_shared/types.ts";

export const APOLOGY_REPLY =
  "うまく記録できませんでした。少し待ってからもう一度送ってください";

export interface WebhookEnv {
  channelSecret: string;
  userId: string | undefined; // 本人の LINE ユーザー ID。未設定なら全部捨てる
}

/** 入口が外から受け取るもの。テストでは偽物に差し替える */
export interface WebhookDeps {
  store: Store;
  isHoliday: (date: string) => boolean;
  handleText: (text: string, now: JstNow, deps: HandlerDeps) => Promise<string>;
  // スタンプなど文字以外は「読めない文」として渡す（送り方の例＋末尾の知らせ）
  handleParsed: (
    parsed: Parsed,
    now: JstNow,
    deps: HandlerDeps,
  ) => Promise<string>;
  handleFollow: (deps: HandlerDeps) => Promise<string>;
  toJstNow: (ms: number) => JstNow;
  reply: (replyToken: string, text: string) => Promise<void>;
}

// 使う分だけの LINE のイベントの形
interface LineEvent {
  type: string;
  timestamp: number;
  webhookEventId?: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; text?: string };
}

export function createHandler(env: WebhookEnv, makeDeps: () => WebhookDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await req.text();
    const ok = await verifySignature(
      body,
      req.headers.get("x-line-signature"),
      env.channelSecret,
    );
    if (!ok) return new Response("Unauthorized", { status: 401 });

    let events: LineEvent[];
    try {
      events = (JSON.parse(body) as { events?: LineEvent[] }).events ?? [];
    } catch (e) {
      // 署名が合っていれば LINE には 200 を返す（送り直されても直らないため）
      console.error("本文を JSON として読めませんでした", e);
      return new Response("OK");
    }
    if (events.length === 0) return new Response("OK"); // 接続確認

    let deps: WebhookDeps;
    try {
      deps = makeDeps();
    } catch (e) {
      console.error(
        "保管の準備に失敗しました（環境変数を確かめてください）",
        e,
      );
      return new Response("OK");
    }
    for (const event of events) {
      await handleEvent(event, env, deps);
    }
    return new Response("OK");
  };
}

async function handleEvent(
  event: LineEvent,
  env: WebhookEnv,
  deps: WebhookDeps,
): Promise<void> {
  const userId = event.source?.userId;
  if (!env.userId || userId !== env.userId) {
    // 本人の ID を調べられるようにログに出す
    console.log(
      `本人以外のイベントを捨てました: userId=${userId} type=${event.type}`,
    );
    return;
  }

  // 返事を作る処理を決める。それ以外のイベントは無視する
  const handlerDeps: HandlerDeps = {
    store: deps.store,
    isHoliday: deps.isHoliday,
  };
  let respond: () => Promise<string>;
  if (event.type === "message" && event.message?.type === "text") {
    const text = event.message.text ?? "";
    respond = () =>
      deps.handleText(text, deps.toJstNow(event.timestamp), handlerDeps);
  } else if (event.type === "message") {
    respond = () =>
      deps.handleParsed(
        { type: "unreadable" },
        deps.toJstNow(event.timestamp),
        handlerDeps,
      );
  } else if (event.type === "follow") {
    respond = () => deps.handleFollow(handlerDeps);
  } else {
    return;
  }
  const replyToken = event.replyToken;
  if (!replyToken) return;

  try {
    if (
      event.webhookEventId &&
      !(await deps.store.markEventProcessed(event.webhookEventId))
    ) {
      console.log(`処理済みのイベントを捨てました: ${event.webhookEventId}`);
      return;
    }
    await deps.reply(replyToken, await respond());
  } catch (e) {
    console.error("イベントの処理に失敗しました", e);
    try {
      await deps.reply(replyToken, APOLOGY_REPLY);
    } catch (e2) {
      console.error("おわびの返信にも失敗しました", e2);
    }
  }
}

if (import.meta.main) {
  const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
  const env: WebhookEnv = {
    channelSecret: Deno.env.get("LINE_CHANNEL_SECRET") ?? "",
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
      isHoliday,
      handleText,
      handleParsed,
      handleFollow,
      toJstNow,
      reply: (replyToken, text) => replyText(replyToken, text, accessToken),
    };
  }));
}
