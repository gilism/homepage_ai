// 2026-11-28 rev.15 — 닉네임 저장 (POST /api/nickname, 처음 가입할 때 한 번만)
// - 입장권(쿠키)이 맞고 10분이 지나지 않았을 때만 저장
// - 닉네임 규칙: 2~12자, 한글·영문·숫자만 (앞뒤 띄어쓰기는 지움, 대소문자만 다르면 같은 닉네임)
// - 저장되면 입장권을 지우고 최근 로그인 날짜를 기록

import { json, getCookie, cookie } from "./common.js";
import { TICKET_COOKIE, TICKET_MINUTES } from "./kakao-callback.js";

export async function saveNickname(request, env) {
  if (request.method !== "POST") return json({ ok: false, message: "허용되지 않는 요청입니다." }, 405);
  if (!env.DB) return json({ ok: false, message: "서버 설정이 아직 끝나지 않았습니다." }, 500);

  const ticket = getCookie(request, TICKET_COOKIE);
  const expired = { ok: false, expired: true, message: "가입 시간(10분)이 지났습니다. 처음부터 다시 가입해 주세요." };
  if (!ticket) return json(expired, 401);

  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, message: "닉네임을 읽지 못했습니다." }, 400); }
  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
  if (!nickname) return json({ ok: false, message: "닉네임을 입력해 주세요." }, 400);
  if (!/^[가-힣a-zA-Z0-9]{2,12}$/.test(nickname)) {
    return json({ ok: false, message: "닉네임은 2~12자의 한글·영문·숫자로 정해 주세요." }, 400);
  }

  try {
    const row = await env.DB
      .prepare(
        "UPDATE members SET nickname = ?, signup_token = NULL, signup_token_at = NULL, last_login_at = datetime('now', '+9 hours') " +
          `WHERE signup_token = ? AND signup_token_at >= datetime('now', '+9 hours', '-${TICKET_MINUTES} minutes') AND nickname IS NULL ` +
          "RETURNING nickname"
      )
      .bind(nickname, ticket)
      .first();
    if (!row) return json(expired, 401);
    return new Response(JSON.stringify({ ok: true, nickname: row.nickname }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Set-Cookie": cookie(TICKET_COOKIE, "", 0) },
    });
  } catch (e) {
    if (String(e && e.message).includes("UNIQUE")) return json({ ok: false, message: "이미 사용 중인 닉네임입니다." }, 409);
    return json({ ok: false, message: "닉네임을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." }, 500);
  }
}
