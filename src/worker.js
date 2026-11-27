// 2026-11-27 rev.11 — 서버 코드 (Cloudflare Worker)
// 하는 일: POST /api/apply → 특강 신청을 D1(DB)의 applicants 표에 저장
// 그 밖의 주소는 public 폴더의 화면 파일을 보여 줌

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/apply") return handleApply(request, env);
    if (url.pathname.startsWith("/api/")) return json({ ok: false, message: "없는 주소입니다." }, 404);
    return env.ASSETS.fetch(request);
  },
};
