// 2026-11-28 rev.15 — 여러 파일이 같이 쓰는 도구 모음 (rev.14까지 worker.js 안에 있던 것을 옮김)

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

// ===== 쿠키·서명 도구 =====
export const SESSION_COOKIE = "admin_session";
export const STATE_COOKIE = "kakao_state";
export const SESSION_HOURS = 8;

export const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const b64urlText = (txt) => b64url(new TextEncoder().encode(txt));
export const fromB64urlText = (s) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

export function getCookie(request, name) {
  const all = request.headers.get("Cookie") || "";
  for (const part of all.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

export const cookie = (name, value, maxAge) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export const adminIds = (env) =>
  String(env.ADMIN_KAKAO_IDS || "").split(",").map((v) => v.trim()).filter(Boolean);

// 로그인 쿠키를 확인해서 관리자면 정보를, 아니면 null 을 돌려줌
export async function getAdmin(request, env) {
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

export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 안내 화면 (로그인 실패·권한 없음 등)
export function infoPage(title, bodyHtml, status = 200, headers = {}) {
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;font-family:Pretendard,"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;background:#f4f4f1;color:#1a1d1a;line-height:1.6;word-break:keep-all}
.box{max-width:460px;margin:12vh auto;background:#fff;border-radius:24px;padding:30px 24px;box-shadow:0 10px 30px rgba(0,0,0,.08)}
h1{font-size:22px;color:#2f4a37;margin:0 0 14px}p{margin:0 0 12px}.num{font-size:22px;font-weight:800;background:#f4f4f1;border-radius:12px;padding:10px 14px;display:inline-block;margin:4px 0 12px}
.small{color:#5b625c;font-size:14px}a.btn{display:inline-block;margin-top:10px;background:#2f4a37;color:#fff;text-decoration:none;font-weight:700;border-radius:999px;padding:12px 24px}</style></head>
<body><div class="box"><h1>${esc(title)}</h1>${bodyHtml}<a class="btn" href="/">처음 화면으로</a></div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}

