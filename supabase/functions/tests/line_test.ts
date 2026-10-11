// 署名の確かめと返信 API の確かめ。
import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import {
  pushText,
  replyText,
  splitText,
  verifySignature,
} from "../_shared/line.ts";

const SECRET = "test-secret";

async function sign(body: string, secret = SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(body)),
  );
  return btoa(String.fromCharCode(...mac));
}

Deno.test("verifySignature: 正しい署名は通る", async () => {
  const body = JSON.stringify({
    events: [{ type: "message", message: { text: "今日2時間" } }],
  });
  assert(await verifySignature(body, await sign(body), SECRET));
});

Deno.test("verifySignature: 違う署名・違う鍵・変えた本文・壊れた base64 は通らない", async () => {
  const body = '{"events":[]}';
  assertFalse(await verifySignature(body, await sign(body, "other"), SECRET));
  assertFalse(await verifySignature(body + " ", await sign(body), SECRET));
  assertFalse(await verifySignature(body, "%%%not-base64%%%", SECRET));
  assertFalse(await verifySignature(body, "", SECRET));
});

Deno.test("verifySignature: 署名が無い・鍵が無いときは通らない", async () => {
  const body = '{"events":[]}';
  assertFalse(await verifySignature(body, null, SECRET));
  assertFalse(await verifySignature(body, await sign(body), ""));
});

Deno.test("splitText: 5000 字以下はそのまま 1 つ", () => {
  assertEquals(splitText("こんにちは"), ["こんにちは"]);
  assertEquals(splitText("あ".repeat(5000)), ["あ".repeat(5000)]);
});

Deno.test("splitText: 5000 字を超えると改行の位置で切る", () => {
  const line = "あ".repeat(99) + "\n"; // 100 字
  const parts = splitText(line.repeat(60)); // 6000 字
  assertEquals(parts.length, 2);
  for (const p of parts) assert(Array.from(p).length <= 5000);
  assertEquals(parts[0], line.repeat(50).trimEnd());
  assertEquals(parts.join("\n"), line.repeat(60).trimEnd());
});

Deno.test("splitText: 改行が無ければ 5000 字で切り、吹き出しは最大 5 つ", () => {
  const parts = splitText("😀".repeat(30000)); // サロゲートペアを割らない
  assertEquals(parts.length, 5);
  for (const p of parts) assertEquals(Array.from(p).length, 5000);
});

Deno.test("replyText: reply API に Bearer で送り、長い文は複数の吹き出しにする", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  await replyText("tok", "い".repeat(7000), "access", fakeFetch);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "https://api.line.me/v2/bot/message/reply");
  const headers = new Headers(calls[0].init.headers);
  assertEquals(headers.get("authorization"), "Bearer access");
  const sent = JSON.parse(calls[0].init.body as string);
  assertEquals(sent.replyToken, "tok");
  assertEquals(sent.messages.length, 2);
  assertEquals(sent.messages[0], { type: "text", text: "い".repeat(5000) });
  assertEquals(sent.messages[1].text.length, 2000);
});

Deno.test("replyText: 2xx 以外なら状態と本文を付けて投げる", async () => {
  const fakeFetch = (() =>
    Promise.resolve(
      new Response('{"message":"Invalid reply token"}', { status: 400 }),
    )) as typeof fetch;
  const err = await assertRejects(
    () => replyText("tok", "hi", "access", fakeFetch),
    Error,
  );
  assert(err.message.includes("400"));
  assert(err.message.includes("Invalid reply token"));
});

Deno.test("pushText: push API に to を付けて Bearer で送り、長い文は複数の吹き出しにする", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  await pushText("U-me", "い".repeat(7000), "access", fakeFetch);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "https://api.line.me/v2/bot/message/push");
  assertEquals(calls[0].init.method, "POST");
  const headers = new Headers(calls[0].init.headers);
  assertEquals(headers.get("authorization"), "Bearer access");
  const sent = JSON.parse(calls[0].init.body as string);
  assertEquals(sent.to, "U-me");
  assertEquals(sent.messages.length, 2);
  assertEquals(sent.messages[0], { type: "text", text: "い".repeat(5000) });
});

Deno.test("pushText: 2xx 以外なら状態と本文を付けて投げる", async () => {
  const fakeFetch = (() =>
    Promise.resolve(
      new Response('{"message":"Invalid user"}', { status: 400 }),
    )) as typeof fetch;
  const err = await assertRejects(
    () => pushText("U-me", "hi", "access", fakeFetch),
    Error,
  );
  assert(err.message.includes("400"));
  assert(err.message.includes("Invalid user"));
});
