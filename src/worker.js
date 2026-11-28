// 2026-11-28 rev.15 — 서버 코드 (Cloudflare Worker) 길잡이 · 카카오 회원가입·로그인 추가
//   (rev.13: 관리자 수정·삭제 / rev.12: 카카오 관리자 로그인)
// 주소별로 어느 파일이 일하는지:
//   src/kakao-login.js     카카오 로그인 시작
//   src/kakao-callback.js  카카오에서 돌아온 손님 받기 (가입·로그인·관리자)
//   src/nickname.js        닉네임 저장
//   src/common.js          같이 쓰는 도구
// 하는 일:
//   POST /api/apply             특강 신청을 D1(DB)의 applicants 표에 저장
//   GET  /api/kakao/login?mode=signup|login   카카오 본인 확인으로 보냄 (mode 없으면 관리자)
//   GET  /api/kakao/callback    카카오에서 돌아오면 가입·로그인·관리자 처리
//   POST /api/nickname          처음 가입한 회원의 닉네임 저장
//   GET  /api/admin/applicants  관리자만 신청자 목록을 받음
//   PUT  /api/admin/applicants/번호  관리자만 신청자 정보 수정
//   DELETE /api/admin/applicants/번호  관리자만 신청자 삭제
//   GET  /api/logout            로그아웃
// 그 밖의 주소는 public 폴더의 화면 파일을 보여 줌
//
// 비밀값은 코드에 넣지 않음. Cloudflare > Settings > Variables and Secrets 에 Type "Secret"으로:
//   KAKAO_REST_API_KEY   카카오 REST API 키
//   KAKAO_CLIENT_SECRET  카카오 Client Secret
//   SESSION_SECRET       로그인 상태를 지키는 비밀 열쇠 (직접 지은 30자 이상)
//   ADMIN_KAKAO_IDS      관리자 카카오 회원번호 (여러 명이면 쉼표로: 123,456)

import { json, getAdmin, cookie, SESSION_COOKIE } from "./common.js";
import { kakaoLogin } from "./kakao-login.js";
import { kakaoCallback } from "./kakao-callback.js";
import { saveNickname } from "./nickname.js";

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

// ===== 관리자 목록·수정·삭제 =====
async function adminApplicants(request, env) {
  const admin = await getAdmin(request, env);
  if (!admin) return json({ ok: false, message: "관리자 로그인이 필요합니다." }, 401);
  const { results } = await env.DB
    .prepare("SELECT id, name, organization, position, phone, email, created_at FROM applicants ORDER BY id DESC")
    .all();
  return json({ ok: true, admin: { nick: admin.nick || "" }, applicants: results || [] });
}

// 신청 내용 검사 (신청·수정에서 같이 씀)
function readApplicant(body) {
  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const a = {
    name: clean(body.name, 50),
    phone: clean(body.phone, 30),
    email: clean(body.email, 254),
    organization: clean(body.organization, 100),
    position: clean(body.position, 50),
  };
  if (!a.name) return { error: "이름을 입력해 주세요." };
  if (!a.phone) return { error: "연락처를 입력해 주세요." };
  if (!/^[0-9+\-\s()]{7,30}$/.test(a.phone)) return { error: "연락처를 다시 확인해 주세요." };
  if (!a.email) return { error: "이메일을 입력해 주세요." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) return { error: "이메일 주소를 다시 확인해 주세요." };
  return { a };
}

// 관리자: 한 명 수정·삭제
async function adminApplicantOne(request, env, id) {
  const admin = await getAdmin(request, env);
  if (!admin) return json({ ok: false, message: "관리자 로그인이 필요합니다." }, 401);

  if (request.method === "DELETE") {
    const r = await env.DB.prepare("DELETE FROM applicants WHERE id = ?").bind(id).run();
    if (!r.meta || !r.meta.changes) return json({ ok: false, message: "이미 삭제되었거나 없는 신청자입니다." }, 404);
    return json({ ok: true });
  }

  if (request.method === "PUT") {
    let body;
    try { body = await request.json(); } catch (e) { return json({ ok: false, message: "수정 내용을 읽지 못했습니다." }, 400); }
    const { a, error } = readApplicant(body);
    if (error) return json({ ok: false, message: error }, 400);
    try {
      const row = await env.DB
        .prepare(
          "UPDATE applicants SET name = ?, organization = ?, position = ?, phone = ?, email = ? WHERE id = ? " +
            "RETURNING id, name, organization, position, phone, email, created_at"
        )
        .bind(a.name, a.organization || null, a.position || null, a.phone, a.email, id)
        .first();
      if (!row) return json({ ok: false, message: "이미 삭제되었거나 없는 신청자입니다." }, 404);
      return json({ ok: true, applicant: row });
    } catch (e) {
      if (String(e && e.message).includes("UNIQUE")) return json({ ok: false, message: "이미 다른 신청자가 사용 중인 이메일입니다." }, 409);
      return json({ ok: false, message: "수정하지 못했습니다. 잠시 뒤 다시 시도해 주세요." }, 500);
    }
  }

  return json({ ok: false, message: "허용되지 않는 요청입니다." }, 405);
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
    const one = url.pathname.match(/^\/api\/admin\/applicants\/(\d+)$/);
    if (one) return adminApplicantOne(request, env, Number(one[1]));
    if (url.pathname === "/api/nickname") return saveNickname(request, env);
    if (url.pathname === "/api/logout") return logout();
    if (url.pathname.startsWith("/api/")) return json({ ok: false, message: "없는 주소입니다." }, 404);
    return env.ASSETS.fetch(request);
  },
};
