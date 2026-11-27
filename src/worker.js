// 2026-11-27 rev.12 — 서버 코드 (Cloudflare Worker) · 카카오 관리자 로그인 추가
// 하는 일:
//   POST /api/apply             특강 신청을 D1(DB)의 applicants 표에 저장
//   GET  /api/kakao/login       카카오 로그인 화면으로 보냄
//   GET  /api/kakao/callback    카카오에서 돌아오면 관리자인지 확인 → 관리자면 /admin.html 로
//   GET  /api/admin/applicants  관리자만 신청자 목록을 받음
//   GET  /api/logout            로그아웃
// 그 밖의 주소는 public 폴더의 화면 파일을 보여 줌
//
// 비밀값은 코드에 넣지 않음. Cloudflare > Settings > Variables and Secrets 에 Type "Secret"으로:
//   KAKAO_REST_API_KEY   카카오 REST API 키
//   KAKAO_CLIENT_SECRET  카카오 Client Secret
//   SESSION_SECRET       로그인 상태를 지키는 비밀 열쇠 (직접 지은 30자 이상)
//   ADMIN_KAKAO_IDS      관리자 카카오 회원번호 (여러 명이면 쉼표로: 123,456)

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

// ===== 신청 저장 =====
async function handleApply(request, env) {
  if (request.method !== "POST") return json({ ok: false, message: "허용되지 않는 요청입니다." }, 405);
  if (!env.DB) return json({ ok: false, message: "서버 설정이 아직 끝나지 않았습니다. 관리자에게 문의해 주세요." }, 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, message: "신청 내용을 읽지 못했습니다. 다시 시도해 주세요." }, 400);
  }

  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = clean(body.name, 50);
  const phone = clean(body.phone, 30);
  const email = clean(body.email, 254);
  const organization = clean(body.organization, 100);
  const position = clean(body.position, 50);

  if (!name) return json({ ok: false, message: "이름을 입력해 주세요." }, 400);
  if (!phone) return json({ ok: false, message: "연락처를 입력해 주세요." }, 400);
  if (!/^[0-9+\-\s()]{7,30}$/.test(phone)) return json({ ok: false, message: "연락처를 다시 확인해 주세요." }, 400);
  if (!email) return json({ ok: false, message: "이메일을 입력해 주세요." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, message: "이메일 주소를 다시 확인해 주세요." }, 400);

  try {
    const row = await env.DB
      .prepare(
        "INSERT INTO applicants (name, organization, position, phone, email) VALUES (?, ?, ?, ?, ?) " +
          "RETURNING id, name, organization, position, phone, email, created_at"
      )
      .bind(name, organization || null, position || null, phone, email)
      .first();
    return json({ ok: true, applicant: row });
  } catch (e) {
    const msg = String(e && e.message);
    if (msg.includes("UNIQUE")) return json({ ok: false, message: "이미 신청된 이메일입니다." }, 409);
    if (msg.includes("no such table")) return json({ ok: false, message: "신청 표(applicants)가 아직 없습니다. 관리자에게 문의해 주세요." }, 500);
    return json({ ok: false, message: "신청을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." }, 500);
  }
}

// ===== 카카오 관리자 로그인 =====
const SESSION_COOKIE = "admin_session";
const STATE_COOKIE = "kakao_state";
const SESSION_HOURS = 8;

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (txt) => b64url(new TextEncoder().encode(txt));
const fromB64urlText = (s) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

function getCookie(request, name) {
  const all = request.headers.get("Cookie") || "";
  for (const part of all.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

const cookie = (name, value, maxAge) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const adminIds = (env) =>
  String(env.ADMIN_KAKAO_IDS || "").split(",").map((v) => v.trim()).filter(Boolean);

// 로그인 쿠키를 확인해서 관리자면 정보를, 아니면 null 을 돌려줌
async function getAdmin(request, env) {
  if (!env.SESSION_SECRET) return null;
  const raw = getCookie(request, SESSION_COOKIE);
  const [data, sig] = raw.split(".");
  if (!data || !sig) return null;
  if ((await hmac(env.SESSION_SECRET, data)) !== sig) return null;
  let s;
  try { s = JSON.parse(fromB64urlText(data)); } catch (e) { return null; }
  if (!s || !s.id || !s.exp || s.exp < Date.now()) return null;
  if (!adminIds(env).includes(String(s.id))) return null; // 관리자 목록에서 빠지면 바로 막힘
  return s;
}

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 안내 화면 (로그인 실패·권한 없음 등)
function infoPage(title, bodyHtml, status = 200, headers = {}) {
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;font-family:Pretendard,"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;background:#f4f4f1;color:#1a1d1a;line-height:1.6;word-break:keep-all}
.box{max-width:460px;margin:12vh auto;background:#fff;border-radius:24px;padding:30px 24px;box-shadow:0 10px 30px rgba(0,0,0,.08)}
h1{font-size:22px;color:#2f4a37;margin:0 0 14px}p{margin:0 0 12px}.num{font-size:22px;font-weight:800;background:#f4f4f1;border-radius:12px;padding:10px 14px;display:inline-block;margin:4px 0 12px}
.small{color:#5b625c;font-size:14px}a.btn{display:inline-block;margin-top:10px;background:#2f4a37;color:#fff;text-decoration:none;font-weight:700;border-radius:999px;padding:12px 24px}</style></head>
<body><div class="box"><h1>${esc(title)}</h1>${bodyHtml}<a class="btn" href="/">처음 화면으로</a></div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}

function kakaoLogin(request, env) {
  if (!env.KAKAO_REST_API_KEY || !env.SESSION_SECRET) {
    return infoPage("로그인 준비가 아직 안 됐습니다", "<p>Cloudflare에 카카오 값(KAKAO_REST_API_KEY)과 SESSION_SECRET이 들어 있지 않습니다.</p>", 500);
  }
  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const auth = new URL("https://kauth.kakao.com/oauth/authorize");
  auth.searchParams.set("client_id", env.KAKAO_REST_API_KEY);
  auth.searchParams.set("redirect_uri", `${url.origin}/api/kakao/callback`);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { Location: auth.toString(), "Set-Cookie": cookie(STATE_COOKIE, state, 600) } });
}

async function kakaoCallback(request, env) {
  const url = new URL(request.url);
  const clearState = { "Set-Cookie": cookie(STATE_COOKIE, "", 0) };
  if (url.searchParams.get("error")) {
    return infoPage("로그인이 취소되었습니다", "<p>카카오 로그인을 마치지 않았습니다.</p>", 400, clearState);
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== getCookie(request, STATE_COOKIE)) {
    return infoPage("로그인을 다시 해 주세요", "<p>로그인 확인 값이 맞지 않습니다. 처음부터 다시 로그인해 주세요.</p>", 400, clearState);
  }

  // 1) 카카오에서 받은 코드로 토큰 받기
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
    return infoPage("카카오 로그인에 실패했습니다", `<p>카카오에서 거절했습니다. (사유 코드: ${esc(why)})</p><p class="small">REST API 키, Client Secret, 카카오 디벨로퍼에 등록한 Redirect URI가 맞는지 확인해 주세요.</p>`, 400, clearState);
  }

  // 2) 토큰으로 내 카카오 회원번호 확인
  const meRes = await fetch("https://kapi.kakao.com/v2/user/me", { headers: { Authorization: `Bearer ${token.access_token}` } });
  const me = await meRes.json().catch(() => ({}));
  if (!meRes.ok || !me.id) {
    return infoPage("카카오 로그인에 실패했습니다", "<p>카카오 회원 정보를 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p>", 400, clearState);
  }
  const id = String(me.id);
  const nick = (me.properties && me.properties.nickname) || (me.kakao_account && me.kakao_account.profile && me.kakao_account.profile.nickname) || "";

  // 3) 관리자가 아니면 회원번호만 알려 주고 끝
  if (!adminIds(env).includes(id)) {
    return infoPage(
      "관리자 권한이 없습니다",
      `<p>이 카카오 계정은 관리자로 등록되어 있지 않습니다.</p><p>내 카카오 회원번호</p><div class="num">${esc(id)}</div>
<p class="small">관리자라면 이 번호를 Cloudflare &gt; Settings &gt; Variables and Secrets 의 <b>ADMIN_KAKAO_IDS</b>(Secret)에 넣은 뒤 다시 로그인해 주세요.</p>`,
      403,
      clearState
    );
  }

  // 4) 관리자면 로그인 쿠키를 주고 관리자 페이지로
  const data = b64urlText(JSON.stringify({ id, nick, exp: Date.now() + SESSION_HOURS * 3600 * 1000 }));
  const sig = await hmac(env.SESSION_SECRET, data);
  const headers = new Headers({ Location: "/admin.html" });
  headers.append("Set-Cookie", cookie(STATE_COOKIE, "", 0));
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, `${data}.${sig}`, SESSION_HOURS * 3600));
  return new Response(null, { status: 302, headers });
}

async function adminApplicants(request, env) {
  const admin = await getAdmin(request, env);
  if (!admin) return json({ ok: false, message: "관리자 로그인이 필요합니다." }, 401);
  const { results } = await env.DB
    .prepare("SELECT id, name, organization, position, phone, email, created_at FROM applicants ORDER BY id DESC")
    .all();
  return json({ ok: true, admin: { nick: admin.nick || "" }, applicants: results || [] });
}

function logout() {
  return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": cookie(SESSION_COOKIE, "", 0) } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/apply") return handleApply(request, env);
    if (url.pathname === "/api/kakao/login") return kakaoLogin(request, env);
    if (url.pathname === "/api/kakao/callback") return kakaoCallback(request, env);
    if (url.pathname === "/api/admin/applicants") return adminApplicants(request, env);
    if (url.pathname === "/api/logout") return logout();
    if (url.pathname.startsWith("/api/")) return json({ ok: false, message: "없는 주소입니다." }, 404);
    return env.ASSETS.fetch(request);
  },
};
