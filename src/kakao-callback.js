// 2026-11-28 rev.15 — 카카오에서 돌아온 손님 받기 (GET /api/kakao/callback)
// 1) 카카오 본인 확인 (공통)
// 2) 시작할 때 적어 둔 목적(mode)에 따라
//    signup: 처음이면 members에 닉네임 없이 저장 + 입장권 → nickname.html / 이미 회원이면 "이미 가입된 회원입니다" 후 로그인
//    login : 회원이면 최근 로그인 날짜 바꾸고 홈 / 아니면 "먼저 가입해 주세요" → 가입 화면 / 닉네임 없으면 nickname.html
//    admin : 관리자 회원번호면 관리자 페이지 (rev.12 그대로)

import {
  SESSION_COOKIE, STATE_COOKIE, SESSION_HOURS,
  b64urlText, hmac, getCookie, cookie, adminIds, esc, infoPage,
} from "./common.js";
import { MODE_COOKIE, MODES } from "./kakao-login.js";

export const TICKET_COOKIE = "signup_ticket";
export const TICKET_MINUTES = 10;
export const NICK_KEY = "member_nickname"; // 브라우저(localStorage)에 닉네임을 기억하는 이름

const PROVIDER = "kakao";
const KST_NOW = "datetime('now', '+9 hours')";

// 잠깐 안내를 보여 주고 다음 화면으로 넘어가는 페이지 (닉네임을 브라우저에 기억/지움)
export function movePage({ message = "", next = "/", nickname, wait = 1500, headers }) {
  const nickJs = JSON.stringify(nickname === undefined ? null : nickname).replace(/</g, "\\u003c");
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(message || "이동 중")}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1210;color:#fff;font-family:Pretendard,"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;text-align:center;padding:20px}
p{font-size:20px;font-weight:700;margin:0}.s{color:#b9beb7;font-size:14px;font-weight:400;margin-top:10px}</style></head>
<body><div><p>${esc(message || "잠시만 기다려 주세요…")}</p><p class="s">잠시 후 이동합니다.</p></div>
<script>(function(){var n=${nickJs};try{if(n)localStorage.setItem(${JSON.stringify(NICK_KEY)},n);}catch(e){}
setTimeout(function(){location.replace(${JSON.stringify(next)})},${message ? wait : 0});})();</script></body></html>`;
  const h = new Headers(headers || {});
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set("Cache-Control", "no-store");
  return new Response(html, { status: 200, headers: h });
}

// 입장권을 새로 만들어 저장하고 nickname.html로 보냄
async function goNickname(env, memberId, headers) {
  const ticket = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  await env.DB
    .prepare(`UPDATE members SET signup_token = ?, signup_token_at = ${KST_NOW} WHERE id = ?`)
    .bind(ticket, memberId)
    .run();
  headers.append("Set-Cookie", cookie(TICKET_COOKIE, ticket, TICKET_MINUTES * 60));
  headers.set("Location", "/nickname.html");
  return new Response(null, { status: 302, headers });
}

async function touchLogin(env, memberId) {
  await env.DB.prepare(`UPDATE members SET last_login_at = ${KST_NOW} WHERE id = ?`).bind(memberId).run();
}

const findMember = (env, id) =>
  env.DB
    .prepare("SELECT id, nickname FROM members WHERE provider = ? AND provider_user_id = ?")
    .bind(PROVIDER, id)
    .first();

export async function kakaoCallback(request, env) {
  const url = new URL(request.url);
  const mode = MODES.includes(getCookie(request, MODE_COOKIE)) ? getCookie(request, MODE_COOKIE) : "admin";
  const clear = () => {
    const h = new Headers();
    h.append("Set-Cookie", cookie(STATE_COOKIE, "", 0));
    h.append("Set-Cookie", cookie(MODE_COOKIE, "", 0));
    return h;
  };
  const back = mode === "signup" ? "/signup.html" : mode === "login" ? "/login.html" : "/";

  if (url.searchParams.get("error")) {
    return movePage({ message: "카카오 로그인을 취소했습니다", next: back, headers: clear() });
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== getCookie(request, STATE_COOKIE)) {
    return movePage({ message: "로그인 확인 값이 맞지 않습니다. 다시 시도해 주세요", next: back, wait: 2000, headers: clear() });
  }

  // ===== 1) 카카오 본인 확인 =====
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.KAKAO_REST_API_KEY,
    redirect_uri: `${url.origin}/api/kakao/callback`,
    code,
  });
  if (env.KAKAO_CLIENT_SECRET) form.set("client_secret", env.KAKAO_CLIENT_SECRET);
  const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: form,
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) {
    const why = token.error_code || token.error || tokenRes.status;
    return infoPage("카카오 로그인에 실패했습니다", `<p>카카오에서 거절했습니다. (사유 코드: ${esc(why)})</p><p class="small">REST API 키, Client Secret, 카카오 디벨로퍼에 등록한 Redirect URI가 맞는지 확인해 주세요.</p>`, 400, Object.fromEntries([["Set-Cookie", cookie(STATE_COOKIE, "", 0)]]));
  }
  const meRes = await fetch("https://kapi.kakao.com/v2/user/me", { headers: { Authorization: `Bearer ${token.access_token}` } });
  const me = await meRes.json().catch(() => ({}));
  if (!meRes.ok || !me.id) {
    return movePage({ message: "카카오 회원 정보를 받지 못했습니다. 다시 시도해 주세요", next: back, wait: 2000, headers: clear() });
  }
  const id = String(me.id);
  const acc = me.kakao_account || {};
  const email = acc.email && acc.is_email_valid !== false ? String(acc.email).slice(0, 254) : null;

  // ===== 2-a) 관리자 =====
  if (mode === "admin") return adminLogin(env, id, me, clear());

  if (!env.DB) return movePage({ message: "서버 설정이 아직 끝나지 않았습니다", next: "/", wait: 2000, headers: clear() });

  try {
    let member = await findMember(env, id);

    // ===== 2-b) 회원가입 =====
    if (mode === "signup") {
      if (!member) {
        member = await env.DB
          .prepare("INSERT INTO members (provider, provider_user_id, email) VALUES (?, ?, ?) ON CONFLICT (provider, provider_user_id) DO NOTHING RETURNING id, nickname")
          .bind(PROVIDER, id, email)
          .first() || (await findMember(env, id));
        if (!member.nickname) return goNickname(env, member.id, clear());
      }
      if (!member.nickname) return goNickname(env, member.id, clear());
      await touchLogin(env, member.id);
      return movePage({ message: "이미 가입된 회원입니다", next: "/", nickname: member.nickname, headers: clear() });
    }

    // ===== 2-c) 로그인 =====
    if (!member) return movePage({ message: "먼저 가입해 주세요", next: "/signup.html", headers: clear() });
    if (!member.nickname) return goNickname(env, member.id, clear());
    await touchLogin(env, member.id);
    return movePage({ next: "/", nickname: member.nickname, headers: clear() });
  } catch (e) {
    const msg = String(e && e.message);
    const why = msg.includes("no such table") ? "회원 표(members)가 아직 없습니다. 관리자에게 문의해 주세요" : "잠시 뒤 다시 시도해 주세요";
    return movePage({ message: why, next: back, wait: 2500, headers: clear() });
  }
}

// 관리자 로그인 (rev.12와 같은 동작)
async function adminLogin(env, id, me, headers) {
  const nick = (me.properties && me.properties.nickname) || (me.kakao_account && me.kakao_account.profile && me.kakao_account.profile.nickname) || "";
  if (!adminIds(env).includes(id)) {
    const h = Object.fromEntries([["Set-Cookie", cookie(STATE_COOKIE, "", 0)]]);
    return infoPage(
      "관리자 권한이 없습니다",
      `<p>이 카카오 계정은 관리자로 등록되어 있지 않습니다.</p><p>내 카카오 회원번호</p><div class="num">${esc(id)}</div>
<p class="small">관리자라면 이 번호를 Cloudflare &gt; Settings &gt; Variables and Secrets 의 <b>ADMIN_KAKAO_IDS</b>(Secret)에 넣은 뒤 다시 로그인해 주세요.</p>`,
      403,
      h
    );
  }
  const data = b64urlText(JSON.stringify({ id, nick, exp: Date.now() + SESSION_HOURS * 3600 * 1000 }));
  const sig = await hmac(env.SESSION_SECRET, data);
  headers.set("Location", "/admin.html");
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, `${data}.${sig}`, SESSION_HOURS * 3600));
  return new Response(null, { status: 302, headers });
}
