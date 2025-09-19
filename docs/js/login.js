// /public/js/login.js — unified, robust, and CSRF-safe (2025-09-05)
(() => {
  "use strict";

  /* =============================================================
   *  0) CONFIG & LIGHTWEIGHT SHIMS
   * ============================================================= */
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log("[login]", ...a);

  // Ensure a non-breaking auth namespace without overriding a real one
  (function ensureAuthShim(){
    const a = (window.auth = window.auth || {});
    a.isAuthed      = a.isAuthed      || (() => false);
    a.login         = a.login         || null;           // if provided, preferred
    a.getCSRF       = a.getCSRF       || (async () => null);
    a.markNavigate  = a.markNavigate  || (() => {});
    a.logout        = a.logout        || (() => {});
  })();

  // --- Backend router (GH Pages-safe) ---
  const API_ORIGIN = window.PROD_BACKEND || window.API_BASE || null;
  function toAPI(p) {
    try {
      const u = new URL(p, location.href);
      return (API_ORIGIN && /^\/(?:auth|api)\//.test(u.pathname))
        ? new URL(u.pathname + u.search + u.hash, API_ORIGIN).toString()
        : u.toString();
    } catch { return p; }
  }

  const $  = (s, r=document) => r.querySelector(s);
  const on = (el, ev, fn, opt) => el && el.addEventListener(ev, fn, opt);

  const EMAIL_RX       = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const AUTH_FLAG_KEY  = "auth:flag";     // tab-scoped auth flag
  const NAV_MARK_KEY   = "auth:navigate"; // internal navigation mark
  const MINE_PATH = (window.pageHref ? pageHref("mine.html") : "./mine.html");    // default landing

  const FORCE_LOGIN =
    new URL(location.href).searchParams.get("force") === "1" ||
    location.hash === "#force";

  // DOM cache (ids are optional; delegation handles the rest)
  const els = {
    tabLogin:    $("#tab-login") || $('[data-tab="login"]'),
    tabSignup:   $("#tab-signup")|| $('[data-tab="signup"]'),
    panelLogin:  $("#login")     || $("#panel-login")  || $('[data-panel="login"]'),
    panelSignup: $("#signup")    || $("#panel-signup") || $('[data-panel="signup"]'),

    loginEmail:  $("#email"),
    loginPw:     $("#pw"),
    loginErr:    $("#login-error"),

    signupEmail: $("#su-email"),
    signupPw:    $("#su-pw"),
    signupPw2:   $("#su-pw2"),
    signupErr:   $("#signup-error"),

    loginBtn:    $("#login button[type='submit']"),
    signupBtn:   $("#signup button[type='submit']"),
  };

  /* =============================================================
   *  1) TAB-SCOPED AUTH FLAG & NAV MARKING
   * ============================================================= */
  const setAuthedFlag = () => {
    try { sessionStorage.setItem(AUTH_FLAG_KEY, "1"); } catch {}
    try { localStorage.setItem(AUTH_FLAG_KEY,  "1"); }  catch {}
    // 탭 동기화 즉시 반영
    try {
      localStorage.setItem("auth:ping", String(Date.now()));
      localStorage.removeItem("auth:ping");
    } catch {}
  };
  const hasAuthedFlag = () =>
    (sessionStorage.getItem(AUTH_FLAG_KEY) === "1") ||
    (localStorage.getItem(AUTH_FLAG_KEY)  === "1");

  const clearAuthedFlag = () => {
    try { sessionStorage.removeItem(AUTH_FLAG_KEY); } catch {}
    try { localStorage.removeItem(AUTH_FLAG_KEY);  } catch {}
  };

  function markNavigate(){
    try { window.auth.markNavigate(); } catch {}
    try { sessionStorage.setItem(NAV_MARK_KEY, String(Date.now())); } catch {}
  }

  // Keep the auth flag even when reloading with ?reset=1
  (function preserveAuthFlagOnReset(){
    try {
      const u = new URL(location.href);
      if (u.searchParams.get("reset") === "1" && hasAuthedFlag()) setAuthedFlag();
    } catch {}
  })();

  /* =============================================================
   *  2) CSRF TOKEN HELPER (with cache + resilient fallback)
   * ============================================================= */
  const csrf = {
    _cache: null,
    async ensure(force=false){
      if (!force && this._cache) return this._cache;
      try { const t = await window.auth.getCSRF(true); if (t) return (this._cache = t); } catch {}
      try {
        const j = await fetch(toAPI("/auth/csrf"), { credentials: "include" }).then(r => r.json());
        return (this._cache = j?.csrfToken || null);
      } catch { return null; }
    },
    clear(){ this._cache = null; }
  };

  async function postJSON(url, body = {}, retrying = false){
    const t = await csrf.ensure(true);
    const headers = new Headers({ "Content-Type": "application/json", "Accept": "application/json" });
    if (t) {
      headers.set("x-csrf-token", t); 
      headers.set("X-XSRF-Token", t);  
    }
    const u = new URL(url, location.href);
    if (t && !u.searchParams.has("_csrf")) u.searchParams.set("_csrf", t);

    const payload = { ...(body||{}) };
    if (t && payload._csrf == null) payload._csrf = t;

    const res = await fetch(toAPI(u.toString()), {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(payload)
    });

    if (res.status === 403 && !retrying) {
      csrf.clear();
      try { await window.auth.getCSRF(true); } catch {}
      return postJSON(url, body, true);
    }
    return res;
  }

  /* =============================================================
   *  3) SAFE NEXT URL RESOLUTION
   * ============================================================= */
  function resolveNextUrl(){
    const u = new URL(location.href);
    const n = u.searchParams.get("next") || "";
    // allow: same-origin & /.../(mine|home|collect|gallery|labelmine).html
    try {
      const t = new URL(n, location.href);       // relative or absolute both OK
      if (t.origin === location.origin) {
        const p = t.pathname;
        if (/\/(mine|home|collect|gallery|labelmine)\.html$/i.test(p)) {
          return p + t.search + t.hash;          // keep subpath (/aud-web/...)
        }
      }
    } catch {}
    return MINE_PATH;                             // fallback: ./mine.html
  }
  function gotoNext(){ markNavigate(); location.assign(resolveNextUrl()); }

  /* =============================================================
   *  4) UI HELPERS (busy states, field errors)
   * ============================================================= */
  function setBusy(btn, on, txtBusy = "Signing in…"){
    if (!btn) return;
    btn.disabled = !!on;
    btn.setAttribute("aria-busy", on ? "true" : "false");
    if (on) {
      btn.dataset.prev = btn.textContent || "";
      btn.textContent = txtBusy;
    } else {
      const p = btn.dataset.prev;
      if (p != null) btn.textContent = p;
      delete btn.dataset.prev;
    }
  }
  function showError(el, msg){ if (!el) return; el.textContent = msg || ""; el.style.display = msg ? "block" : "none"; }

  function setFieldError(inputEl, errEl, msg){
    if (!inputEl || !errEl) return;
    const has = !!msg;
    inputEl.classList.toggle("is-invalid", has);
    inputEl.setAttribute("aria-invalid", has ? "true" : "false");
    errEl.textContent = has ? String(msg) : "";
    errEl.style.display = has ? "block" : "none";
  }
  function clearFieldErrors(){
    setFieldError(els.loginEmail, $("#err-email"), "");
    setFieldError(els.loginPw,    $("#err-pw"),    "");
    showError(els.loginErr, "");
  }

  /* =============================================================
   *  5) ERROR TRANSLATION (server codes → user text)
   * ============================================================= */
  function translateError(codeLike){
    const code = String(codeLike || "").toUpperCase();
    const M = {
      "NO_USER":         { msg: "No account found for this email.",                       field: "email" },
      "BAD_CREDENTIALS": { msg: "Incorrect email or password.",                           field: "pw"    },
      "INVALID":         { msg: "Please check your inputs and try again.",                field: "pw"    },
      "LOCKED":          { msg: "This account is locked. Please try again later.",        field: "pw"    },
      "RATE_LIMIT":      { msg: "Too many attempts. Please wait a moment and try again.", field: "pw"    },
      "CSRF":            { msg: "Security token expired. Please refresh and try again.",  field: "pw"    },
      "EXPIRED_SESSION": { msg: "Session expired. Please sign in again.",                 field: "pw"    },
      "DUPLICATE_EMAIL": { msg: "This email is already registered." },
    };
    return M[code] || { msg: "Login failed. Please check your email and password.", field: "pw" };
  }

  /* =============================================================
   *  6) VALIDATORS
   * ============================================================= */
  function assertLoginInputs(){
    const email = (els.loginEmail?.value || "").trim();
    const pw    = (els.loginPw?.value   || "").trim();
    if (!EMAIL_RX.test(email)) return { ok:false, field:"email", msg:"Please enter a valid email address." };
    if (pw.length < 4)         return { ok:false, field:"pw",    msg:"Password must be at least 4 characters." };
    return { ok:true, email, pw };
  }
  function assertSignupInputs(){
    const email = (els.signupEmail?.value || "").trim();
    const pw1   = (els.signupPw?.value    || "").trim();
    const pw2   = (els.signupPw2?.value   || "").trim();
    if (!EMAIL_RX.test(email)) return { ok:false, msg:"Please enter a valid email address." };
    if (pw1.length < 8)        return { ok:false, msg:"Password must be at least 8 characters." };
    if (pw1 !== pw2)           return { ok:false, msg:"Passwords do not match." };
    return { ok:true, email, pw1, pw2 };
  }

  /* =============================================================
   *  7) SUCCESS HOOK
   * ============================================================= */
  function onLoginSuccess(user){
    const ns = (user?.id != null)
      ? `user:${String(user.id)}`
      : `email:${String(user?.email || "").toLowerCase()}`;

    try { localStorage.setItem("auth:userns", ns); } catch {}
    setAuthedFlag();

    // 탭 동기화 신호 (선택이지만 권장)
    try {
      localStorage.setItem("auth:ping", String(Date.now()));
      localStorage.removeItem("auth:ping");
    } catch {}

    try {
      window.dispatchEvent(new CustomEvent("auth:state", { detail: { ready:true, authed:true, ns, user } }));
    } catch {}

    // [ADD] 로그인 직후 이메일에서 이름 자동 생성 + 캐시 + 브로드캐스트
    try {
      const eml = String(user?.email || "").trim().toLowerCase();
      // '+' 태그 제거 후 @ 앞부분만 추출 (e.g., 'john.doe+test@x.com' -> 'john.doe')
      const localPart = eml ? eml.split("@")[0].split("+")[0] : "member";
      const detail = {
        id: (user?.id ?? null),
        displayName: localPart || "member",
        avatarUrl: "",
        rev: Date.now()
      };
      // mine.js는 legacy 키('me:profile') 스토리지 이벤트를 이미 구독함
      localStorage.setItem("me:profile", JSON.stringify(detail));
      // 즉시 반영을 원하는 현재 탭에도 이벤트 발행
      window.dispatchEvent(new CustomEvent("user:updated", { detail }));
    } catch {}

    gotoNext();
  }

  /* =============================================================
   *  8) ACTIONS: LOGIN / SIGNUP
   * ============================================================= */
  async function doLogin(email, password){
    log("doLogin via", window.auth?.login ? "window.auth" : "fallback");
    try {
      if (window.auth?.login) {
        const r = await window.auth.login(email, password); // { ok, error|code? }
        if (!r || r.ok !== true) {
          const t = translateError(r?.error || r?.code || r?.message);
          return { ok:false, msg:t.msg, field:t.field, code:r?.error || r?.code };
        }

        // Sync /auth/me (best-effort) and flush store snapshot if provided
        let uid = null, eml = email;
        try {
          const me = await (window.auth?.apiFetch
            ? window.auth.apiFetch("/auth/me", { credentials:"include", cache:"no-store" })
            : fetch(toAPI("/auth/me"), { credentials:"include", cache:"no-store" })
          ).then(r => (r.json ? r.json() : r));
          if (me?.authenticated && me?.user?.id != null) uid = me.user.id;
          if (me?.user?.email) eml = me.user.email;
          try { await window.__flushStoreSnapshot?.({ server:true }); } catch {}
          try {
            const ns = uid != null ? `user:${uid}` : `email:${String(eml).toLowerCase()}`;
            localStorage.setItem("auth:userns", ns);
            window.dispatchEvent(new CustomEvent("auth:state", { detail: { authed:true, ready:true, ns } }));
          } catch {}
        } catch {}

        onLoginSuccess({ id: uid, email: eml });
        return { ok:true };
      }

      // Fallback: POST /auth/login
      const r = await postJSON("/auth/login", { email, password });
      const out = await r.json().catch(() => ({}));
      if (!r.ok || out?.ok === false) {
        const t = translateError(out?.error || out?.code);
        return { ok:false, msg:t.msg, field:t.field, code:out?.error || out?.code };
      }
      onLoginSuccess({ id: out.id, email });
      return { ok:true };
    } catch (e) {
      const t = translateError(e?.code || e?.message);
      return { ok:false, msg:t.msg, field:t.field };
    }
  }

  async function doSignup(email, pw1){
    try {
      const r = await postJSON("/auth/signup", { email, password: pw1 });
      const out = await r.json().catch(() => ({}));
      if (!r.ok || out?.ok === false) {
        const t = translateError(out?.error || out?.code);
        return { ok:false, msg:t.msg };
      }
      return { ok:true };
    } catch { return { ok:false, msg:"Sign-up failed. Please try again." }; }
  }

  /* =============================================================
   *  9) TAB UI (Unified: buttons + panels + URL control)
   * ============================================================= */
  function activateTab(which = "login"){
    const isLogin = which === "login";

    // Buttons (if present)
    const tabLogin  = $("#tab-login")  || $('[data-tab="login"]');
    const tabSignup = $("#tab-signup") || $('[data-tab="signup"]');
    [tabLogin, tabSignup].forEach((el, i) => {
      if (!el) return;
      const on = isLogin ? i === 0 : i === 1;
      el.classList.toggle("active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
      el.setAttribute("tabindex", on ? "0" : "-1");
    });

    // Panels (id or data-panel)
    const panLogin  = $("#login")  || $("#panel-login")  || $('[data-panel="login"]');
    const panSignup = $("#signup") || $("#panel-signup") || $('[data-panel="signup"]');
    if (panLogin)  { panLogin.classList.toggle("active", isLogin);  panLogin.hidden  = !isLogin; }
    if (panSignup) { panSignup.classList.toggle("active", !isLogin); panSignup.hidden = isLogin; }
  }

  function bindTabDelegation(){
    // Single delegated handler supports id or data-tab on <a>/<button>
    document.addEventListener("click", (e) => {
      const t = e.target?.closest?.('#tab-login,[data-tab="login"],#tab-signup,[data-tab="signup"]');
      if (!t) return;
      e.preventDefault();
      activateTab(t.matches('#tab-signup,[data-tab="signup"]') ? "signup" : "login");
    }, { capture:true });

    // URL-driven default: ?tab=signup or #signup
    try {
      const u = new URL(location.href);
      const q = (u.searchParams.get("tab") || "").toLowerCase();
      if (q === "signup" || location.hash.toLowerCase() === "#signup") activateTab("signup");
      else activateTab("login");
    } catch { activateTab("login"); }

    // Expose for manual switching
    try { window.__loginForceTab = activateTab; } catch {}
  }

  /* =============================================================
   *  10) EVENT HANDLERS
   * ============================================================= */
  async function onSubmitLogin(e){
    e.preventDefault();
    clearFieldErrors();

    const v = assertLoginInputs();
    if (!v.ok){
      if (v.field === "email") setFieldError(els.loginEmail, $("#err-email"), v.msg);
      if (v.field === "pw")    setFieldError(els.loginPw,    $("#err-pw"),    v.msg);
      return;
    }

    setBusy(els.loginBtn, true, "Signing in…");
    const res = await doLogin(v.email, v.pw);
    setBusy(els.loginBtn, false);

    if (!res.ok){
      const target = res.field === "email" ? "email" : "pw";
      if (target === "email") setFieldError(els.loginEmail, $("#err-email"), res.msg);
      else                     setFieldError(els.loginPw,    $("#err-pw"),    res.msg);
      return;
    }
  }

  async function onSubmitSignup(e){
    e.preventDefault();
    showError(els.signupErr, "");

    const v = assertSignupInputs();
    if (!v.ok){ showError(els.signupErr, v.msg); return; }

    setBusy(els.signupBtn, true, "Creating account…");
    const out = await doSignup(v.email, v.pw1);
    setBusy(els.signupBtn, false);

    if (!out.ok){ showError(els.signupErr, out.msg); return; }

    // Auto-login right after sign-up
    if (els.loginEmail) els.loginEmail.value = v.email;
    if (els.loginPw)    els.loginPw.value    = v.pw1;
    const r2 = await doLogin(v.email, v.pw1);
    if (!r2.ok){
      const target = r2.field === "email" ? "email" : "pw";
      if (target === "email") setFieldError(els.loginEmail, $("#err-email"), r2.msg || "Automatic sign-in failed.");
      else                     setFieldError(els.loginPw,    $("#err-pw"),    r2.msg || "Automatic sign-in failed.");
      return;
    }
  }

  /* =============================================================
   *  11) INIT
   * ============================================================= */
  async function init(){
    try {
      if (!FORCE_LOGIN && window.auth.isAuthed()) { log("already authed → gotoNext()"); gotoNext(); return; }
    } catch {}

    // Form submits (if panels are forms)
    on(els.panelLogin,  "submit", onSubmitLogin);
    on(els.panelSignup, "submit", onSubmitSignup);

    // Clear field-level errors while typing
    on(els.loginEmail, "input", () => setFieldError(els.loginEmail, $("#err-email"), ""));
    on(els.loginPw,    "input", () => setFieldError(els.loginPw,    $("#err-pw"),    ""));

    bindTabDelegation();

    // Debug helpers for console
    window.__loginDbg = {
      async ping(){ return (window.auth?.apiFetch
        ? window.auth.apiFetch("/auth/me", { credentials:"include" })
        : fetch(toAPI("/auth/me"), { credentials:"include" })
      ).then(r => (r.json ? r.json() : r)); },
      async csrf(){ return csrf.ensure(true); },
      gotoNext, activateTab
    };

    log("init done");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once:true });
  else init();
})();
