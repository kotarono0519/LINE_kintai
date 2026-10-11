// 入口（createHandler）の確かめ。文の受付と返信は偽物に差し替える。
import { assertEquals } from "@std/assert";
import {
  EXAMPLES_TEXT,
  FOLLOW_TEXT,
  handleFollow,
  handleParsed,
  handleText,
  MSG,
} from "../_shared/handle.ts";
import {
  APOLOGY_REPLY,
  createHandler,
  type WebhookDeps,
} from "../line-webhook/index.ts";
import type { JstNow } from "../_shared/types.ts";
import { MemoryStore } from "./memory_store.ts";

const SECRET = "test-secret";
const ME = "U-me";
const FOOTER = "\n\n答えていない聞き返しが 1 件あります";

async function sign(body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(body)),
  );
  return btoa(String.fromCharCode(...mac));
}

/** 偽物の部品と、呼ばれた中身の控え */
function setup(
  opts: {
    userId?: string;
    handleText?: WebhookDeps["handleText"];
    now?: JstNow;
  } = {},
) {
  const store = new MemoryStore();
  const replies: { token: string; text: string }[] = [];
  const texts: { text: string; now: JstNow }[] = [];
  const deps: WebhookDeps = {
    store,
    isHoliday: () => false,
    handleText: opts.handleText ?? ((text, now) => {
      texts.push({ text, now });
      return Promise.resolve(`受けた: ${text}`);
    }),
    handleParsed,
    handleFollow,
    toJstNow: () => opts.now ?? { date: "2026-10-06", hour: 12, minute: 0 },
    reply: (token, text) => {
      replies.push({ token, text });
      return Promise.resolve();
    },
  };
  const userId = "userId" in opts ? opts.userId : ME;
  const handler = createHandler({ channelSecret: SECRET, userId }, () => deps);
  return { handler, store, replies, texts };
}

async function post(
  handler: (req: Request) => Promise<Response>,
  events: unknown[],
  signature?: string,
): Promise<Response> {
  const body = JSON.stringify({ destination: "x", events });
  return await handler(
    new Request("http://localhost/line-webhook", {
      method: "POST",
      headers: { "x-line-signature": signature ?? await sign(body) },
      body,
    }),
  );
}

function textEvent(text: string, id = "ev1", userId = ME) {
  return {
    type: "message",
    timestamp: 1791259200000,
    webhookEventId: id,
    replyToken: `reply-${id}`,
    source: { type: "user", userId },
    message: { type: "text", id: "m1", text },
  };
}

Deno.test("webhook: 署名が違えば 401 で、何もしない", async () => {
  const { handler, replies } = setup();
  const res = await post(handler, [textEvent("今日2時間")], "AAAA");
  assertEquals(res.status, 401);
  await res.body?.cancel();
  assertEquals(replies, []);
});

Deno.test("webhook: POST 以外は受けない", async () => {
  const { handler } = setup();
  const res = await handler(new Request("http://localhost/line-webhook"));
  assertEquals(res.status, 405);
  await res.body?.cancel();
});

Deno.test("webhook: events が空（接続確認）なら 200", async () => {
  const { handler, replies } = setup();
  const res = await post(handler, []);
  assertEquals(res.status, 200);
  await res.body?.cancel();
  assertEquals(replies, []);
});

Deno.test("webhook: 本人以外のイベントは返事をせず捨てる", async () => {
  const { handler, replies, texts, store } = setup();
  const res = await post(handler, [textEvent("今日2時間", "ev1", "U-other")]);
  assertEquals(res.status, 200);
  await res.body?.cancel();
  assertEquals(replies, []);
  assertEquals(texts, []);
  assertEquals(store.processed.size, 0);
});

Deno.test("webhook: LINE_USER_ID が未設定なら全部捨てる", async () => {
  const { handler, replies } = setup({ userId: undefined });
  const res = await post(handler, [textEvent("今日2時間")]);
  assertEquals(res.status, 200);
  await res.body?.cancel();
  assertEquals(replies, []);
});

Deno.test("webhook: 文は受付に渡し、返事を reply で返す", async () => {
  const { handler, replies, texts } = setup();
  const res = await post(handler, [textEvent("今日2時間")]);
  assertEquals(res.status, 200);
  await res.body?.cancel();
  assertEquals(texts, [{
    text: "今日2時間",
    now: { date: "2026-10-06", hour: 12, minute: 0 },
  }]);
  assertEquals(replies, [{ token: "reply-ev1", text: "受けた: 今日2時間" }]);
});

Deno.test("webhook: 同じイベントは二度処理しない", async () => {
  const { handler, replies } = setup();
  (await post(handler, [textEvent("今日2時間")])).body?.cancel();
  (await post(handler, [textEvent("今日2時間")])).body?.cancel();
  assertEquals(replies.length, 1);
});

Deno.test("webhook: スタンプなど文字以外には送り方の例を返す", async () => {
  const { handler, replies, texts } = setup();
  const sticker = { ...textEvent(""), message: { type: "sticker", id: "m1" } };
  (await post(handler, [sticker])).body?.cancel();
  assertEquals(texts, []);
  assertEquals(replies, [{ token: "reply-ev1", text: EXAMPLES_TEXT }]);
});

Deno.test("webhook: スタンプへの返事にも、答えていない聞き返しの知らせを付ける", async () => {
  // 01:00 に「2時間」で聞き返しが置かれたあと、スタンプを送る
  const { handler, replies } = setup({
    handleText,
    now: { date: "2026-10-06", hour: 1, minute: 0 },
  });
  const sticker = {
    ...textEvent("", "ev2"),
    message: { type: "sticker", id: "m2" },
  };
  (await post(handler, [textEvent("2時間"), sticker])).body?.cancel();
  assertEquals(replies, [
    { token: "reply-ev1", text: MSG.nightQuestion },
    { token: "reply-ev2", text: EXAMPLES_TEXT + FOOTER },
  ]);
});

Deno.test("webhook: 友だち追加にはあいさつを返し、ほかのイベントは無視する", async () => {
  const { handler, replies } = setup();
  const base = {
    timestamp: 1791259200000,
    source: { type: "user", userId: ME },
  };
  (await post(handler, [
    { ...base, type: "follow", webhookEventId: "f1", replyToken: "reply-f1" },
    { ...base, type: "unfollow", webhookEventId: "u1" },
  ])).body?.cancel();
  assertEquals(replies, [{ token: "reply-f1", text: FOLLOW_TEXT }]);
});

Deno.test("webhook: 友だち追加（ブロック解除）にも聞き返しの知らせを付ける", async () => {
  const { handler, replies, store } = setup();
  store.dateQuestion = { action: "set", minutes: 60 };
  (await post(handler, [{
    type: "follow",
    timestamp: 1791259200000,
    webhookEventId: "f1",
    replyToken: "reply-f1",
    source: { type: "user", userId: ME },
  }])).body?.cancel();
  assertEquals(replies, [{ token: "reply-f1", text: FOLLOW_TEXT + FOOTER }]);
});

Deno.test("webhook: 受付が例外を投げたら、おわびを返して 200", async () => {
  const { handler, replies } = setup({
    handleText: () => Promise.reject(new Error("DB が落ちた")),
  });
  const res = await post(handler, [textEvent("今日2時間")]);
  assertEquals(res.status, 200);
  await res.body?.cancel();
  assertEquals(replies, [{ token: "reply-ev1", text: APOLOGY_REPLY }]);
});

Deno.test("webhook: 署名が合っていれば、壊れた本文や準備の失敗でも 200", async () => {
  const { handler } = setup();
  const body = "{not json";
  const res1 = await handler(
    new Request("http://localhost/line-webhook", {
      method: "POST",
      headers: { "x-line-signature": await sign(body) },
      body,
    }),
  );
  assertEquals(res1.status, 200);
  await res1.body?.cancel();

  const failing = createHandler({ channelSecret: SECRET, userId: ME }, () => {
    throw new Error("SUPABASE_URL がない");
  });
  const res2 = await post(failing, [textEvent("今日2時間")]);
  assertEquals(res2.status, 200);
  await res2.body?.cancel();
});
