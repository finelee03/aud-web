// /public/js/auth-keepalive.js  — drop-in 교체본
(() => {
  "use strict";

  // 중복 로드 방지
  if (window.__authKeepaliveLoaded) return;
  window.__authKeepaliveLoaded = true;

  // ===== 설정 =====
  const AUTH_FLAG_KEY = "auth:flag";          // 로그인 성공 시 login.js가 "1"로 셋
  const BASE_MS       = 5 * 60 * 1000;        // 기본 주기: 5분 (rolling cookie면 충분)
  const MAX_BACKOFF   = 4;                    // 최대 2^4 = 16배
  const USER_EVENTS   = ["visibilitychange", "focus", "online"];

  // 상태
  let timer = null;
  let backoff = 0;        // 오류 누적시 주기 ↑
  let inFlight = false;   // 중복요청 방지(단일 비행)
  let ctrl = null;        // AbortController

  // 헬퍼
  const isAuthedLight = () => {
    try { return sessionStorage.getItem(AUTH_FLAG_KEY) === "1"; }
    catch { return false; }
  };
  const pageActive = () => !document.hidden;

  const makeURL = (trigger) =>
    `/auth/ping?src=${encodeURIComponent(trigger)}&t=${Date.now()}`;

  // pingOnce 교체
  async function pingOnce(trigger = "interval") {
    if (!isAuthedLight() || !pageActive() || inFlight) return;

    inFlight = true;
    ctrl = new AbortController();

    try {
      const req = { method: "GET", credentials: "include", cache: "no-store", signal: ctrl.signal };
      const res = (window.auth?.apiFetch)
        ? await window.auth.apiFetch(makeURL(trigger), req)
        : await fetch(makeURL(trigger), req);

      if (!res) throw new Error("ping:no-response");

      // 401 → 만료
      if (res.status === 401) {
        try { sessionStorage.removeItem(AUTH_FLAG_KEY); } catch {}
        window.dispatchEvent(new CustomEvent("auth:expired"));
        return;
      }

      const ct = res.headers?.get?.("content-type") || "";

      // 204 또는 2xx & 비-JSON → 성공 처리
      if (res.status === 204 || (!ct.includes("application/json") && res.ok)) {
        backoff = 0; reschedule();
        try { sessionStorage.setItem(AUTH_FLAG_KEY, "1"); } catch {}
        window.dispatchEvent(new CustomEvent("auth:keepalive-ok", { detail: { lightweight: true }}));
        return;
      }

      // JSON 응답만 판별
      const data = await res.json().catch(() => null);
      if (data && data.authenticated === true) {
        backoff = 0; reschedule();
        try { sessionStorage.setItem(AUTH_FLAG_KEY, "1"); } catch {}
        window.dispatchEvent(new CustomEvent("auth:keepalive-ok", { detail: data }));
      } else if (data && data.authenticated === false) {
        try { sessionStorage.removeItem(AUTH_FLAG_KEY); } catch {}
        window.dispatchEvent(new CustomEvent("auth:expired", { detail: data }));
      } else {
        // 애매하면 성공 취급 (네트워크 OK)
        backoff = 0; reschedule();
        window.dispatchEvent(new CustomEvent("auth:keepalive-ok", { detail: { ambiguous: true }}));
      }
    } catch {
      backoff = Math.min(backoff + 1, MAX_BACKOFF);
      reschedule();
    } finally {
      try { ctrl?.abort(); } catch {}
      ctrl = null;
      inFlight = false;
    }
  }

  function schedule() {
    clearInterval(timer);
    const interval = BASE_MS * Math.max(1, 2 ** backoff);
    timer = setInterval(() => pingOnce("interval"), interval);
  }
  function reschedule() {
    // 백오프 변화 반영
    if (timer) clearInterval(timer);
    schedule();
  }

  function onUserActivity() {
    // 탭 복귀/포커스 시 즉시 갱신
    if (isAuthedLight()) pingOnce("activity");
  }

  // storage 이벤트로 다른 탭의 로그인/로그아웃을 감지
  window.addEventListener("storage", (e) => {
    if (e.key !== AUTH_FLAG_KEY) return;
    if (isAuthedLight()) {
      if (!timer) schedule();
      pingOnce("storage");
    } else {
      clearInterval(timer);
      timer = null;
    }
  });

  // 앱 레벨 로그아웃 신호가 있으면 즉시 중단
  window.addEventListener("auth:logout", () => {
    try { ctrl?.abort(); } catch {}
    if (timer) clearInterval(timer);
    timer = null;
  });

  // 페이지 전환/숨김시 진행 중 요청 정리
  window.addEventListener("pagehide", () => { try { ctrl?.abort(); } catch {} });

 // 초기 구동: 플래그 유무와 관계없이 1회 서버 세션을 탐지해 플래그 복구
  schedule(); // 타이머는 항상
  (async function bootProbe(){
    try {
      const res = await fetch("/auth/me", { method:"GET", credentials:"include", cache:"no-store" });
      if (res && res.ok) {
        const j = await res.json().catch(()=>null);
        if (j && j.authenticated === true) {
          sessionStorage.setItem("auth:flag","1");   // 플래그 재보증
          backoff = 0; reschedule();
          window.dispatchEvent(new CustomEvent("auth:state", { detail:{ ready:true, authed:true, user:j.user||null } }));
        }
      }
    } catch {}
  })();

  // 사용자 복귀/상태 변화 시 즉시 ping
  USER_EVENTS.forEach((evt) => {
    window.addEventListener(evt, onUserActivity, { passive: true });
  });
})();
