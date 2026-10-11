// LINE とのやりとり（署名の確かめ・返信 API・push API）。

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const MAX_TEXT = 5000; // 1 つの吹き出しの上限（文字）
const MAX_BUBBLES = 5; // 1 回の返信で送れる吹き出しの上限

/**
 * x-line-signature を確かめる。本文の HMAC-SHA256（鍵はチャネルシークレット）を base64 にしたもの。
 * 比べるのは crypto.subtle.verify に任せる（時間が一定になる比べ方）。
 */
export async function verifySignature(
  body: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;
  let sig: Uint8Array<ArrayBuffer>;
  try {
    sig = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false; // base64 として読めない
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, sig, enc.encode(body));
}

/** 長い文を吹き出しの大きさに切る。なるべく改行の位置で切り、5 つを超える分は捨てる */
export function splitText(text: string): string[] {
  const chars = Array.from(text); // サロゲートペアを割らない
  const parts: string[] = [];
  let start = 0;
  while (start < chars.length && parts.length < MAX_BUBBLES) {
    let end = Math.min(start + MAX_TEXT, chars.length);
    if (end < chars.length) {
      const nl = chars.lastIndexOf("\n", end - 1);
      if (nl > start) end = nl + 1;
    }
    parts.push(chars.slice(start, end).join("").replace(/\n+$/, ""));
    start = end;
  }
  return parts.length > 0 ? parts : [""];
}

/** reply API で返事を送る。2xx 以外なら状態と本文を付けて投げる */
export async function replyText(
  replyToken: string,
  text: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(REPLY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: splitText(text).map((t) => ({ type: "text", text: t })),
    }),
  });
  if (!res.ok) {
    throw new Error(
      `LINE の返信に失敗しました: ${res.status} ${await res.text()}`,
    );
  }
  await res.body?.cancel();
}

/** push API で本人に送る（返事ではなく、こちらから送る合図用）。2xx 以外なら状態と本文を付けて投げる */
export async function pushText(
  to: string,
  text: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to,
      messages: splitText(text).map((t) => ({ type: "text", text: t })),
    }),
  });
  if (!res.ok) {
    throw new Error(
      `LINE の push に失敗しました: ${res.status} ${await res.text()}`,
    );
  }
  await res.body?.cancel();
}
