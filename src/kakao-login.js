// 2026-11-28 rev.15 — 카카오 로그인 시작 (GET /api/kakao/login?mode=...)
// mode: signup(회원가입) / login(회원 로그인) / admin(관리자, 주소에 mode가 없으면 관리자)
// 어떤 목적으로 왔는지 쿠키에 적어 두고 카카오 본인 확인 화면으로 보냄

import { STATE_COOKIE, cookie, infoPage } from "./common.js";

export const MODE_COOKIE = "kakao_mode";
export const MODES = ["signup", "login", "admin"];

export function kakaoLogin(request, env) {
  if (!env.KAKAO_REST_API_KEY) {
    return infoPage("로그인 준비가 아직 안 됐습니다", "<p>Cloudflare에 카카오 값(KAKAO_REST_API_KEY)이 들어 있지 않습니다.</p>", 500);
  }
  const url = new URL(request.url);
  const mode = MODES.includes(url.searchParams.get("mode")) ? url.searchParams.get("mode") : "admin";
  if (mode === "admin" && !env.SESSION_SECRET) {
    return infoPage("로그인 준비가 아직 안 됐습니다", "<p>Cloudflare에 SESSION_SECRET이 들어 있지 않습니다.</p>", 500);
  }
  const state = crypto.randomUUID();
  const auth = new URL("https://kauth.kakao.com/oauth/authorize");
  auth.searchParams.set("client_id", env.KAKAO_REST_API_KEY);
  auth.searchParams.set("redirect_uri", `${url.origin}/api/kakao/callback`);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("state", state);
  const headers = new Headers({ Location: auth.toString() });
  headers.append("Set-Cookie", cookie(STATE_COOKIE, state, 600));
  headers.append("Set-Cookie", cookie(MODE_COOKIE, mode, 600));
  return new Response(null, { status: 302, headers });
}
