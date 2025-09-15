// /public/js/auth-boot.js — hardened navigation + selective logout (2025-09-03)
(() => {
  "use strict";

  /* =========================
   * Constants & small utils
   * ========================= */
  const AUTH_FLAG_KEY = "auth:flag";
  const NAV_KEY = "auth:navigate";
  const NAV_TTL_MS = 60000;           // 내부 이동으로 인정할 유효시간
  const USERNS_KEY = "auth:userns";

  const TAB_ID_KEY   = "auth:tab-id";
  const TAB_REG_KEY  = "auth:open-tabs";         // 모든 탭 레지스트리
  const TAB_AUThed_KEY = "auth:open-tabs:authed"; // 인증된 탭 레지스트리
  const TAB_HB_MS    = 15_000;
  const TAB_STALE_MS = 5 * 60_000;

  const TAB_CLOSE_GRACE_MS = 0;
  const LOGOUT_ON_TAB_CLOSE = "always";

  // ★ 추가: 툴바 새로고침/내비 보호용 짧은 유예
  const GRACE_NAV_BOOT_MS = 200;

  const setAuthedFlag = () => sessionStorage.setItem(AUTH_FLAG_KEY, "1");
  const clearAuthedFlag = () => sessionStorage.removeItem(AUTH_FLAG_KEY);

  const now = () => Date.now();

  // GH Pages(정적 호스트)에서 /auth, /api 요청을 실제 백엔드로 보냄
  const API_ORIGIN = window.PROD_BACKEND || window.API_BASE || null;
  function toAPI(p) {
    try {
      const u = new URL(p, location.href);
      if (API_ORIGIN && /^\/(?:auth|api)\//.test(u.pathname)) {
        return new URL(u.pathname + u.search + u.hash, API_ORIGIN).toString();
      }
      return u.toString();
    } catch { return p; }
  }

  try {
    window.COLLECTED_EVT     = "collectedLabels:changed";
    window.JIB_COLLECTED_EVT = "jib:collection-changed";
  } catch {}

  let __lastNavPing = 0;
  function markNavigate() {
    try { sessionStorage.setItem(NAV_KEY, String(now())); } catch {}
    try {
      const t = now();
      if (t - __lastNavPing > 2000) {            // 2s throttle
        __lastNavPing = t;
        const blob = new Blob([JSON.stringify({ t })], { type: "application/json" });
        const navURL = toAPI("/auth/nav");
        navigator.sendBeacon?.(navURL, blob) ||
          fetch(navURL, {
            method: "POST", credentials: "include", keepalive: true,
            headers: { "content-type": "application/json" }, body: "{}"
          }).catch(()=>{});
      }
    } catch {}
  }

  function isAppNavigation() {
    try {
      const ts = +(sessionStorage.getItem(NAV_KEY) || 0);
      return ts && (now() - ts < NAV_TTL_MS);
    } catch { return false; }
  }

  function getTabId() {
    try {
      let id = sessionStorage.getItem(TAB_ID_KEY);
      if (!id) {
        id = `t_${now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
        sessionStorage.setItem(TAB_ID_KEY, id);
      }
      return id;
    } catch { return "t_fallback"; }
  }
  const readKV = (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch { return {}; } };
  const writeKV = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const prune = (obj) => {
    const out = {}; const t = now();
    for (const [k, ts] of Object.entries(obj || {})) if (t - (ts||0) < TAB_STALE_MS) out[k] = ts;
    return out;
  };
  function regUpdate(key, modFn) { const next = modFn(prune(readKV(key))); writeKV(key, next); return next; }

  function registerTab() {
    const id = getTabId();
    regUpdate(TAB_REG_KEY, reg => (reg[id] = now(), reg));
  }
  function unregisterTab() {
    const id = getTabId();
    regUpdate(TAB_REG_KEY, reg => (delete reg[id], reg));
    regUpdate(TAB_AUThed_KEY, reg => (delete reg[id], reg));
  }
  function registerAuthedTab() {
    const id = getTabId();
    regUpdate(TAB_AUThed_KEY, reg => (reg[id] = now(), reg));
  }
  let hbTimer = null;
  function startHeartbeat() {
    if (hbTimer) return;
    const beat = () => {
      const id = getTabId();
      regUpdate(TAB_REG_KEY, reg => (reg[id] = now(), reg));
      if (state.authed) regUpdate(TAB_AUThed_KEY, reg => (reg[id] = now(), reg));
    };
    beat();
    hbTimer = setInterval(beat, TAB_HB_MS);
  }
  function stopHeartbeat() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }

  /* =========================
   * Navigation marking (broad)
   * ========================= */
  document.addEventListener("click", (e) => {
    try {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target?.closest?.('a[href]');
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (!href || href.startsWith("#")) return; // 해시 이동 제외
      const u = new URL(href, location.href);
      if (u.origin === location.origin) markNavigate();
      } catch {}
  }, { capture: true, passive: true });

  document.addEventListener("submit", (e) => {
    try {
      const f = e.target;
      if (!f || e.defaultPrevented) return;
      const u = new URL(f.action || location.href, location.href);
      if (u.origin === location.origin) markNavigate();
    } catch {}
  }, { capture: true });

  document.addEventListener("keydown", (e) => {
    const k = e.key;
    const mod = e.metaKey || e.ctrlKey;
    const isNavKey =
      k === "F5" ||
      (mod && (k === "r" || k === "R")) ||
      (e.altKey && (k === "ArrowLeft" || k === "ArrowRight")) ||
      (mod && (k === "[" || k === "]"));
    if (isNavKey) {
      try {
        window.auth?.markNavigate?.();
        sessionStorage.setItem("auth:navigate", String(Date.now()));
      } catch {}
    }
  }, { capture: true });

  (function patchLocationAssignReplace(){
    try {
      if (Location.prototype.__audPatchedNav) return;
      const A = Location.prototype.assign;
      const R = Location.prototype.replace;
      Location.prototype.assign  = function(u){ try{ markNavigate(); }catch{} return A.call(this, u); };
      Location.prototype.replace = function(u){ try{ markNavigate(); }catch{} return R.call(this, u); };
      Object.defineProperty(Location.prototype, "__audPatchedNav", { value:true });
    } catch {}
  })();

  (function patchLocationHrefSetter(){
    try {
      const d = Object.getOwnPropertyDescriptor(Location.prototype, "href");
      if (d && d.set && d.configurable) {
        const origSet = d.set, getter = d.get;
        Object.defineProperty(Location.prototype, "href", {
          configurable: true,
          get: getter,
          set(v){ try{ markNavigate(); }catch{} return origSet.call(this, v); }
        });
      }
    } catch {}
  })();

  (function patchLocationReload(){
    try {
      if (Location.prototype.__audPatchedReload) return;
      const RELOAD = Location.prototype.reload;
      Location.prototype.reload = function(...args){
        try { markNavigate(); } catch {}
        return RELOAD.apply(this, args);
      };
      Object.defineProperty(Location.prototype, "__audPatchedReload", { value:true });
    } catch {}
  })();

  /* =========================
   * Last-tab logout on real exit
   * ========================= */
  let unregistered = false;
  function beaconLogout(){
    try {
      const blob = new Blob([JSON.stringify({ reason:"tab-close", t: Date.now() })],
                            { type: "application/json" });
      const url = toAPI("/auth/logout-beacon");
      const ok = navigator.sendBeacon?.(url, blob);
      if (!ok) {
        fetch(url, {
          method: "POST",
          credentials: "include",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body: "{}"
        }).catch(()=>{});
      }
    } catch {}
  }

  // 기존 함수 유지 (다른 경로에서 참조 가능). always 모드에선 사실상 미사용.
  function unregisterTabAndMaybeLogout(e) {
    if (unregistered) return;
    if (closeTimer) return; // hidden 경로에서 이미 처리 예정
    unregistered = true;
    try {
      stopHeartbeat();
      unregisterTab(); // 레지스트리에서 현재 탭 제거
      const realExitCandidate = !isAppNavigation();
      if (LOGOUT_ON_TAB_CLOSE === "always" && realExitCandidate) {
        const hideAt = Date.now();
        setTimeout(() => {
          let bootTs = 0;
          try { bootTs = +(localStorage.getItem("auth:nav:boot-ts") || 0); } catch {}
          const bootedSoonAfter = bootTs && (bootTs >= hideAt);
          if (bootedSoonAfter) return;
          try { sessionStorage.removeItem("auth:flag"); } catch {}
          try { window.dispatchEvent(new Event("auth:logout")); } catch {}
          try {
            const blob = new Blob(
              [JSON.stringify({ reason: "tab-close", t: Date.now() })],
              { type: "application/json" }
            );
            const ok = navigator.sendBeacon?.(toAPI("/auth/logout-beacon"), blob);
            if (!ok) throw new Error("beacon-failed");
          } catch {
            try {
              fetch(toAPI("/auth/logout-beacon"), {
                method: "POST",
                keepalive: true,
                credentials: "include",
                headers: { "content-type": "application/json" },
                body: "{}"
              }).catch(() => {});
            } catch {}
          }
          try {
            localStorage.setItem("auth:logout-intent",
              JSON.stringify({ t: Date.now(), ttl: 120000 })
            );
          } catch {}
        }, TAB_CLOSE_GRACE_MS);
      }
    } catch {}
  }

  // ★ 교체: 즉시 로그아웃 → 새 문서 부팅 판별 후 로그아웃
  function scheduleCloseLogout(trigger) {
    const hideAt = Date.now();
    const timer = (cb) =>
      (typeof requestIdleCallback === "function")
        ? requestIdleCallback(() => setTimeout(cb, 0), { timeout: GRACE_NAV_BOOT_MS })
        : setTimeout(cb, GRACE_NAV_BOOT_MS);

    timer(() => {
      let bootTs = 0;
      try { bootTs = +(localStorage.getItem("auth:nav:boot-ts") || 0); } catch {}
      const newDocBooted = bootTs && (bootTs >= hideAt);
      if (newDocBooted) return;          // 리로드/내비 → 억제
      if (isAppNavigation()) return;     // 내부 마킹 → 억제

      // 여기까지 왔으면 진짜 탭 종료
      try { stopHeartbeat(); } catch {}
      try { unregisterTab(); } catch {}

      if (LOGOUT_ON_TAB_CLOSE === "always") {
        try { sessionStorage.removeItem(AUTH_FLAG_KEY); } catch {}
        try { window.dispatchEvent(new Event("auth:logout")); } catch {}
        try {
          const blob = new Blob(
            [JSON.stringify({ reason: "tab-close", t: Date.now(), via: trigger || "scheduled" })],
            { type: "application/json" }
          );
          const ok = navigator.sendBeacon?.("/auth/logout-beacon", blob);
          if (!ok) throw new Error("beacon-failed");
        } catch {
          try {
            fetch("/auth/logout-beacon", {
              method: "POST",
              keepalive: true,
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: "{}"
            }).catch(()=>{});
          } catch {}
        }
        try {
          localStorage.setItem("auth:logout-intent",
            JSON.stringify({ t: Date.now(), ttl: 120000 })
          );
        } catch {}
      }
    });
  }

  // ★ 교체: pagehide에서 바로 로그아웃하지 않고 판별 스케줄
  window.addEventListener("pagehide", (e) => {
    scheduleCloseLogout("pagehide");
  }, { capture: true });

  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      unregistered = false;
      registerTab(); startHeartbeat();
      if (state.authed) registerAuthedTab();
    }
  });

  // ───────────────────────────────────────────────
  // visibilitychange(hidden)에서 종료 후보를 먼저 처리
  // ───────────────────────────────────────────────
  let closeTimer = null; // (기존 경로 호환용, 현재는 사용 안 함)

  // ★ 교체: hidden 시에도 판별 스케줄
  document.addEventListener("visibilitychange", () => {
    /* intentionally no-op: only pagehide triggers close-logout */
  }, { capture: true });

  /* =========================
   * State & subscribers
   * ========================= */
  let state = { ready:false, authed:false, csrf:null, user:null, bootId:null };
  const subs = new Set();
  function notify(){ subs.forEach(fn => { try { fn(state); } catch {} }); }
  function onChange(fn){ subs.add(fn); return () => subs.delete(fn); }
  function isAuthed(){ return !!state.authed; }
  async function getUser(){           // 구문 오류 수정 + null 세이프티
    if (!state.ready) await refreshMe();
    return state.user || null;
  }

  /* =========================
   * CSRF helpers
   * ========================= */
  let csrfInFlight = null;
  async function getCSRF(force=false){
    if (state.csrf && !force) return state.csrf;
    if (csrfInFlight && !force) return csrfInFlight;
    csrfInFlight = fetch(toAPI("/auth/csrf"), { credentials:"include", headers: { "Accept":"application/json" } })
      .then(r => { if(!r.ok) throw new Error("csrf-fetch-failed"); return r.json(); })
      .then(j => (state.csrf = j?.csrfToken || null))
      .finally(() => { csrfInFlight = null; });
    return csrfInFlight;
  }
  function getCSRFTokenSync(){ return state.csrf || null; }

  // === Same-origin coercion for dev (localhost <-> 127.0.0.1) ===
  function coerceToSameOrigin(input) {
    try {
      const u = new URL(input, location.href);
      const devPair = (a,b) => (a==="localhost"&&b==="127.0.0.1")||(a==="127.0.0.1"&&b==="localhost");
      if (u.origin !== location.origin && devPair(u.hostname, location.hostname)) {
        return location.origin + u.pathname + u.search + u.hash;
      }
      return u.toString();
    } catch { return input; }
  }


  /* =========================
   * fetch wrapper (CSRF + retry)
   * ========================= */
  async function apiFetch(path, opt = {}) {
    const method = (opt.method || "GET").toUpperCase();
    const needsCSRF = !["GET","HEAD","OPTIONS"].includes(method);

    const headers = new Headers(opt.headers || {});
    if (!headers.has("Accept")) headers.set("Accept", "application/json");

    const isFD = (typeof FormData !== "undefined") && (opt.body instanceof FormData);
    if (isFD) {
      headers.delete("Content-Type");
      headers.delete("content-type");
    }
    // 객체 바디 자동 JSON 처리 (Blob/URLSearchParams 제외)
    const isPlainObjBody =
      !isFD &&
      opt.body &&
      typeof opt.body === "object" &&
      !(opt.body instanceof Blob) &&
      !(opt.body instanceof URLSearchParams);

    if (isPlainObjBody) {
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      opt.body = JSON.stringify(opt.body);
    }

    // 최종 바디가 JSON 문자열인지 판별
    const isJSONStr = !isFD && typeof opt.body === "string" && /^\s*\{/.test(opt.body);

    let token = null;
    if (needsCSRF) {
      token = await getCSRF().catch(() => null);
      if (token) {
        headers.set("CSRF-Token",   token);
        headers.set("X-CSRF-Token", token);
        headers.set("X-XSRF-Token", token);
      }
      if (!isFD && !headers.has("Content-Type")) headers.set("Content-Type","application/json");
      if (token) {
        if (isFD) { try { if (!opt.body.has("_csrf")) opt.body.append("_csrf", token); } catch {} }
        else if (isJSONStr) {
          try {
            const obj = JSON.parse(opt.body || "{}");
            if (!obj._csrf) obj._csrf = token;
            opt.body = JSON.stringify(obj);
          } catch {}
        }
        try {
          const u = new URL(path, location.href);
          if (u.searchParams.has("csrf") && !u.searchParams.has("_csrf")) {
            u.searchParams.set("_csrf", u.searchParams.get("csrf"));
            u.searchParams.delete("csrf");
          }
          if (token && !u.searchParams.has("_csrf")) {
            u.searchParams.set("_csrf", token);
          }
          path = u.toString();
        } catch {}
      }
    }

    const req = { ...opt, method, credentials: "include", headers };
    path = toAPI(path);
    path = coerceToSameOrigin(path);
    let res = await fetch(path, req);

    // CSRF 재시도
    if (needsCSRF && res.status === 403) {
      state.csrf = null;
      try {
        token = await getCSRF(true);
        headers.set("CSRF-Token",   token);
        headers.set("X-CSRF-Token", token);
        headers.set("X-XSRF-Token", token);
        if (isFD) { try { if (!opt.body.has("_csrf")) opt.body.append("_csrf", token); } catch {} }
        else if (isJSONStr) {
          try {
            const obj = JSON.parse(opt.body || "{}");
            obj._csrf = token;
            opt.body = JSON.stringify(obj);
          } catch {}
        }
        try {
          const u = new URL(path, location.href);
          u.searchParams.set("_csrf", token);
          path = u.toString();
        } catch {}
        res = await fetch(path, { ...req, headers });
      } catch {}
    }

    if (res.status === 401) {
      try {
        const u   = new URL(path, location.href);
        const pth = u.pathname || "";
        const isAuthRoute = /^\/auth\//i.test(pth);
        if (isAuthRoute) {
          clearAuthedFlag();
          state.authed = false; state.user = null;
          notify(); try { window.dispatchEvent(new Event("auth:logout")); } catch {}
        } else {
          let trulyExpired = false;
          try {
            const chk = await fetch(toAPI("/auth/me"), { credentials:"include", cache:"no-store", headers: { "Accept":"application/json" }});
            if (!chk || chk.status !== 200) trulyExpired = true;
            else {
              const jj = await chk.clone().json().catch(()=>null);
              trulyExpired = !jj?.authenticated;
            }
          } catch { trulyExpired = false; }
          if (trulyExpired) {
            clearAuthedFlag();
            state.authed = false; state.user = null;
            notify(); try { window.dispatchEvent(new Event("auth:logout")); } catch {}
          }
        }
      } catch {}
    } else if (res.status === 403) {
      state.csrf = null; // 다음 요청에서 재발급
    }
    return res;
  }

  /* =========================
   * Me(refresh) + boot handling
   * ========================= */
  async function refreshMe(){
    try {
      const r = await fetch(toAPI("/auth/me"), { credentials:"include", headers:{ "Accept":"application/json" }});
      const j = await r.json().catch(()=>null);
      state.authed = !!j?.authenticated;
      state.user   = state.authed ? (j.user || null) : null;
      state.bootId = j?.bootId || null;

      if (state.authed) {
        setAuthedFlag(); registerAuthedTab();
        try { await getCSRF(); } catch {}
        // === userns 고정 저장 (uid 우선, 없으면 email)
        try {
          const ns = String(j?.ns || j?.user?.id || j?.user?.uid || "").trim().toLowerCase()
                  || String(j?.user?.email || "").trim().toLowerCase();
          if (ns) localStorage.setItem(USERNS_KEY, ns);
        } catch {}
      } else {
        clearAuthedFlag();
        regUpdate(TAB_AUThed_KEY, reg => (delete reg[getTabId()], reg));
      }
    } finally {
      state.ready = true;
      let nsDetail = null; try { nsDetail = localStorage.getItem(USERNS_KEY) || null; } catch {}
      try { window.dispatchEvent(new CustomEvent("auth:state", { detail: { authed: state.authed, user: state.user, bootId: state.bootId, ns: nsDetail }})); } catch {}
      notify();
    }
  }

  (function setupCloseWatcher(){
    if (LOGOUT_ON_TAB_CLOSE === "always") return; // always 모드에선 storage 감시 비활성화
    function parseMap(v){ try { return (JSON.parse(v||"{}")||{}); } catch { return {}; } }

    window.addEventListener("storage", (ev) => {
      if (ev.key !== TAB_AUThed_KEY) return;

      const oldMap = parseMap(ev.oldValue);
      const newMap = parseMap(ev.newValue);

      const removed = Object.keys(oldMap).filter(id => !(id in newMap));
      if (!removed.length) return;

      setTimeout(() => {
        const nowMap = prune(readKV(TAB_AUThed_KEY));
        const stillMissing = removed.filter(id => !(id in nowMap));
        if (!stillMissing.length) return;

        if (LOGOUT_ON_TAB_CLOSE === "always") {
          try { window.__flushStoreSnapshot?.({ server: true }); } catch {}
          try {
            const blob = new Blob([JSON.stringify({})], { type: "application/json" });
            navigator.sendBeacon?.("/auth/logout-beacon", blob) ||
              fetch("/auth/logout-beacon", { method: "POST", keepalive: true, credentials: "include" });
          } catch {}
          try { window.dispatchEvent(new Event("auth:logout")); } catch {}
          return;
        }

        const leftAuthed = Object.keys(nowMap).length;
        const shouldLogout =
          LOGOUT_ON_TAB_CLOSE === "any"  ? true :
          LOGOUT_ON_TAB_CLOSE === "last" ? (leftAuthed === 0) :
          false;
        if (!shouldLogout) return;

        try { window.__flushStoreSnapshot?.({ server: true }); } catch {}
        try {
          const blob = new Blob([JSON.stringify({})], { type: "application/json" });
          navigator.sendBeacon?.("/auth/logout-beacon", blob) ||
            fetch("/auth/logout-beacon", { method: "POST", keepalive: true, credentials: "include" });
        } catch {}
        try { window.dispatchEvent(new Event("auth:logout")); } catch {}
      }, TAB_CLOSE_GRACE_MS);
    });
  })();

  /* =========================
   * Public actions
   * ========================= */
  async function login(email, password) {
    const r = await apiFetch("/auth/login", {
      method:"POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ email: String(email||"").trim(), password: String(password||"") })
    });
    const j = await r.json().catch(()=> ({}));
    if (j && j.ok) {
      state.csrf = null; await refreshMe(); setAuthedFlag(); registerAuthedTab();
      try { if (j.id) localStorage.setItem(USERNS_KEY, String(j.id).toLowerCase()); } catch {}
    }
    return j;
  }

  async function signup(email, password) {
    const r = await apiFetch("/auth/signup", {
      method:"POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ email: String(email||"").trim(), password: String(password||"") })
    });
    return r.json().catch(()=> ({}));
  }

  async function onLogoutClick(e){
    e?.preventDefault?.();
    try { await apiFetch("/auth/logout", { method:"POST" }); } catch {}
    try {
      const rm = [];
      for (let i=0; i<sessionStorage.length; i++){
        const k = sessionStorage.key(i); if (!k) continue;
        if (/^(auth:|__boot\.id|auth:open-tabs)/.test(k)) rm.push(k);
      }
      rm.forEach(k => sessionStorage.removeItem(k));
    } catch {}
    clearAuthedFlag();
    try { localStorage.removeItem(USERNS_KEY); } catch {}
    try { window.dispatchEvent(new CustomEvent("auth:state", { detail: { authed:false, user:null, ns:"default" } })); } catch {}
    regUpdate(TAB_AUThed_KEY, reg => (delete reg[getTabId()], reg));
    state.csrf=null; state.authed=false; state.user=null;
    notify(); try { window.dispatchEvent(new Event("auth:logout")); } catch {}
    markNavigate();
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `./login.html?reset=1&next=${next}`;
  }
  async function logout(){ return onLogoutClick(); }

  /* =========================
   * Optional tiny state API
   * ========================= */
  async function loadState(ns="default"){
    const u = toAPI(`/api/state?ns=${encodeURIComponent(ns)}`);
    const j = await fetch(u, { credentials:"include", headers:{ "Accept":"application/json" }}).then(r=>r.json()).catch(()=> ({}));
    return j?.state || {};
  }
  async function saveState(ns="default", stateObj={}){
    const body = JSON.stringify({ ns, state: stateObj });
    let r = await apiFetch("/api/state", { method:"PUT", headers:{ "Content-Type":"application/json" }, body });
    if (!r.ok) r = await apiFetch("/api/state", { method:"POST", headers:{ "Content-Type":"application/json" }, body });
    return r.ok;
  }

  /* =========================
   * Expose & boot
   * ========================= */
  window.auth = {
    apiFetch, onChange, isAuthed, getUser, require: async () => {
      if (state.ready && state.authed) { await getCSRF().catch(()=>null); return true; }
      if (!state.ready) await refreshMe();
      if (state.authed) { await getCSRF().catch(()=>null); return true; }
      const next = encodeURIComponent(location.pathname + location.search);
      markNavigate();
      location.href = "./login.html?next=" + next;
      return false;
    },
    getUser, login, signup, logout,
    getCSRF, getCSRFTokenSync,
    ping: async () => { try { await fetch(toAPI("/auth/ping"), { credentials:"include" }); } catch {} },
    loadState, saveState,
    markNavigate,
  };

  // 외부 스크립트에서 안전 호출
  window.auth = window.auth || {};
  window.auth.markNavigate = markNavigate;

  // ★ 부팅 시작 ‘직후’에 가장 먼저 boot-ts 기록 (리로드/내비 보호의 핵심)
  try { localStorage.setItem("auth:nav:boot-ts", String(Date.now())); } catch {}

  // boot
  try { sessionStorage.removeItem(NAV_KEY); } catch {}
  registerTab(); startHeartbeat();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { refreshMe(); }, { once:true });
  } else {
    refreshMe();
  }

  // 닫힘-로그아웃 intent 보정 루프 (boot 직후 실행)
  (async function finishPendingLogout(){
    let intent = null;
    try { intent = JSON.parse(localStorage.getItem("auth:logout-intent") || "null"); } catch {}
    if (!intent) return;

    const tooOld = (Date.now() - (intent.t || 0)) > (intent.ttl || 120000);
    if (tooOld) { try { localStorage.removeItem("auth:logout-intent"); } catch {} return; }

    let stillAuthed = false;
    try {
      const me = await fetch(toAPI("/auth/me"), {
        credentials: "include", cache: "no-store", headers: { "Accept": "application/json" }
      }).then(r => r.json());
      stillAuthed = !!me?.authenticated;
    } catch {}
    if (!stillAuthed) { try { localStorage.removeItem("auth:logout-intent"); } catch {} return; }

    try {
      await apiFetch("/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
    } catch {}
    try { localStorage.removeItem("auth:logout-intent"); } catch {}
    try { sessionStorage.removeItem("auth:flag"); } catch {}
  })();
})();
