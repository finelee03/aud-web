// /public/js/mine.js — FEED + LIKE/VOTE + POST MODAL + INFINITE SCROLL (refactored 2025-09-10)
(() => {
  "use strict";

  /* =========================================================
   * 0) KEYS / EVENTS / SHORTCUTS
   * ========================================================= */

  // --- CSS.escape shim (older WebViews/Safari) ---
  try {
    window.CSS = window.CSS || {};
    if (typeof window.CSS.escape !== "function") {
      window.CSS.escape = (v) =>
        String(v).replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, ch => {
          const cp = ch.codePointAt(0).toString(16).toUpperCase();
          return "\\" + cp + " ";
        });
    }
  } catch {}

  const AUTH_FLAG_KEY = "auth:flag";
  const SELECTED_KEY  = "aud:selectedLabel";

  // sessionStorage keys (page-local state)
  const REG_KEY = "collectedLabels";
  const JIB_KEY = "jib:collected";

  // legacy logical events (allow override via window.*)
  const COLLECTED_EVT     = "collectedLabels:changed";
  const JIB_COLLECTED_EVT = "jib:collection-changed";
  const EVT_LABEL = (window.LABEL_COLLECTED_EVT || COLLECTED_EVT);
  const EVT_JIB   = (window.JIB_COLLECTED_EVT   || JIB_COLLECTED_EVT);

  // cross-tab sync keys (allow override via window.*)
  const LABEL_SYNC_KEY = (window.LABEL_SYNC_KEY || "label:sync");
  const JIB_SYNC_KEY   = (window.JIB_SYNC_KEY   || "jib:sync");

  // quick DOM helpers
  const $     = (sel, root=document) => root.querySelector(sel);

  const $feedRoot   = () => $("#feed-root");
  const $feedGrid   = () => document.querySelector("[data-feed-grid]");
  const $feedBottom = () => $(".feed-bottom");
  const $btnMore    = () => $("#feed-more");
  const $sentinel   = () => $("#feed-sentinel");
  const $feedScroll = () => document.querySelector("[data-feed-scroll]"); // optional container


  // ── NS helper (계정별 namespace)
  const getNS = () => {
    const uid = (typeof window.getMeId === "function" && window.getMeId()) || (window.__ME_ID || "");
    try { return (localStorage.getItem("auth:userns") || String(uid) || "default").trim().toLowerCase(); }
    catch { return String(uid || "default"); }
  };
  try { window.getNS = getNS; } catch {}
  // === Realtime keys
  const FEED_EVENT_KIND = "feed:event"; // BroadcastChannel에서 사용
  let __ME_ID = null;                   // 로그인한 내 user id 캐시
  let __ME_EMAIL = null;

  const getMeId = () => __ME_ID;
  const getMeEmail = () => __ME_EMAIL;

  // Socket.IO 핸들러에서 BC로 중계할 때 접근할 수 있도록 참조 저장
  let __bcFeed = null;

  /* =========================================================
   * 1) ICONS / JIBS (탭 타일 렌더 데이터)
   * ========================================================= */
  const ICONS = {
    thump:  { orange: "./asset/thumpvideo.mp4",  black: "./asset/blackthump.png" },
    miro:   { orange: "./asset/mirovideo.mp4",   black: "./asset/blackmiro.png" },
    whee:   { orange: "./asset/wheevideo.mp4",   black: "./asset/blackwhee.png" },
    track:  { orange: "./asset/trackvideo.mp4",  black: "./asset/blacktrack.png" },
    echo:   { orange: "./asset/echovideo.mp4",   black: "./asset/blackecho.png" },
    portal: { orange: "./asset/portalvideo.mp4", black: "./asset/blackportal.png" }
  };
  const JIBS = {
    bloom:   "./asset/bloomvideo.mp4",
    tail:    "./asset/tailvideo.mp4",
    cap:     "./asset/capvideo.mp4",
    keyring: "./asset/keyringvideo.mp4",
    duck:    "./asset/duckvideo.mp4",
    twinkle: "./asset/twinklevideo.mp4",
    xmas:    "./asset/xmasvideo.mp4",
    bunny:   "./asset/bunnyvideo.mp4"
  };

  /* =========================================================
   * 2) AUTH HELPERS
   * ========================================================= */
  const hasAuthedFlag   = () => sessionStorage.getItem(AUTH_FLAG_KEY) === "1";
  const setAuthedFlag   = () => sessionStorage.setItem(AUTH_FLAG_KEY, "1");
  const clearAuthedFlag = () => sessionStorage.removeItem(AUTH_FLAG_KEY);
  const serverAuthed    = () => !!(window.auth && window.auth.isAuthed && window.auth.isAuthed());
  const sessionAuthed   = () => hasAuthedFlag() || serverAuthed();
  const viewerNS = () => (typeof getNS === 'function' ? getNS() : 'default');

  // preserve auth flag across reset=1
  (function preserveAuthFlagOnReset() {
    try {
      const u = new URL(location.href);
      if (u.searchParams.get("reset") === "1") {
        const keep = hasAuthedFlag();
        sessionStorage.clear();
        if (keep) setAuthedFlag();
      }
    } catch {}
  })();

  // 401 handler → markNavigate() + redirect to login
  (function hookAuth401RedirectOnce() {
    try {
      if (!window.auth || typeof window.auth.apiFetch !== "function" || window.auth.__mine401Hooked) return;
      const orig = window.auth.apiFetch;
      window.auth.apiFetch = async (...args) => {
        const res = await orig(...args);
        if (res && res.status === 401) {
          let expired = false;
          try {
            const check = await fetch("/auth/me", { credentials: "include", cache: "no-store" });
            if (!check || check.status !== 200) expired = true;
          } catch {}
          if (expired) {
            try { sessionStorage.removeItem(AUTH_FLAG_KEY); } catch {}
            try {
              const ret = encodeURIComponent(location.href);
              window.auth?.markNavigate?.();
              location.replace(`${pageHref('login.html')}?next=${ret}`);
            } catch {}
          }
        }
        return res;
      };
      window.auth.__mine401Hooked = true;
    } catch {}
  })();

  // expose markNavigate if not present
  try {
    window.auth = window.auth || {};
    if (!window.auth.markNavigate) {
      window.auth.markNavigate = () => {
        try { sessionStorage.setItem("auth:navigate", String(Date.now())); } catch {}
      };
    }
  } catch {}

  // [ADD] CSRF helpers (window.auth가 없을 때도 동작)
  async function ensureCSRF() {
    try {
      if (window.auth?.getCSRF) return await window.auth.getCSRF();
      const r = await fetch("/auth/csrf", { credentials: "include", cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      return j?.csrfToken || null;
    } catch { return null; }
  }
  // [REPLACE] withCSRF (기존 함수 대체)
  async function withCSRF(opt = {}) {
    const t = await ensureCSRF();
    const headers = new Headers(opt.headers || {});
    if (t) {
      headers.set("X-CSRF-Token", t);      // 일부 프레임워크는 대소문자 다룸
      headers.set("X-XSRF-TOKEN", t);      // Angular 스타일
    }
    return { ...opt, headers };
  }

  const API_ORIGIN = window.PROD_BACKEND || window.API_BASE || window.API_ORIGIN || null;
  const toAPI = (p) => {
    try {
      const u = new URL(p, location.href);
      return (API_ORIGIN && /^\/(api|auth)\//.test(u.pathname))
        ? new URL(u.pathname + u.search + u.hash, API_ORIGIN).toString()
        : u.toString();
    } catch { return p; }
  };


  /* =========================================================
  * AVATAR UTIL (profile-ready; no 404; future-proof)
  * ========================================================= */
  const Avatar = (() => {
    // 이름으로 이니셜 SVG를 만들어 주는 데이터 URI (네트워크 요청 없음)
    function initialsOf(name='') {
      const parts = String(name).trim().split(/\s+/).filter(Boolean);
      const init = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
      return (init || (name[0] || 'U')).toUpperCase().slice(0, 2);
    }
    function hashedHue(s='') { let h=0; for (let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i))|0; return Math.abs(h)%360; }

    function svgPlaceholder(name='member') {
      const hue = hashedHue(name);
      const bg  = `hsl(${hue},75%,85%)`;
      const fg  = `hsl(${hue},60%,28%)`;
      const txt = initialsOf(name);
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
          <rect width="80" height="80" rx="40" fill="${bg}"/>
          <text x="50%" y="54%" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial"
                font-size="32" font-weight="600" fill="${fg}" text-anchor="middle">${txt}</text>
        </svg>`
      );
    }

    // 미래의 프로필 모듈이 있으면 우선 사용
    function fromUserObject(u) {
      const urlFromProfile = typeof window.profile?.getAvatarURL === 'function'
        ? window.profile.getAvatarURL(u)
        : null;
      return (
        urlFromProfile ||
        u?.avatarUrl || u?.avatar || u?.picture || u?.imageUrl || u?.image_url || u?.photo ||
        null
      );
    }

    // “지금” 쓸 해석 규칙: 있으면 절대/상대/데이터URI 모두 허용, 없으면 즉시 SVG
    function resolve(raw, displayName='member') {
      if (raw && typeof raw === 'string') return raw;  // http(s)/data:/상대경로 모두 허용
      return svgPlaceholder(displayName);              // 네트워크 요청 자체가 없음 → 404 없음
    }

    // <img>에 안전하게 연결(+실패 시 즉시 SVG로 대체)
    function wire(img, raw, displayName='member') {
      if (!img || !(img instanceof HTMLImageElement)) return;
      img.decoding = img.decoding || 'async';
      img.loading  = img.loading || 'lazy';
      img.src = resolve(raw, displayName);
      img.addEventListener('error', () => { img.src = svgPlaceholder(displayName); }, { once:true });
    }

    // 컨테이너 내부 모든 아바타 이미지에 폴백 연결
    function install(root=document) {
      const imgs = (root instanceof Document || root instanceof Element)
        ? root.querySelectorAll('img.avatar')
        : [];
      imgs.forEach(img => {
        if (img.__avatarWired) return;
        img.__avatarWired = true;
        const name = img.getAttribute('alt') || img.dataset.name || 'member';
        wire(img, img.getAttribute('src'), name);
      });
    }


    // “프로필 변경됨” 이벤트를 나중에 프로필 페이지가 발생시키면 바로 반영
    window.addEventListener('user:updated', (ev) => {
      const d = ev?.detail || {};
      if (!d.id) return;
      const rev = d.rev ? String(d.rev) : '';
      const u   = d.avatarUrl
        ? d.avatarUrl + (rev ? (d.avatarUrl.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(rev) : '')
        : null;
      const base = `[data-user-id="${CSS.escape(String(d.id))}"]`;
      // 아바타 갱신
      document.querySelectorAll(`${base} .avatar`)
        .forEach(img => wire(img, u, d.displayName || img.alt || 'member'));
      // 이름 갱신
      if (d.displayName) {
        document.querySelectorAll(`${base} .name`)
          .forEach(el => { el.textContent = d.displayName; });
      }
    });

    return { resolve, wire, install, svgPlaceholder, fromUserObject };
  })();

  // -- me.html에서 저장한 프로필 캐시 읽기 (session/local 중 최신 rev)
  function readProfileCache() {
    let a = null, b = null;
    try { a = JSON.parse(sessionStorage.getItem("me:profile") || "null"); } catch {}
    try { b = JSON.parse(localStorage.getItem("me:profile")  || "null"); } catch {}
    if (!a && !b) return null;
    if (a && !b) return a;
    if (!a && b) return b;
    return (Number(a.rev||0) >= Number(b.rev||0)) ? a : b;
  }

  // 전역으로 새로 붙는 .avatar 자동 와이어
  function observeAvatars(){
    if (observeAvatars.__obs) return;
    const obs = new MutationObserver((muts) => {
      for (const m of muts){
        for (const n of m.addedNodes || []){
          if (n instanceof HTMLImageElement && n.classList.contains('avatar')) {
         if (!n.__avatarWired) {
           n.__avatarWired = true;
           const name = n.getAttribute('alt') || n.dataset.name || 'member';
           Avatar.wire(n, n.getAttribute('src'), name);
         }
          } else if (n instanceof Element) {
            n.querySelectorAll?.('img.avatar')?.forEach(img => {
              if (img.__avatarWired) return;
              img.__avatarWired = true;
              const name = img.getAttribute('alt') || img.dataset.name || 'member';
              Avatar.wire(img, img.getAttribute('src'), name);
            });
          }
        }
      }
    });
    obs.observe(document.body || document.documentElement, { childList:true, subtree:true });
    observeAvatars.__obs = obs;
  }

  // 안전하게 좋아요 카운트를 그리드/모달에 반영 (값 있을 때만)
  // === COUNT: store만을 단일 소스로 사용 ===
  function renderCountFromStore(id, root = document) {
    try {
      if (typeof window.readLikesMap !== 'function') return;
      const map = window.readLikesMap() || {};
      const rec = map[String(id)] || {};
      if (typeof rec.c !== 'number') return;

      const n = Math.max(0, rec.c);
      const card = (root instanceof Element) ? root : document;

      // 그리드(hover-ui) 카운트
      const cnt = card.querySelector?.('[data-like-count]');
      if (cnt) {
        cnt.dataset.count = String(n);
        try { cnt.textContent = (typeof fmtCount === 'function' ? fmtCount(n) : String(n)); }
        catch { cnt.textContent = String(n); }
      }

      // 모달 하단 라인
      const line = card.querySelector?.('.likes-line');
      if (line) {
        try {
          line.innerHTML = `<span class="likes-count">${(typeof fmtInt==='function'? fmtInt(n) : String(n))}</span> ${(typeof likeWordOf==='function'? likeWordOf(n) : (n<=1?'like':'likes'))}`;
        } catch {
          line.textContent = `${n} ${n<=1?'like':'likes'}`;
        }
      }
    } catch {}
  }

  // (선택) 다른 스크립트에서도 쓸 수 있게 노출
  try { window.Avatar = Avatar; } catch {}


  /* =========================================================
   * 3) MEDIA FACTORY (img / video lazy mount)
   * ========================================================= */
  function createMedia(src, speed = 1, opts = { lazy: true }) {
    if (!src) return document.createComment("no-media");
    const isVideo = /\.mp4(\?|$)/i.test(src);
    const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!isVideo) {
      const img = document.createElement("img");
      img.src = src;
      img.decoding = "async";
      img.loading = "lazy";
      img.className = "media-fill";
      img.style.pointerEvents = "none";
      return img;
    }

    const mountVideo = () => {
      const v = document.createElement("video");
      v.autoplay   = !reduceMotion;
      v.muted      = true;
      v.loop       = !reduceMotion;
      v.playsInline= true;
      v.preload    = "metadata";
      v.tabIndex   = -1;
      v.className  = "media-fill";
      v.src        = src;
      v.style.pointerEvents = "none";
      v.addEventListener("loadedmetadata", () => { try { v.playbackRate = speed; } catch {} });
      if (!reduceMotion) v.addEventListener("loadeddata", () => v.play().catch(()=>{}), { once: true });

      // 화면 밖으로 나가면 일시정지 / 들어오면 재생
      if ("IntersectionObserver" in window) {
        const io2 = new IntersectionObserver((ents) => {
          const vis = ents.some(e => e.isIntersecting);
          if (reduceMotion) { v.pause(); return; }
          if (!vis) { try { v.pause(); } catch {} }
          else { v.play().catch(()=>{}); }
        }, { rootMargin: "100px", threshold: 0.01 });
        // 비디오가 DOM에 붙은 뒤 관찰
        queueMicrotask(() => io2.observe(v));
      }
      return v;
    };

    if (opts && opts.lazy === false) return mountVideo();

    const shell = document.createElement("div");
    shell.className = "media-fill video-shell";
    shell.style.pointerEvents = "none";
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((ents) => {
        if (ents.some(e => e.isIntersecting)) {
          const v = mountVideo();
          shell.replaceWith(v);
          io.disconnect();
        }
      }, { rootMargin: "200px", threshold: 0.01 });
      io.observe(shell);
    } else {
      requestAnimationFrame(() => {
        const v = mountVideo();
        requestAnimationFrame(() => shell.replaceWith(v));
      });
    }
    return shell;
  }

  /* =========================================================
   * 4) RENDER SCHEDULING
   * ========================================================= */
  let __renderRAF = 0;
  function scheduleRender() {
    if (__renderRAF) return;
    __renderRAF = requestAnimationFrame(() => { __renderRAF = 0; renderAll(); });
  }
  try { window.scheduleRender = scheduleRender; } catch {}

  /* =========================================================
   * 5) TABS (labels/jibs) & TILE FACTORIES
   * ========================================================= */
  function initTabs(){
    const tabLbl   = $("#tab-labels");
    const tabJib   = $("#tab-jibs");
    const panelLbl = $("#panel-labels");
    const panelJib = $("#panel-jibs");
    if (!tabLbl || !tabJib || !panelLbl || !panelJib) return;

    const setActive = (name) => {
      const labels = (name === "labels");
      tabLbl.setAttribute("aria-selected", String(labels));
      tabJib.setAttribute("aria-selected", String(!labels));
      panelLbl.hidden = !labels;
      panelJib.hidden = labels;
    };

    tabLbl.addEventListener("click", () => setActive("labels"));
    tabJib.addEventListener("click", () => setActive("jibs"));
    setActive("labels");

    try { window.setMineTabActive = setActive; } catch {}
  }

  function makeLabelTile(label) {
    const src = ICONS[label]?.orange || ICONS[label]?.black;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile label-tile";
    btn.setAttribute("role", "listitem");
    btn.setAttribute("aria-label", label);

    const inner = document.createElement("div");
    inner.className = "tile__content";
    if (src) inner.appendChild(createMedia(src, 0.6));
    btn.appendChild(inner);

    btn.addEventListener("click", () => {
      window.auth?.markNavigate?.();
      queueMicrotask(() => {
        try {
          if (window.store?.setSelected) window.store.setSelected(label);
          else sessionStorage.setItem(SELECTED_KEY, label);
        } catch { try { sessionStorage.setItem(SELECTED_KEY, label); } catch {} }
      });
      location.assign(`${(window.pageHref? pageHref('labelmine.html') : './labelmine.html')}?label=${encodeURIComponent(label)}`);
    });

    return btn;
  }

  function makeJibTile(kind) {
    const src = JIBS[kind];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile jib-tile";
    btn.setAttribute("role", "listitem");
    btn.setAttribute("aria-label", kind);

    const inner = document.createElement("div");
    inner.className = "tile__content";
    if (src) inner.appendChild(createMedia(src, 1));
    btn.appendChild(inner);

    btn.addEventListener("click", () => {
      if (window.jib?.setSelected) window.jib.setSelected(kind);
      else {
        const ns = (localStorage.getItem("auth:userns")||"").trim().toLowerCase() || "default";
        const key = `jib:selected:${ns}`;
        const plane = (ns === "default") ? sessionStorage : localStorage;
        try { plane.setItem(key, kind); window.dispatchEvent(new Event("jib:selected-changed")); } catch {}
      }
      window.auth?.markNavigate?.();
      location.assign(`./jibbitz.html?jib=${encodeURIComponent(kind)}`);
    });

    return btn;
  }

  /* =========================================================
   * 6) STORAGE REHYDRATE (세션 인증 시에만)
   * ========================================================= */
  function rehydrateFromLocalStorageIfSessionAuthed() {
    if (!sessionAuthed()) return;

    try {
      const lblRaw = localStorage.getItem(LABEL_SYNC_KEY);
      if (lblRaw) {
        const msg = JSON.parse(lblRaw);
        if (msg?.type === "set" && Array.isArray(msg.arr)) {
          sessionStorage.setItem(REG_KEY, JSON.stringify(msg.arr));
          window.dispatchEvent(new Event(EVT_LABEL));
        }
      }
    } catch {}

    try {
      const jibRaw = localStorage.getItem(JIB_SYNC_KEY);
      if (jibRaw) {
        const msg = JSON.parse(jibRaw);
        if (msg?.type === "set" && Array.isArray(msg.arr)) {
          sessionStorage.setItem(JIB_KEY, JSON.stringify(msg.arr));
          window.dispatchEvent(new Event(EVT_JIB));
        }
      }
    } catch {}
  }

  /* =========================================================
   * 7) RENDER (탭 전용 / 전체)
   * ========================================================= */
  function renderTabsOnly() {
    const gridLbl = $("#grid-labels");
    const gridJib = $("#grid-jibs");
    if (!gridLbl || !gridJib) return;

    const regs = window.store?.getCollected?.()
      ? window.store.getCollected()
      : (Array.isArray(window.store?.registered) ? window.store.registered : []);

    gridLbl.innerHTML = "";
    regs.forEach(lb => {
      if (!ICONS[lb]) return;
      gridLbl.appendChild(makeLabelTile(lb));
    });

    const jibs = window.jib?.getCollected?.() || [];
    gridJib.innerHTML = "";
    jibs.forEach(k => {
      if (!JIBS[k]) return;
      gridJib.appendChild(makeJibTile(k));
    });
  }

  function renderAll() {
    const root = $("#all-grid");
    if (!root) { try { renderTabsOnly(); } catch {} return; }

    root.innerHTML = "";

    const regs = window.store?.getCollected?.()
      ? window.store.getCollected()
      : (Array.isArray(window.store?.registered) ? window.store.registered : []);
    const jibs = window.jib?.getCollected?.() || [];

    if ((regs?.length || 0) + (jibs?.length || 0) === 0) {
      const cta = document.createElement("button");
      Object.assign(cta.style, {
        padding: "14px 28px", borderRadius: "9999px", background: "#2A5F5F",
        color: "#fff", fontSize: "16px", fontWeight: 500, border: "none", cursor: "pointer"
      });
      cta.textContent = "Let’s find aud: !";
      cta.onclick = () => { window.auth?.markNavigate?.(); location.assign("./gallery.html"); };

      root.style.display = "flex";
      root.style.justifyContent = "center";
      root.style.alignItems = "center";
      root.appendChild(cta);
      return;
    }

    root.removeAttribute("style");
    regs.forEach(lb => { if (ICONS[lb]) root.appendChild(makeLabelTile(lb)); });
    jibs.forEach(k  => { if (JIBS[k])  root.appendChild(makeJibTile(k));  });
  }
  try { window.mineRenderAll = renderAll; } catch {}

  /* =========================================================
   * 8) FEED CORE (state, fetch, cards, like, vote)
   * ========================================================= */
/* === HEART UI (single source of truth) =====================================
 * - 모든 하트는 동일 path(HEART_D) 사용
 * - 그리드(읽기전용)는 항상 외곽선(white via currentColor)
 * - 모달(토글)은 눌림=빨강 채움, 해제=회색 외곽선
 * - 기존 .ico-heart 마스크 아이콘은 자동 교체
 * ==========================================================================*/
(() => {
  const HEART_RED = "#E53935";
  // 하트 path 상수만 교체
  const HEART_D =
    "M12.01 6.001C6.5 1 1 8 5.782 13.001L12.011 20l6.23-7C23 8 17.5 1 12.01 6.002Z"; // ← 끝 대문자 Z(닫힘)!

  function makeSVG() {
    const svg  = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("d", HEART_D);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#777");
    path.setAttribute("stroke-width", "1.3");
    svg.appendChild(path);
    return svg;
  }

  // 읽기 전용(그리드) 하트: 항상 외곽선(hover-ui가 color: #fff → stroke=currentColor)
  function paintReadOnly(svgOrBtn){
    const svg  = (svgOrBtn instanceof SVGSVGElement) ? svgOrBtn
               : svgOrBtn?.querySelector?.("svg") || svgOrBtn;
    const path = svg?.querySelector?.("path"); if (!path) return;
    path.setAttribute("d", HEART_D);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.style.setProperty("fill","none","important");
    path.style.setProperty("stroke","currentColor","important");
    path.style.setProperty("stroke-width","1.5","important");
  }

  // 토글(모달) 하트: pressed=true → 빨강 채움 / false → 회색 외곽선
  function setHeartVisual(target, pressed){
    const svg  = (target instanceof SVGSVGElement) ? target
               : target?.querySelector?.("svg") || target;
    const path = svg?.querySelector?.("path");
    const btn  = (target instanceof SVGSVGElement) ? target.closest?.(".btn-like") : target;
    if (btn) {
      btn.classList.toggle("is-liked", !!pressed);
      btn.setAttribute("aria-pressed", String(!!pressed));
    }
    if (!path) return;

    // 그리드의 읽기전용 하트는 언제나 외곽선 고정
    if (svg.closest?.('.stat[data-like-readonly]')) {
      paintReadOnly(svg);
      return;
    }

    path.setAttribute("d", HEART_D);
    if (pressed) {
      path.style.setProperty("fill", HEART_RED, "important");
      path.style.setProperty("stroke", HEART_RED, "important");
      path.style.setProperty("stroke-width", "0", "important");
      path.setAttribute("fill", HEART_RED);
      path.setAttribute("stroke", HEART_RED);
      path.setAttribute("stroke-width", "0");
    } else {
      path.style.setProperty("fill", "none", "important");
      path.style.setProperty("stroke", "#777", "important");
      path.style.setProperty("stroke-width", "1.5", "important");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#777");
      path.setAttribute("stroke-width", "1.5");
    }

  try {
    if (!pressed && path && path.isConnected) {
      const p2 = path.cloneNode(true);
      path.replaceWith(p2);
    }
  } catch {}
  }

  // 문서(또는 컨테이너) 내 아이콘 업그레이드: .ico-heart → SVG 교체
  function upgradeHeartIconIn(root = document) {
    const rootNode = root || document;

    // 모달(토글) 버튼
    rootNode.querySelectorAll(".btn-like").forEach((btn) => {
      let svg = btn.querySelector("svg");
      if (!svg) {
        const repl = btn.querySelector(".ico-heart");
        svg = makeSVG();
        if (repl) repl.replaceWith(svg); else btn.prepend(svg);
      }
      const pressed =
        btn.getAttribute("aria-pressed") === "true" ||
        btn.classList.contains("is-liked");
      setHeartVisual(btn, pressed);
    });

    // 그리드(읽기전용) 카운터
    rootNode.querySelectorAll(".stat[data-like-readonly]").forEach((stat) => {
      let svg = stat.querySelector("svg");
      if (!svg) {
        const repl = stat.querySelector(".ico-heart");
        svg = makeSVG();
        if (repl) repl.replaceWith(svg); else stat.prepend(svg);
      }
      paintReadOnly(svg);
    });
  }

  // 충돌 방지용 최소 CSS 주입(동일 출처 시트 있으면 거기에, 없으면 <style>)
  function ensureHeartCSS(){
    if (ensureHeartCSS.__done) return; ensureHeartCSS.__done = true;
    function writable(s){ try{ if (s.href) { const u = new URL(s.href, location.href); if (u.origin !== location.origin) return false; } void s.cssRules; return true; } catch { return false; } }
    let sheet = null;
    try {
      const list = Array.from(document.styleSheets || []);
      sheet = list.find(s => writable(s) && /\/mine\.css(\?|$)/.test(s.href || "")) ||
              list.find(s => writable(s)) || null;
    } catch {}
    if (!sheet) {
      const tag = document.createElement("style");
      tag.id = "mine-heart-rules";
      document.head.appendChild(tag);
      sheet = tag.sheet;
    }
    const add = (r) => { try { sheet.insertRule(r, sheet.cssRules.length); } catch {} };

    add(`.btn-like .ico-heart{ display:none !important; }`);
    add(`.sticky-foot .btn-like{ min-width:max(44px,28px); min-height:max(44px,28px); padding:6px; line-height:0; -webkit-tap-highlight-color:transparent; }`);
    add(`.sticky-foot .btn-like svg{ width:28px !important; height:28px !important; display:block; }`);
    add(`.sticky-foot .btn-like svg path, .feed-card .hover-ui .stat svg path{
      transition: fill .15s, stroke .15s;
      stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke;
    }`);
    add(`.post-modal .sticky-foot, .post-modal .sticky-foot *, .sticky-foot .btn-like, .sticky-foot .btn-like svg, .sticky-foot .btn-like svg path{
      filter:none !important; mix-blend-mode:normal !important; opacity:1 !important;
    }`);
  }

  // 전역 노출(다른 코드에서 호출)
  window.setHeartVisual = setHeartVisual;
  window.upgradeHeartIconIn = upgradeHeartIconIn;
  window.ensureHeartCSS = ensureHeartCSS;
})();

  // 숫자 압축 표기 (15K, 2.1M 등). 미지원 환경이면 원본 출력
  const fmtCount = (n) => {
    try {
      return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n||0));
    } catch { return String(n||0); }
  };
  // === BG 규칙 주입기 (CSP-safe) ===========================================
  const BG = (() => {
    const inserted = new Set();
    let sheet = null;

    const sameOriginWritable = (s) => {
      try {
        if (s.href) {
          const u = new URL(s.href, location.href);
          if (u.origin !== location.origin) return false;
        }
        // cssRules 접근 가능해야 삽입 가능
        void s.cssRules;
        return true;
      } catch { return false; }
    };

    function pickSheet(){
      if (sheet) return sheet;
      const list = Array.from(document.styleSheets);

      // 1순위: mine.css
      sheet = list.find(s => sameOriginWritable(s) && /\/mine\.css(\?|$)/.test(s.href||"")) || null;
      // 2순위: 동일 출처의 어떤 스타일시트
      if (!sheet) sheet = list.find(s => sameOriginWritable(s)) || null;

      return sheet;
    }

    const normHex = (s) => {
      s = String(s || '').trim();
      if (/^#([0-9a-f]{3})$/i.test(s)) {
        s = s.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, (_,a,b,c)=>`#${a}${a}${b}${b}${c}${c}`);
      }
      return /^#([0-9a-f]{6})$/i.test(s) ? s.toLowerCase() : null;
    };
    const escAttr = (v) => String(v).replace(/["\\]/g, '\\$&');

    function apply(items = []){
      const sh = pickSheet();
      if (!sh) { console.warn('[BG] writable stylesheet not found'); return; }

      for (const it of items) {
        const id = String(it.id || ''); if (!id) continue;
        const hex = normHex(it.bg || it.bg_color || it.bgHex); if (!hex) continue;
        if (inserted.has(id)) continue;

        const idq  = escAttr(id);
        const rule = `.feed-card[data-id="${idq}"]{--bg:${hex}}`;
        try {
          sh.insertRule(rule, sh.cssRules.length);
          inserted.add(id);
        } catch (e) {
          console.warn('[BG] insertRule failed', e, rule);
        }
      }
    }

    return { apply };
  })();

  const FEED = {
    PAGE_SIZE: 12,
    cursor: null,
    busy: false,
    end: false,
    items: [],
    idxById: new Map()
  };


  // --- RANDOMIZE util (Fisher–Yates) ---
  function shuffleInPlace(arr){
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  async function api(path, opt = {}) {
    const fn = window.auth?.apiFetch || fetch;
    return fn(toAPI(path), opt);
  }

  // === Like endpoint resolver (gallery 우선, 실패 시 items로 1회 폴백; 메서드 폴백은 POST {like}) ===


  const nsOf = (item) => String(item?.ns ?? "default").trim().toLowerCase();
  const blobURL = (item) => toAPI(`/api/gallery/${encodeURIComponent(item.id)}/blob`);
  const fmtDate = (ts) => {
    try {
      const d = new Date(Number(ts) || Date.now());
      const loc = (navigator && navigator.language) ? navigator.language : 'en-US';
      return d.toLocaleDateString(loc, { year:"numeric", month:"short", day:"2-digit" });
    } catch { return ""; }
  };

  // 정수 표기(6,253)
  const fmtInt = (n) => {
    try { return new Intl.NumberFormat('en-US').format(Number(n||0)); }
    catch { return String(n||0); }
  };

  const likeWordOf = (n) => (Number(n) <= 1 ? 'like' : 'likes');

  const voteWordOf = (n) => (Number(n) <= 1 ? 'vote' : 'votes');

  // === UI sync helpers (ALL INSTANCES) ==================================
  // 같은 id의 카드를 문서 내 전체에서 일괄 갱신 (모달/그리드 동시 반영)
  function updateLikeUIEverywhere(id, liked, likes){
    const sel = `.feed-card[data-id="${CSS.escape(String(id))}"]`;
    const cards = document.querySelectorAll(sel);
    if (!cards.length) return;
    // 한 프레임에 모아 쓰기
    (window.requestAnimationFrame || setTimeout)(() => {
      cards.forEach((card) => {
        // 카운트는 '숫자일 때만' 갱신 (값 없으면 유지)
        renderCountFromStore(id, card);  
        if (typeof liked === 'boolean') {
          const btn = card.querySelector('.btn-like');
          if (btn) {
            btn.setAttribute('aria-pressed', String(!!liked));
            (window.setHeartVisual ? window.setHeartVisual(btn, !!liked)
                                    : btn.classList.toggle('is-liked', !!liked));
          }
          // 읽기전용 그리드 하트 비주얼도 동기화
          const ro = card.querySelector('.stat[data-like-readonly] svg');
          if (ro && window.setHeartVisual) window.setHeartVisual(ro, !!liked);
        }
      });
    });
  }

  // "5w", "3d", "2h" 같은 상대 시간 — (댓글 제거로 현재 미사용) 제거

  // 안전한 텍스트 출력용
  const esc = (s) => String(s||'').replace(/[&<>"]/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
  }[m]));

  // 카드 마크업(댓글 표시 제거)
  function cardHTML(item) {
    const liked = !!item.liked;
    const likes = Number(item.likes || 0);
    const safeLabel = (item.label || '').replace(/[^\w-]+/g, '');

    // 소유자 판정 (isMine(item) 있으면 우선; 없으면 id 비교)
    const mine = isMine(item);

    return `
    <article class="feed-card" data-id="${item.id}" data-ns="${nsOf(item)}" data-owner="${mine ? 'me' : 'other'}">
      <div class="media">
        <img src="${blobURL(item)}" alt="${safeLabel || 'item'}" loading="lazy" />
        <div class="hover-ui" role="group" aria-label="Post actions">
          <div class="actions">
            <div class="stat" data-like-readonly>
              <span class="ico ico-heart" aria-hidden="true"></span>
              <span class="count" data-like-count data-count="${likes}">${fmtCount(likes)}</span>
            </div>

            <!-- [ADD] 내 게시물에만 노출되는 삭제 버튼 -->
            <button class="btn-del-thumb" type="button" aria-label="Delete"
                    ${mine ? '' : 'hidden'} data-del="${item.id}">
            </button>
          </div>
        </div>
      </div>
    </article>`;
  }

  // [ADD] Like rehydrate polyfill — 새로 붙은 카드들의 like/liked를 서버 스냅샷으로 동기화
  function rehydrateLikesFor(ids = []) {
    if (!Array.isArray(ids) || !ids.length) return;

    const pick = (o) => {
      const liked = o?.liked ?? o?.like ?? o?.liked_by_me ?? o?.item?.liked ?? o?.data?.liked ?? null;
      const likes = o?.likes ?? o?.like_count ?? o?.hearts ?? o?.item?.likes ?? o?.data?.likes ?? null;
      return {
        liked: (typeof liked === "boolean") ? liked : null,
        likes: (typeof likes === "number") ? Math.max(0, likes) : null
      };
    };

    const applyUI = (id, liked, likes) => {
      const cards = document.querySelectorAll(`.feed-card[data-id="${CSS.escape(String(id))}"]`);
      cards.forEach((card) => {
        if (typeof likes === "number") {
          const cnt = card.querySelector("[data-like-count]");
          if (cnt) { cnt.dataset.count = String(likes); cnt.textContent = (typeof fmtCount === "function" ? fmtCount(likes) : String(likes)); }
          const line = card.querySelector(".likes-line");
          if (line) line.innerHTML = `<span class="likes-count">${(typeof fmtInt==="function"?fmtInt(likes):String(likes))}</span> ${(typeof likeWordOf==="function"?likeWordOf(likes):(likes<=1?"like":"likes"))}`;
        }
        if (typeof liked === "boolean") {
          const btn = card.querySelector(".btn-like");
                  // [ADD] grid(읽기전용) 하트도 초기 상태 반영
          const ro = card.querySelector('.stat[data-like-readonly]');
          if (ro) {
            const svg = ro.querySelector('svg');
            if (svg) {
              (window.setHeartVisual || ((el,p)=>el.classList.toggle('is-liked', !!p)))(svg, liked);
            } else {
              const ico = ro.querySelector('.ico-heart');
              if (ico) ico.classList.toggle('is-liked', !!liked);
              ro.setAttribute('aria-pressed', String(!!liked));
            }
          }

          if (btn) {
            // setHeartVisual이 있으면 사용, 없으면 aria/class만
            try { (window.setHeartVisual || ((b,p)=>{b.classList.toggle("is-liked", !!p); b.setAttribute("aria-pressed", String(!!p));}))(btn, liked); }
            catch { btn.classList.toggle("is-liked", !!liked); btn.setAttribute("aria-pressed", String(!!liked)); }
          }
        }
      });

      // FEED 메모리 보정
      const key = String(id);
      const idx = FEED.idxById.get(key);
      if (typeof idx === "number" && FEED.items[idx]) {
        if (typeof liked === "boolean") FEED.items[idx].liked = liked;
        if (typeof likes === "number")  FEED.items[idx].likes = likes;
      }
    };

    const jobs = ids.map(async (rawId) => {
      const id  = String(rawId);
      const idx = FEED.idxById.get(id);
      const viewerNS = (window.getNS ? getNS() : "default");
      const itemNS   = (typeof idx === "number" && FEED.items[idx]?.ns) ? FEED.items[idx].ns : viewerNS;
      const pid = encodeURIComponent(id);
      const nsq = `ns=${encodeURIComponent(itemNS)}`;

      // 1) /api/items/:id
      try {
        const r = await api(`/api/items/${pid}?${nsq}`, { credentials: "include", cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          const { liked, likes } = pick(j) || pick(j.item) || pick(j.data) || {};
        if (typeof likes === "number" && window.setLikeCountOnly) window.setLikeCountOnly(id, likes);
        if (typeof liked === "boolean" && window.setLikeIntent) window.setLikeIntent(id, liked, likes);
        const rec = window.getLikeIntent ? window.getLikeIntent(id) : { liked, likes };
        applyUI(id, rec?.liked ?? liked, (typeof rec?.likes === "number" ? rec.likes : likes));
          return;
        }} catch {}

      // 2) /api/gallery/:id (폴백)
      try {
        const r = await api(`/api/gallery/${pid}?${nsq}`, { credentials: "include", cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          const { liked, likes } = pick(j) || pick(j.item) || pick(j.data) || {};
        if (typeof likes === "number" && window.setLikeCountOnly) window.setLikeCountOnly(id, likes);
        if (typeof liked === "boolean" && window.setLikeIntent) window.setLikeIntent(id, liked, likes);
        const rec = window.getLikeIntent ? window.getLikeIntent(id) : { liked, likes };
        applyUI(id, rec?.liked ?? liked, (typeof rec?.likes === "number" ? rec.likes : likes));
          return;
        }} catch {}
    });

    return Promise.allSettled(jobs);
  }


  function appendItems(items=[]) {
    const grid = $feedGrid(); if (!grid) return;
    const frag = document.createDocumentFragment();

    try { BG.apply(items); } catch {}

    const newIds = []; 

    const page = items.slice();
    shuffleInPlace(page); 
    for (const it of page) {
      const id = String(it.id);
      if (FEED.idxById.has(id)) continue;

      const wrap = document.createElement("div");
      wrap.innerHTML = cardHTML(it);
      const card = wrap.firstElementChild;

      // caption 텍스트 주입 (버그 수정: card 참조 순서)
      const cap = card.querySelector('[data-caption]');
      if (cap) cap.textContent = String(it.caption || it.text || "");

      // 이미지 에러 핸들링 → placeholder 배경만 노출
      const img = card.querySelector(".media img");
      if (img) {
        img.addEventListener("error", () => {
          const m = card.querySelector(".media");
          if (m) m.classList.add("broken");
          img.remove();
        }, { once: true });
      }

      try { upgradeHeartIconIn(card); } catch {}

      frag.appendChild(card);
      try { renderCountFromStore(id, card); } catch {}
            // [ADD] 캐시 우선: 페이지가 새로 뜨거나 돌아왔을 때도 사용자의 like 상태/카운트 유지
      try {
        const viewerNS = (window.getNS ? getNS() : "default");
        const rec = (typeof window.getLikeIntent === "function") ? window.getLikeIntent(id) : null;
        if (rec) commit(id, rec.liked, (typeof rec.likes === "number" ? rec.likes : it.likes));
      } catch {}

      FEED.idxById.set(id, FEED.items.length);
      FEED.items.push(it);

      newIds.push(id);
    }
    grid.appendChild(frag);
    if (newIds.length) subscribeItems(newIds);
    idle(() => rehydrateLikesFor(newIds));

    try { reconcileDeleteButtons(); } catch {}
  }

  async function loadMore() {
    if (FEED.busy || FEED.end) return;
    FEED.busy = true;
    try {
      // sentinel spinner on
      const s = $sentinel(); if (s) s.setAttribute("data-loading","1");

      const qs = new URLSearchParams({ limit: String(FEED.PAGE_SIZE) });
      if (FEED.cursor) {
        qs.set("after", String(FEED.cursor));   // 서버 호환 키
        qs.set("cursor", String(FEED.cursor));
      }

      const sel = sessionStorage.getItem(SELECTED_KEY);
      if (sel) qs.set("label", sel);

      const res = await api(`/api/gallery/public?${qs.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("feed-load-failed");
      const j = await res.json();
      const items = Array.isArray(j?.items) ? j.items : [];
      appendItems(items);
      FEED.cursor = j?.nextCursor || null;
      FEED.end = !FEED.cursor || items.length === 0;

      const more = $btnMore();
      if (more) more.disabled = !!FEED.end;
      if (FEED.end && __io) { __io.disconnect(); __io = null; }
    } catch {
      // silent fail
    } finally {
      FEED.busy = false;
      // sentinel spinner off
      const s = $sentinel(); if (s) s.removeAttribute("data-loading");
    }
  }

/* === HEART HOTFIX v4 — sticky optimistic + unified writer (2025-09-13, visual-free) ===
 * 증상:
 *  - 첫 클릭 후 +1, 이후에는 –1만 반복되거나 색상이 다시 채워지지 않음
 * 원인:
 *  - 낙관적 갱신 직후 서버 스냅샷이 구/오해 상태(liked:false, likes:0)로 UI를 되덮음
 * 해결:
 *  - 클릭 직후 1.2s 동안 모순 스냅샷 무시(끈적이 낙관적)
 *  - ✅ '하트 비주얼'은 오직 상단의 window.setHeartVisual만 사용(여기서 재정의 금지)
 */
(() => {
  const HEART_RED = '#E53935';
  const inflight = (window.LIKE_INFLIGHT || new Set());
  const STATE = (window.__HEART_STATE ||= new Map()); // id -> { liked, likes }
  const LAST  = (window.__HEART_LAST  ||= new Map()); // id -> last action ts

  const _fmtCount = (typeof window.fmtCount === 'function') ? window.fmtCount : (n)=>String(n||0);
  const _fmtInt   = (typeof window.fmtInt   === 'function') ? window.fmtInt   : (n)=>String(n||0);
  const _likeWord = (typeof window.likeWordOf=== 'function') ? window.likeWordOf : (n)=> (Number(n)<=1?'like':'likes');

  const api = (p,o)=> (window.auth?.apiFetch ? window.auth.apiFetch(p,o) : fetch(p,o));
  const withCSRF = window.withCSRF || (async (opt)=>opt);

  const getNS = (window.getNS ? window.getNS : ()=>'default');

  // 🔗 상단 전역 setHeartVisual만 호출 (없으면 안전 폴백)
  const hv = (target, pressed) => {
    if (typeof window.setHeartVisual === 'function') return window.setHeartVisual(target, pressed);
    const btn = (target instanceof SVGSVGElement) ? target.closest?.('.btn-like') : target;
    if (btn) { btn.classList.toggle('is-liked', !!pressed); btn.setAttribute('aria-pressed', String(!!pressed)); }
  };

  // --- DOM R/W: 모달(.likes-count) & 그리드([data-like-count]) 모두 처리 ----
  function readFromDOM(card){
    const btn = card?.querySelector?.('.btn-like');
    const liked = !!(btn && (btn.getAttribute('aria-pressed')==='true' || btn.classList.contains('is-liked')));
    let likes = 0;
    const cnt = card?.querySelector?.('[data-like-count]');
    if (cnt && cnt.dataset.count != null) likes = Number(cnt.dataset.count);
    else {
      const t = card?.querySelector?.('.likes-count')?.textContent || '0';
      likes = Number(String(t).replace(/[^\d]/g,'')) || 0;
    }
    return { liked, likes: Math.max(0, Number(likes||0)) };
  }

  function writeInto(card, liked, likes){
    if (!card) return;
    if (typeof likes === 'number'){
      const cnt = card.querySelector('[data-like-count]');
      if (cnt){ cnt.dataset.count = String(Math.max(0, likes)); cnt.textContent = _fmtCount(likes); }
      const line = card.querySelector('.likes-line');
      if (line){ line.innerHTML = `<span class="likes-count">${_fmtInt(likes)}</span> ${_likeWord(likes)}`; }
    }
    if (typeof liked === 'boolean'){
      const btn = card.querySelector('.btn-like');
      if (btn) hv(btn, liked);
    }
    const ro = card.querySelector('.stat[data-like-readonly]');
    if (ro) {
      const svg = ro.querySelector('svg');
      if (svg) hv(svg, liked);
      else {
        // 레거시 마크업 대비
        const ico = ro.querySelector('.ico-heart');
        if (ico) ico.classList.toggle('is-liked', !!liked);
        ro.setAttribute('aria-pressed', String(!!liked));
      }
    }
  }

  function likeTargetOf(card){
    const id = card?.dataset?.id; if (!id) return null;
    const ns = card?.dataset?.ns || getNS();
    return { id:String(id), ns:String(ns) };
  }

  // --- Server I/O -----------------------------------------------------------
  async function callLikeAPI(id, ns, wantLike){
    const mk = async (method, body=null)=> await withCSRF({
      method, credentials:'include',
      headers: body ? { 'Content-Type':'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const bases = ['items','gallery'];
    for (const b of bases){
      const u = `/api/${b}/${encodeURIComponent(id)}/like?ns=${encodeURIComponent(ns)}`;
      let r = await api(u, await mk('PUT', { like: !!wantLike }));
      if (!r?.ok && wantLike === false) r = await api(u, await mk('DELETE'));
      if (r?.ok){
        let j={}; try{ if (r.status!==204) j = await r.json(); }catch{}
        const liked = j?.liked ?? j?.item?.liked ?? j?.data?.liked;
        const likes = j?.likes ?? j?.item?.likes ?? j?.data?.likes;
        return { liked: (typeof liked==='boolean'? liked : null), likes: (typeof likes==='number'? likes : null) };
      }
    }
    return {};
  }

  async function fetchSnapshot(id, ns){
    const tryGet = async (u)=>{
      try{
        const r = await api(u, { credentials:'include', cache:'no-store' });
        const j = await r.json().catch(()=>({}));
        if (!r.ok) return null;
        const liked = j?.liked ?? j?.item?.liked ?? j?.data?.liked;
        const likes = j?.likes ?? j?.item?.likes ?? j?.data?.likes;
        return {
          liked: (typeof liked==='boolean'? liked : null),
          likes: (typeof likes==='number'? Math.max(0, likes) : null)
        };
      }catch{ return null; }
    };
    return (await tryGet(`/api/items/${encodeURIComponent(id)}?ns=${encodeURIComponent(ns)}`))
        || (await tryGet(`/api/gallery/${encodeURIComponent(id)}?ns=${encodeURIComponent(ns)}`))
        || null;
  }

  function commit(id, liked, likes){
    const st = STATE.get(id) || {};
    if (typeof liked === 'boolean') st.liked = liked;
    if (typeof likes === 'number')  st.likes = Math.max(0, likes);
    STATE.set(id, st);

    const run = () => {
      if (typeof window.updateLikeUIEverywhere === 'function') {
        window.updateLikeUIEverywhere(id, st.liked, st.likes);
      } else {
        document
          .querySelectorAll(`.feed-card[data-id="${CSS.escape(String(id))}"]`)
          .forEach(card => { writeInto(card, st.liked, st.likes); });
      }
    };
    (window.requestAnimationFrame || setTimeout)(run);
  }

    // [PATCH #3] 실시간 like 이벤트의 모순 스냅샷 1.2s 차단
  window.applyItemLikeEvent = function(p){
    try {
      const id  = String(p?.id || p?.itemId || '');
      if (!id) return;
      const ns  = String(p?.ns || p?.item_ns || p?.item?.ns || getNS());
      const liked = (p?.liked != null) ? !!p.liked : (p?.data?.liked ?? p?.item?.liked ?? null);
      const likes = (typeof p?.likes === 'number') ? p.likes : (p?.data?.likes ?? p?.item?.likes ?? null);

      // ★ 행위자 판별: p.by | p.user_id | p.uid | p.userId 등 호환
      const actor =
        p?.by ?? p?.user_id ?? p?.uid ?? p?.userId ?? p?.actor ?? p?.user?.id ?? null;
      const myId  = (typeof getMeId === 'function' && getMeId()) || (window.__ME_ID || null);
      const isMineEvent = (actor != null) && (String(actor) === String(myId));


      const last = LAST.get(id) || 0;
      // 1.2s 내에 들어온 '상충' 이벤트는 무시(사용자 최신 의도 보호)
      if (Date.now() - last <= 1200) {
        const st = STATE.get(id);
        if (st && liked != null && st.liked !== liked) return;
      }

      // 정상 업데이트 반영
      const prevLiked = STATE.get(id)?.liked ?? null;
      const nextLiked = isMineEvent
        ? (liked != null ? liked : prevLiked)
        : prevLiked;
      const nextLikes = (typeof likes === 'number') ? likes : (STATE.get(id)?.likes ?? null);
      commit(id, nextLiked, nextLikes);
      // 캐시/스토어에도 최신 count 반영
      if (typeof likes === 'number') { try { window.setLikeCountOnly?.(id, likes); } catch {} }
      // liked 플래그를 서버가 명시한 경우 의도 캐시 동기화
      if (liked != null) { try { window.setLikeIntent?.(id, liked, (typeof likes==='number'? likes : undefined)); } catch {} }
      if (typeof likes !== 'number') {
        throttleFetchLikes(id, ns);
      }

      try { window.setLikeIntent?.(id, nextLiked, nextLikes); } catch {}
    } catch {}
  };

  window.toggleLike = toggleLike;
  
  // --- 메인 토글: 끈적 낙관 + 모순 스냅샷 TTL 차단 ---------------------------
  async function toggleLike(card, forceLike){
    const tgt = likeTargetOf(card); if (!tgt) return;
    const { id, ns } = tgt;

    if (inflight.has(id)) return;
    inflight.add(id);

    const dom = readFromDOM(card);
    const prev = STATE.get(id) || dom;
    const wantLike = (forceLike != null) ? !!forceLike : !prev.liked;

    const btn = card.querySelector('.btn-like');
    try { btn?.setAttribute('aria-busy','true'); if (btn) btn.disabled = true; } catch {}

    // ① 낙관적 커밋
    const prevLikes = Number(readFromDOM(card).likes || 0);
    const nextLikes = (prev.liked === wantLike) ? prevLikes : Math.max(0, prevLikes + (wantLike ? +1 : -1));
    commit(id, wantLike, nextLikes);
    if (window.setLikeIntent) window.setLikeIntent(id, wantLike, nextLikes);
    LAST.set(id, Date.now());
    bcNotifySelf("self:like", { id, ns, liked: wantLike, likes: nextLikes });

    // ② 서버 동기화 (+ 모순 스냅샷 무시)
    try{
      const r = await callLikeAPI(id, ns, wantLike);
      const ttl = 1200; // ms
      const age = Date.now() - (LAST.get(id) || 0);
      if (r) {
        if (typeof r.likes === "number") {
          commit(id, /*liked*/ null, r.likes);
          if (window.setLikeCountOnly) window.setLikeCountOnly(id, r.likes);
        }
        if (typeof r.liked === "boolean") {
          // 의도도 서버가 돌려주면 동기화(최신 의도와 동일할 가능성이 높음)
          commit(id, r.liked, /*likes*/ null);
          if (window.setLikeIntent) window.setLikeIntent(id, r.liked);
        }
      }
    } finally {
      inflight.delete(id);
      try { btn?.removeAttribute('aria-busy'); if (btn) btn.disabled = false; } catch {}
    }
  }

  // [ADD] throttle된 스냅샷 리프레시 큐 (id별 1회/250ms)
  const __LIKE_REFRESH_Q = new Map();
  function throttleFetchLikes(id, ns){
    if (__LIKE_REFRESH_Q.has(id)) return;
    const t = setTimeout(async () => {
      __LIKE_REFRESH_Q.delete(id);
      try {
        const snap = await fetchSnapshot(id, ns);
        if (snap && (typeof snap.likes === "number")) {
          // liked는 내 계정 상태와 분리되므로 덮어쓰지 않고, '개수'만 권위값으로 반영
          commit(id, /*liked*/ null, /*likes*/ snap.likes);
          // 로컬 캐시도 개수만 갱신(계정 분리 유지)
          try { window.setLikeCountOnly?.(id, snap.likes); } catch {}
        }
      } catch {}
    }, 250);
    __LIKE_REFRESH_Q.set(id, t);
  }

  // 공개 심볼 재지정
  window.toggleLike = toggleLike;

  // 업그레이드 누락 보호(초기 로드시 SVG/색상 보정)
  try { window.upgradeHeartIconIn?.(document); } catch {}
})();


  // -----------------------------------------------------------------------


  // FEED memory sync for item-like
  function setFeedMemoryLike(id, liked, likes){
    const key = String(id);
    const idx = FEED.idxById.get(key);
    if (typeof idx === 'number' && FEED.items[idx]) {
      if (typeof liked === 'boolean') FEED.items[idx].liked = liked;
      if (typeof likes === 'number' && !Number.isNaN(likes)) FEED.items[idx].likes = Math.max(0, likes);
    }
  }

  function mineFlagOf(item) {
    if (!item) return null;
    const flag =
      item?.mine ?? item?.isMine ?? item?.by_me ?? item?.byMe ??
      item?.created_by_me ?? item?.posted_by_me ?? item?.i_posted ?? item?.author_me ??
      item?.meta?.mine ?? item?.meta?.by_me ?? null;
    return (typeof flag === "boolean") ? flag : null;
  }

  function normEmail(e){
   e = String(e||'').trim().toLowerCase();
    if (!e) return null;
    const i = e.indexOf('@');
    if (i < 0) return e;
    let local = e.slice(0,i);
    let domain = e.slice(i+1);

    // Gmail 규칙만 안전하게 적용: +이후 제거, 점 무시
    if (domain === 'gmail.com' || domain === 'googlemail.com'){
      local = local.split('+')[0].replace(/\./g,'');
      domain = 'gmail.com';
    }
    return `${local}@${domain}`;
  }

  function pickUserId(item){
    return (
      item?.user?.id ??
      item?.user?.sub ??   
      item?.author?.id ??
      item?.user_id ?? item?.uid ??
      item?.owner_id ?? item?.ownerId ??
      item?.created_by ?? item?.createdBy ??
      null
    );
  }
  function pickUserEmail(item){
    return (
      item?.user?.email ??
      item?.user?.emails?.[0]?.value ??
      item?.email ??
      item?.author?.email ??
      item?.meta?.email ??
      null
    );
  }

  // === 소유자 판정 (id/email/ns 모두 케어) ===
  function isMine(item) {
    if (!item) return false;

    // 서버가 명시적으로 주면 그대로 사용
    const flag =
      item?.mine ?? item?.isMine ?? item?.by_me ?? item?.byMe ??
      item?.created_by_me ?? item?.posted_by_me ?? item?.i_posted ?? item?.author_me ??
      item?.meta?.mine ?? item?.meta?.by_me ?? null;
    if (typeof flag === "boolean") return flag;

    // 내 식별자
    const meId     = (typeof getMeId === "function" && getMeId()) || (window.__ME_ID || null);
    const myEmail  = normEmail((typeof getMeEmail === "function" && getMeEmail()) || (window.__ME_EMAIL || null));
    const myNsHint = (()=>{
      try { return String(localStorage.getItem("auth:userns") || "").trim().toLowerCase(); }
      catch { return ""; }
    })();
    // 상대 식별자
    const theirId     = pickUserId(item);
    const theirEmail  = normEmail(pickUserEmail(item));

    // 1) id 일치
    if (meId && theirId && String(theirId) === String(meId)) return true;

    // 2) email 일치
    if (myEmail && theirEmail && myEmail === theirEmail) return true;

    // 3) ns는 '이메일' 또는 'user:ID'만 신뢰 (공유 ns 오판 방지)
    const ns = String(item?.ns || item?.meta?.ns || "").trim().toLowerCase();
    if (ns) {
      if (myEmail && /@/.test(ns) && ns === myEmail) return true;                 // ns가 이메일
      if (meId && (ns === `user:${String(meId).toLowerCase()}`)) return true;     // ns가 user:{id}
      if (meId && (ns === String(meId).toLowerCase())) return true;               // ns가 그냥 {id}
      if (myNsHint && ns === myNsHint) return true;                               // 로컬 보조 힌트
    }
    return false;
  }

  // 상세 조회로 user 정보가 비어있을 때 한 번만 보강
  async function ensureAuthorInfo(item) {
    if (!item) return item;
    if (mineFlagOf(item) !== null || isMine(item)) return item;

    try {
      const ns = nsOf(item);
      let r, j = {};

      // ✅ 1순위: /api/items/:id
      r = await api(`/api/items/${encodeURIComponent(item.id)}?ns=${encodeURIComponent(ns)}`,
                    { credentials:'include', cache:'no-store' });
      j = await r.json().catch(() => ({}));

      // 폴백: /api/gallery/:id
      if (!r.ok) {
        r = await api(`/api/gallery/${encodeURIComponent(item.id)}?ns=${encodeURIComponent(ns)}`,
                      { credentials:'include', cache:'no-store' });
        j = await r.json().catch(() => ({}));
      }

      const pickUser = (o) => (o?.user || o?.item?.user || o?.data?.user || null);
      const u = pickUser(j);
      if (u) item.user = u;

      if (!pickUserEmail(item)) {
        const email = u?.email ?? j?.email ?? j?.item?.email ?? j?.data?.email ?? null;
        if (email) item.user = { ...(item.user||{}), email };
      }

      const byme =
        j?.mine ?? j?.isMine ?? j?.by_me ?? j?.byMe ??
        j?.item?.mine ?? j?.item?.by_me ?? j?.data?.by_me ?? null;
      if (typeof byme === "boolean") item.mine = byme;
    } catch {}

    return item;
  }


  // === 삭제 API (경로 호환 넓힘: DELETE 표준 → POST 폴백) ===================
  async function deleteItemById(id, ns) {
    await ensureCSRF();

    // 1) 표준 REST: DELETE /api/items/:id
    let r = await api(
      `/api/items/${encodeURIComponent(id)}?ns=${encodeURIComponent(ns)}`,
      await withCSRF({ method: "DELETE", credentials: "include" })
    );

    // 2) 구환경 폴백: POST /api/items/:id/delete
    if (!r.ok && (r.status === 404 || r.status === 405)) {
      r = await api(
        `/api/items/${encodeURIComponent(id)}/delete?ns=${encodeURIComponent(ns)}`,
        await withCSRF({ method: "POST", credentials: "include" })
      );
    }

    // 3) 최후 폴백: POST /api/delete?item=ID
    if (!r.ok && (r.status === 404 || r.status === 405)) {
      r = await api(
        `/api/delete?item=${encodeURIComponent(id)}&ns=${encodeURIComponent(ns)}`,
        await withCSRF({ method: "POST", credentials: "include" })
      );
    }

    const j = await r.json().catch(()=>({}));
    if (!r.ok || j?.ok === false) throw new Error("delete-fail");
    return true;
  }

  /* =========================================================
  * FEED FILTER: Mine only toggle (UI + logic)
  * ========================================================= */
  const FILTER_KEY_BASE = 'feed:mineOnly';
  function filterKey(){ try { return `${FILTER_KEY_BASE}:${getNS()}`; } catch { return `${FILTER_KEY_BASE}:default`; } }
  function getMineOnly(){ try { return localStorage.getItem(filterKey()) === '1'; } catch { return false; } }
  function setMineOnly(v){ try { localStorage.setItem(filterKey(), v ? '1':'0'); } catch {} }

  function applyMineFilter(){
    const grid = $feedGrid(); if (!grid) return;
    const on = getMineOnly();
    grid.setAttribute('data-filter-mine', on ? '1' : '0');
    grid.querySelectorAll('.feed-card').forEach(card => {
      const mine = (card.dataset.owner === 'me');
      card.hidden = on && !mine; // 내 것이 아니면 숨김
    });
    const btn = document.getElementById('btn-mine-only');
    if (btn) btn.setAttribute('aria-pressed', String(on));
  }

  function ensureMineFilterUI(){
    const root = $feedRoot(); if (!root) return;
    if (root.querySelector('#btn-mine-only')) return;

    const bar = document.createElement('div');
    bar.className = 'feed-toolbar';

    const btn = document.createElement('button');
    btn.type='button';
    btn.id = 'btn-mine-only';
    btn.className = 'btn';
    btn.textContent = 'Only mine';
    btn.setAttribute('aria-pressed', String(getMineOnly()));
    btn.addEventListener('click', () => { setMineOnly(!getMineOnly()); applyMineFilter(); });

    bar.appendChild(btn);
    root.insertBefore(bar, root.firstChild); // feed 상단 우측에 뜸
  }

  /* === 내 게시물 삭제버튼 재노출(로그인 id가 늦게 도착한 경우) === */
  async function reconcileDeleteButtons() {
    try {
      const jobs = FEED.items.map(async (it) => {
        if (!it || !it.id) return;

        // 사용자 정보가 비어 있으면 1회 보강 후 판정
        if (
          mineFlagOf(it) === null &&
          !pickUserId(it) &&
          !pickUserEmail(it)
        ) {
          await ensureAuthorInfo(it).catch(() => {});
        }

        const mine = isMine(it);
        const idSel = CSS.escape(String(it.id));
        document.querySelectorAll(`.feed-card[data-id="${idSel}"]`).forEach((card) => {
          card.dataset.owner = mine ? "me" : "other";
          const btn = card.querySelector(".btn-del-thumb");
          if (btn) {
            btn.hidden = !mine;
            btn.setAttribute("aria-hidden", String(!mine));
            if (!mine) btn.tabIndex = -1; else btn.removeAttribute("tabindex");
          }
        });
      });

      await Promise.allSettled(jobs);
    } catch {}
    try { applyMineFilter(); } catch {}
  }

  // === 전역에서 같은 id의 카드 제거 + FEED 인덱스 재구축 ======================
  function removeItemEverywhere(id) {
    const key = String(id);

    // 1) DOM 제거 (그리드/모달 등)
    document.querySelectorAll(`.feed-card[data-id="${CSS.escape(String(key))}"]`).forEach(el => el.remove());

    // 2) FEED 배열/인덱스 갱신
    const idx = FEED.idxById.get(key);
    if (typeof idx === "number") {
      FEED.items.splice(idx, 1);
      FEED.idxById.clear();
      FEED.items.forEach((it, i) => FEED.idxById.set(String(it.id), i));
    }

    // 3) 소켓 구독 해제
    try { unsubscribeItems([key]); } catch {}
  }


  // =======================
  // VOTE (robust + no 404)
  // =======================
  const POLL = (() => {
    const OPTIONS = Object.keys(ICONS); // ['thump','miro','whee','track','echo','portal']
    const countsById = new Map(); // itemId -> {label:number}
    const myById     = new Map(); // itemId -> 'label' | null

    const emptyCounts = () => OPTIONS.reduce((a,k)=>(a[k]=0,a), {});

        // [ADD] 내 수집 라벨 기준으로 잠금/표시를 제어
    function getCollectedSet() {
      try {
        if (window.store?.getCollected) return new Set((window.store.getCollected() || []).map(String));
        const arr = JSON.parse(sessionStorage.getItem(REG_KEY) || "[]");
        return new Set((arr || []).map(String));
      } catch { return new Set(); }
    }
    function decorateVoteLock(container){
      if (!container) return;
      const reg = getCollectedSet();
      container.querySelectorAll('.vote-opt').forEach(btn => {
        const lb = btn.dataset.label;
        const unlocked = reg.has(lb);
        btn.classList.toggle('is-locked', !unlocked);
        btn.toggleAttribute('disabled', !unlocked);
        const lab = btn.querySelector('.label');
        if (lab) lab.textContent = unlocked ? `#${lb}` : '#aud';
      });
    }

    function normalizeCounts(raw) {
      if (!raw) return emptyCounts();
      if (Array.isArray(raw)) {
        const out = emptyCounts();
        raw.forEach(r => {
          const k = String(r.label||'').trim();
          const n = Number(r.count||0);
          if (OPTIONS.includes(k)) out[k] = Math.max(0, n);
        });
        return out;
      }
      if (typeof raw === 'object') {
        const out = emptyCounts();
        for (const k of OPTIONS) out[k] = Math.max(0, Number(raw[k]||0));
        return out;
      }
      return emptyCounts();
    }

    // 서버 응답 포맷 다양성 흡수: {counts} | {totals} | {votes} | {data} 등
    function pickVotesFrom(obj) {
      if (!obj || typeof obj !== 'object') return { counts: emptyCounts(), my: null, total: 0 };
      const c = normalizeCounts(obj.votes || obj.counts || obj.totals || obj.items || obj.data || obj);
      const my = obj.my ?? obj.mine ?? obj.choice ?? obj.selected ?? null;
      const total = Number(obj.total ?? Object.values(c).reduce((s, n) => s + Number(n || 0), 0));
      return { counts: c, my: (OPTIONS.includes(my) ? my : null), total };
    }

    // 서버에 GET /api/items/:id/votes 가 없을 때 404를 없애기 위한 zero-404 버전
    // [REPLACE] 표준 → 대체 → 메타 추출 순으로 시도
    async function fetchVotes(itemId, ns) {
      const pid = encodeURIComponent(itemId);
      const nsq = `ns=${encodeURIComponent(ns)}`;

      // 1) 표준: GET /api/items/:id/votes
      try {
        const r = await api(`/api/items/${pid}/votes?${nsq}`, { credentials: 'include', cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          const picked = pickVotesFrom(j) || pickVotesFrom(j.item) || pickVotesFrom(j.data);
          if (picked?.counts) return picked;
        }
      } catch {}

      // 2) 대체: GET /api/votes?item=ID
      try {
        const r = await api(`/api/votes?item=${pid}&${nsq}`, { credentials: 'include', cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          const picked = pickVotesFrom(j) || pickVotesFrom(j.item) || pickVotesFrom(j.data);
          if (picked?.counts) return picked;
        }
      } catch {}

      // 3) 메타 혼합: GET /api/items/:id → 필드에서 추출 (완전 폴백)
      try {
        const r = await api(`/api/items/${pid}?${nsq}`, { credentials: 'include', cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          const picked = pickVotesFrom(j) || pickVotesFrom(j.item) || pickVotesFrom(j.data);
          if (picked?.counts) return picked;
        }
      } catch {}

      return { counts: emptyCounts(), my: null, total: 0 };
    }

    // 표준 우선: PUT /api/items/:id/vote?label=… → POST /api/items/:id/votes

    // [REPLACE] castVote
    async function castVote(itemId, label, ns) {
      await ensureCSRF();
      const pid = encodeURIComponent(itemId);
      const nsq = `ns=${encodeURIComponent(ns)}`;

      // 1) 신형: PUT /items/:id/vote?label=...
      let r = await api(
        `/api/items/${pid}/vote?${nsq}&label=${encodeURIComponent(label)}`,
        await withCSRF({ method: "PUT", credentials: "include" })
      );

      // 2) 신형(바디 JSON)
      if (!r.ok) {
        r = await api(
          `/api/items/${pid}/vote?${nsq}`,
          await withCSRF({
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label })
          })
        );
      }

      // 3) 구형: POST /items/:id/votes
      if (!r.ok) {
        r = await api(
          `/api/items/${pid}/votes?${nsq}`,
          await withCSRF({
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label })
          })
        );
      }

      // 4) 레거시: POST /api/votes
      if (!r.ok) {
        r = await api(
          `/api/votes?${nsq}`,
          await withCSRF({
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ item_id: itemId, label })
          })
        );
      }

      let j = {};
      try { if (r.status !== 204) j = await r.json(); } catch {}
      if (r.ok) {
        const picked = pickVotesFrom(j) || pickVotesFrom(j.item) || pickVotesFrom(j.data);
        if (picked && picked.counts) return picked;
      }
      return { counts: null, my: label, total: null };
    }

    // [REPLACE] unvote  ←← 유지 (뒤쪽 중복 정의 제거)
    async function unvote(itemId, ns) {
      await ensureCSRF();
      const pid = encodeURIComponent(itemId);
      const nsq = `ns=${encodeURIComponent(ns)}`;

      // 1) 신형: DELETE /items/:id/vote
      let r = await api(
        `/api/items/${pid}/vote?${nsq}`,
        await withCSRF({ method: "DELETE", credentials: "include" })
      );

      // 2) 신형(복수): DELETE /items/:id/votes
      if (!r.ok) {
        r = await api(
          `/api/items/${pid}/votes?${nsq}`,
          await withCSRF({ method: "DELETE", credentials: "include" })
        );
      }

      // 3) 레거시: DELETE /api/votes?item=ID
      if (!r.ok) {
        r = await api(
          `/api/votes?item=${pid}&${nsq}`,
          await withCSRF({ method: "DELETE", credentials: "include" })
        );
      }

      // 4) 아주 레거시: POST /items/:id/unvote, /api/unvote
      if (!r.ok) {
        r = await api(
          `/api/items/${pid}/unvote?${nsq}`,
          await withCSRF({ method: "POST", credentials: "include" })
        );
        if (!r.ok) {
          r = await api(
            `/api/unvote?item=${pid}&${nsq}`,
            await withCSRF({ method: "POST", credentials: "include" })
          );
        }
      }

      let j = {};
      try { if (r.status !== 204) j = await r.json(); } catch {}
      if (r.ok) {
        const picked = pickVotesFrom(j) || pickVotesFrom(j.item) || pickVotesFrom(j.data);
        if (picked && picked.counts) return picked;
      }
      return { counts: null, my: null, total: null };
    }

    function uiUpdate(container, counts, my) {
      decorateVoteLock(container);
      if (!container) return;
      const buttons = container.querySelectorAll('.vote-opt');

      let total = 0;
      Object.keys(counts||{}).forEach(k => total += Number(counts?.[k]||0));

      buttons.forEach(btn => {
        const lb = btn.dataset.label;
        const c = Number(counts?.[lb] || 0);
        btn.querySelector('.count').textContent = String(c);
        btn.setAttribute('aria-pressed', String(my === lb));
      });

      // 숫자 + 접미사 갱신
      const tl  = container.querySelector('[data-vote-total]');
      const suf = container.querySelector('[data-vote-suffix]');
      if (tl)  tl.textContent  = String(total);

      if (suf) {
        suf.textContent = voteWordOf(total);
      } else {
        // [Fallback] 예전 마크업(접미사 span 없음)일 때 안전하게 덮어쓰기
        const meta = container.querySelector('.vote-meta');
        if (meta) meta.innerHTML = `<span data-vote-total>${total}</span> ${voteWordOf(total)}`;
      }
    }

    function updateEverywhere(itemId, counts, my) {
      const sel = `.pm-vote[data-for-id="${CSS.escape(String(itemId))}"]`;
      document.querySelectorAll(sel).forEach(el => uiUpdate(el, counts, my));
    }

    async function mount(container, item) {
      if (!container || !item?.id) return;
      container.dataset.forId = String(item.id);
      container.innerHTML = `
        <div class="vote-list" role="group" aria-label="Vote by label">
          ${Object.keys(ICONS).map(lb => `
            <button class="vote-opt" type="button" data-label="${lb}" aria-pressed="false">
              <span class="label">#${lb}</span>
              <span class="count">0</span>
            </button>
          `).join('')}
        </div>
        <div class="vote-meta">
          <span data-vote-total>0</span> <span data-vote-suffix>vote</span>
        </div>
        <div class="vote-hint">You can select one label per account. You can reactivate the panel.</div>
      `;

      decorateVoteLock(container); // [ADD] 최초 마운트 시 잠금/표시 적용

      // [ADD] 라벨 수집 변화 이벤트가 오면 즉시 갱신
      if (!container.__relabelBound) {
        container.__relabelBound = true;
        const relabel = () => decorateVoteLock(container);
        window.addEventListener(EVT_LABEL, relabel);
      }

      const ns = item.ns || getNS();
      const { counts, my } = await fetchVotes(item.id, ns);
      countsById.set(String(item.id), counts);
      myById.set(String(item.id), my);
      uiUpdate(container, counts, my);
      try { window.applyItemVoteCounts?.(counts); } catch {}

      if (!container.__bound) {
        container.__bound = true;
        container.addEventListener('click', async (e) => {
          const btn = e.target.closest?.('.vote-opt'); if (!btn) return;
          if (btn.classList.contains('is-locked') || btn.disabled) {
            const hint = container.querySelector('.vote-hint');
            if (hint) hint.textContent = '아직 열지 않은 라벨이에요. 수집하면 #aud가 해제됩니다.';
            return;
          }
          const lb = btn.dataset.label;
          const id = container.dataset.forId;
          const ns = container.closest('.feed-card')?.dataset?.ns || getNS();

          const prevMy = myById.get(id) || null;
          let counts = countsById.get(id) || {};

          if (prevMy === lb) {
            counts = { ...counts, [lb]: Math.max(0, (counts[lb]||0) - 1) };
            myById.set(id, null);
            countsById.set(id, counts);
            updateEverywhere(id, counts, null);
            bcNotifySelf("self:vote", { id, ns, choice: null, counts });
            try { window.addLabelVoteDelta?.(lb, -1); } catch {}

            const res = await unvote(id, ns);
            if (res.counts) { countsById.set(id, res.counts); myById.set(id, res.my); updateEverywhere(id, res.counts, res.my); }
          } else {
            if (prevMy) counts = { ...counts, [prevMy]: Math.max(0, (counts[prevMy]||0)-1) };
            counts = { ...counts, [lb]: Math.max(0, (counts[lb]||0)+1) };
            myById.set(id, lb);
            countsById.set(id, counts);
            updateEverywhere(id, counts, lb);
            bcNotifySelf("self:vote", { id, ns, choice: lb, counts });
            try {
              if (prevMy) window.addLabelVoteDelta?.(prevMy, -1);
              window.addLabelVoteDelta?.(lb, +1);
            } catch {}

            const res = await castVote(id, lb, ns);
            if (res.counts) { countsById.set(id, res.counts); myById.set(id, res.my); updateEverywhere(id, res.counts, res.my); }
            else {
              const back = await fetchVotes(id, ns);
              countsById.set(id, back.counts); myById.set(id, back.my);
              updateEverywhere(id, back.counts, back.my);
            try {
              const fixed = (res && res.counts) ? res.counts : null;
              if (fixed) window.setLabelVotesMap?.(fixed); // 서버 스냅샷으로 덮어쓰기
            } catch {}
            }
          }

          try {
            __bcFeed?.postMessage({
              kind: FEED_EVENT_KIND,
              payload: { type: "vote:update", data: { id, counts: countsById.get(id), my: myById.get(id), by: getMeId() } }
            });
          } catch {}
        });
      }
    }

    return { mount, updateEverywhere };
  })();

  function bindFeedEvents() {
    const grid = $feedGrid();
    if (!grid || grid.__bound) return;
    grid.__bound = true;

    grid.addEventListener("click", async (e) => {
      // 1) 삭제 버튼 클릭: 모달 오픈 막고 삭제 처리
      const delBtn = e.target.closest?.(".btn-del-thumb");
      if (delBtn) {
        e.preventDefault(); e.stopPropagation();
        const card = delBtn.closest(".feed-card");
        if (!card || card.dataset.owner !== "me") return;
        const id   = String(card?.dataset?.id || "");
        const ns   = card?.dataset?.ns || getNS();
        if (!id) return;

        const ok = confirm("Would you like to delete this post? This action cannot be undone.");
        if (!ok) return;

        // [추가] 중복 클릭 방지
        delBtn.disabled = true;
        delBtn.setAttribute("aria-busy","true");

        // 낙관적 제거
        removeItemEverywhere(id);

        try {
          await deleteItemById(id, ns);
          __bcFeed?.postMessage({ kind: FEED_EVENT_KIND, payload: { type:"item:removed", data:{ id } } });
        } catch {
          alert("Deletion failed. Please refresh and try again.");
          // [선택] 여기서 즉시 복구 로직을 넣고 싶다면, 서버 확정 전까지 삭제를 큐잉하는 구조로 바꾸면 됨.
        } finally {
          delBtn.removeAttribute("aria-busy");
          delBtn.disabled = false;
        }
        return;
      }

      // 2) 하트 클릭: 모달 오픈 막음 (기존 로직 유지)
      if (e.target.closest?.(".btn-like")) {
        e.preventDefault();
        e.stopPropagation();
        const card = e.target.closest?.(".feed-card");
        if (card) toggleLike(card);   // ★ 토글 실행
        return;
      }

      // 3) 카드 클릭 → 모달 오픈
      const card = e.target.closest?.(".feed-card");
      if (card) openPostModalById(String(card.dataset.id));
    });
  }

  /* =========================================================
  * 8.5) REALTIME: Socket.IO 연결 + 아이템 룸 구/탈퇴 + 이벤트 적용기
  * ========================================================= */
  let __sock = null;

  function ensureSocket() {
    if (__sock) return __sock;
    if (!window.io) {
      console.warn("[rt] socket.io client not found. Load /socket.io/socket.io.js in HTML.");
      return null;
    }
    __sock = window.io(API_ORIGIN || undefined, {
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket","polling"]
    });

    __sock.on("connect", () => {
      // 재연결 시 현재 보이는 카드/오픈 모달 재구독
      try {
        const ids = Array.from(document.querySelectorAll('.feed-card[data-id]'))
          .map(el => el.getAttribute('data-id'))
          .filter(Boolean);
        if (ids.length) __sock.emit("subscribe", { items: ids });
      } catch {}
    });

    __sock.on("item:like", (p) => {
      try { window.applyItemLikeEvent?.(p); } catch {}
      try { const id = String(p?.id || p?.itemId || ""); if (id) renderCountFromStore(id); } catch {}
      try { __bcFeed?.postMessage({ kind: FEED_EVENT_KIND, payload: { type: "item:like", data: p } }); } catch {}
    });

    __sock.on("vote:update", (p) => {
      try {
        const id = String((p && (p.id || p.itemId)) || "");
        if (!id) return;
        const counts = (p && (p.counts || p.totals || p.votes || p.items || p.data)) || {};
        const my = p?.my ?? p?.mine ?? p?.choice ?? null;
        POLL.updateEverywhere(id, counts, my);
      } catch {}
      try {
        __bcFeed?.postMessage({ kind: FEED_EVENT_KIND, payload: { type:"vote:update", data: p } });
      } catch {}
    });

    __sock.on("item:removed", (p) => {
    try {
      const id = String(p?.id || p?.itemId || "");
      if (!id) return;
      removeItemEverywhere(id);

      // 열려 있는 모달이 그 아이템이면 닫기
      const openCard = document.querySelector('#post-modal .feed-card[data-id]');
      if (openCard && String(openCard.getAttribute('data-id')) === id) {
        const modal = document.getElementById('post-modal');
        if (modal && !modal.hidden) {
          document.querySelector('.pm-close')?.click();
        }
      }
    } catch {}
  });
  __sock.on("user:updated", (p) => {
    if (!p?.id) return;
    // 캐시무효 목적의 v=rev 쿼리 파라미터는 서버에서 avatarUrl에 붙여서 보내는 게 제일 확실
    try { window.dispatchEvent(new CustomEvent("user:updated", { detail: p })); } catch {}
  });
    return __sock;
  }

  function subscribeItems(ids = []) {
    if (!ids.length) return;
    const s = ensureSocket(); if (!s) return;
    s.emit("subscribe", { items: ids });
  }
  function unsubscribeItems(ids = []) {
    if (!ids.length || !__sock) return;
    __sock.emit("unsubscribe", { items: ids });
  }

  window.addEventListener('beforeunload', () => {
    try { if (__io) { __io.disconnect(); __io = null; } } catch {}
    try { if (__sock && typeof __sock.close === 'function') { __sock.close(); } } catch {}
    try {
      if (observeAvatars.__obs && typeof observeAvatars.__obs.disconnect === 'function') {
        observeAvatars.__obs.disconnect();
        observeAvatars.__obs = null;
      }
    } catch {}
  });


  /* =========================================================
   * 9) INFINITE SCROLL
   * ========================================================= */
  let __io = null; // IntersectionObserver instance

  function ensureSentinel() {
    let s = $sentinel();
    const container = $feedScroll();
    if (s) return s;
    s = document.createElement("div");
    s.id = "feed-sentinel";
    s.setAttribute("aria-hidden", "true");
    Object.assign(s.style, { width: "100%", height: "1px", margin: "1px 0" });
    (container || $feedBottom() || $feedRoot())?.appendChild(s);
    return s;
  }

  function initInfiniteScroll() {
    const s = ensureSentinel();
    const rootEl = $feedScroll(); // optional scroll container
    if (!("IntersectionObserver" in window) || !s) { initLegacyScrollFallback(); return; }
    if (__io) return;

    const more = $btnMore(); if (more) more.style.display = "none";

    __io = new IntersectionObserver(async (entries) => {
      if (!entries.some(e => e.isIntersecting)) return;
      if (FEED.busy || FEED.end) return;
      await loadMore();
    }, {
      root: rootEl || null,
      rootMargin: (rootEl ? "600px 0px" : "1200px 0px"),
      threshold: 0.01
    });

    __io.observe(s);
  }

  function initLegacyScrollFallback() {
    if (initLegacyScrollFallback.__bound) return;
    initLegacyScrollFallback.__bound = true;

    const more = $btnMore(); if (more) more.style.display = "";
    const scroller = $feedScroll();

    const onScroll = () => {
      if (FEED.busy || FEED.end) return;
      const scrollPos = scroller
        ? (scroller.scrollTop + scroller.clientHeight)
        : (window.innerHeight + window.scrollY);
      const docH = scroller
        ? scroller.scrollHeight
        : Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      if (docH - scrollPos < 800) loadMore();
    };

    (scroller || window).addEventListener("scroll", onScroll, { passive: true });
  }

  // [ADD] 키 마이그레이션 유틸
  function migrateMineOnlyFlagToNS(){
    try {
      const ns = getNS();
      if (!ns || ns === 'default') return;
      const oldKey = `${FILTER_KEY_BASE}:default`;
      const newKey = `${FILTER_KEY_BASE}:${ns}`;
      const oldVal = localStorage.getItem(oldKey);
      if (oldVal != null && localStorage.getItem(newKey) == null) {
        localStorage.setItem(newKey, oldVal);
      }
    } catch {}
  }

  // === Store Likes → UI Bridge (mount early) ==========================
  (function bridgeStoreLikesToUI(){
    if (!window.readLikesMap) return;

    function applyMap(map){
      if (!map) return;
      for (const [id, rec] of Object.entries(map)){
        const likes = (typeof rec?.c === "number")  ? rec.c : null;
        if (likes !== null) { try { renderCountFromStore(id); } catch {} }
      }
    }

    // ① 초기 스냅샷으로 즉시 보정
    try { applyMap(readLikesMap()); } catch {}

    // ② 같은 탭 내 변경 이벤트
    window.addEventListener("itemLikes:changed", (e)=>{
      applyMap(e?.detail?.map || readLikesMap());
    });

    // ③ 다른 탭에서 온 동기화(localStorage)도 수신
    window.addEventListener("storage", (e)=>{
      if (e && e.key === window.LIKES_SYNC_KEY && e.newValue) {
        try { const payload = JSON.parse(e.newValue); applyMap(payload?.map || null); } catch {}
      }
    });
  })();

  /* =========================================================
   * 10) HERO/이벤트/부트
   * ========================================================= */
  function heroIn() {
    const hero = $(".mine .hero");
    if (hero) requestAnimationFrame(() => setTimeout(() => hero.classList.add("is-in"), 0));
  }

  function idle(fn){ if ("requestIdleCallback" in window) return requestIdleCallback(fn, { timeout: 500 }); return setTimeout(fn, 0); }
  function onReady(fn) { document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn, { once: true }) : fn(); }

  function bindEvents() {
    if (bindEvents.__bound) return; bindEvents.__bound = true;

    window.addEventListener(EVT_LABEL, scheduleRender);
    window.addEventListener(EVT_JIB,   scheduleRender);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleRender();
    });

    window.addEventListener("storage", (e) => {
      if (!e || !e.key || !e.newValue) return;
      if (e.key.includes("label:sync") || e.key.includes("jib:sync")) {
        try {
          const msg = JSON.parse(e.newValue);
          if (msg?.type === "set" && Array.isArray(msg.arr)) {
            if (e.key.includes("label:sync")) {
              sessionStorage.setItem(REG_KEY, JSON.stringify(msg.arr));
              window.dispatchEvent(new Event(EVT_LABEL));
            } else {
              sessionStorage.setItem(JIB_KEY, JSON.stringify(msg.arr));
              window.dispatchEvent(new Event(EVT_JIB));
            }
            scheduleRender();
          }
        } catch {}
      }
      // me.html에서 프로필이 바뀌면(localStorage) mine도 즉시 반영
      if (e.key === "me:profile") {
        try {
          const p = JSON.parse(e.newValue);
          if (p) {
            if (!p.id && getMeId()) p.id = getMeId();
            window.dispatchEvent(new CustomEvent("user:updated", { detail: p }));
          }
        } catch {}
      }
    }, { capture: true });

    window.addEventListener("pageshow", scheduleRender);

    window.addEventListener("auth:state", (ev) => {
      const a = !!ev?.detail?.authed;
      if (a) setAuthedFlag(); else clearAuthedFlag();
      idle(() => rehydrateFromLocalStorageIfSessionAuthed());
      scheduleRender();
    });

    // 폴백 '더 보기' 버튼
    const more = $btnMore();
    if (more && !more.__bound) {
      more.__bound = true;
      more.addEventListener("click", () => loadMore());
    }

    bindFeedEvents();
  }

  onReady(async () => {
    ensureHeartCSS();
    initTabs();
    renderTabsOnly();
    bindEvents();

    const flagged = hasAuthedFlag();

    if (flagged) {
      scheduleRender();
      idle(() => rehydrateFromLocalStorageIfSessionAuthed());
      heroIn();
    }

    // server-side session probe
    let me = null; try { me = await (window.auth?.getUser?.().catch(() => null)); } catch {}

    if (me) {
      __ME_ID = String(me?.user?.id ?? me?.id ?? me?.uid ?? me?.sub ?? '') || null;
      __ME_EMAIL = String( 
        me?.user?.email ?? me?.email ?? me?.user?.emails?.[0]?.value ?? ''
      ).trim().toLowerCase() || null;
      // me 페이지에서 저장해둔 최신 프로필(아바타/이름)을 즉시 적용
      try {
        const snap = readProfileCache();
        if (snap) {
          if (!__ME_ID && snap.id) __ME_ID = String(snap.id);
          window.dispatchEvent(new CustomEvent("user:updated", { detail: snap }));
        }
      } catch {}
      try { if (__ME_ID) localStorage.setItem("auth:userns", String(__ME_ID).toLowerCase()); } catch {}
      migrateMineOnlyFlagToNS();
      if (!flagged) setAuthedFlag();
      idle(() => rehydrateFromLocalStorageIfSessionAuthed());
      scheduleRender();
      heroIn();

      // 초기 피드 로드 + 무한 스크롤 시작
      ensureMineFilterUI();
      await loadMore();
      await reconcileDeleteButtons();
      applyMineFilter();
      initInfiniteScroll();
      ensureSocket();
      try {
        const ids = FEED.items.map(x => String(x.id)).filter(Boolean);
        if (ids.length) subscribeItems(ids);
      } catch {}
      } else {
        clearAuthedFlag(); // 서버 판단을 신뢰: stale flag 제거
        const ret = encodeURIComponent(location.href);
        try { window.auth?.markNavigate?.(); } catch {}
        location.replace(`${pageHref('login.html')}?next=${ret}`);
        return;
      }

    try { ensureHeartCSS(); upgradeHeartIconIn(document); } catch {}
    bindTitleToMe();
    try { Avatar.install(document); observeAvatars(); } catch {}

  });

  (function ensureA11y(){
    const root = document;
    const set = (scope=root) => {
      scope.querySelectorAll('.likes-line:not([aria-live])').forEach(el => {
        el.setAttribute('aria-live','polite');
      });
    };
    set(); // 최초 1회
    try { window.__hookA11yLikes = set; } catch {}
  })();

  /* =========================================================
   * 11) POST MODAL (카드 크게 보기)
   * ========================================================= */

  // [ADD] bg hex 정규화
  function pickBgHex(it){
    let s = String(it?.bg || it?.bg_color || it?.bgHex || "").trim();
    if (!s) return null;
    if (/^#([0-9a-f]{3})$/i.test(s)) {
      s = s.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, (_,a,b,c)=>`#${a}${a}${b}${b}${c}${c}`);
    }
    return /^#([0-9a-f]{6})$/i.test(s) ? s.toLowerCase() : null;
  }

  (function PostModalMount(){
    function renderHashtagsFromCaption(root){
      const cap = root?.querySelector('.caption-text');
      const wrap = root?.querySelector('[data-hashtags]');
      if (!cap || !wrap) return;
      const text = cap.textContent || '';
      const tags = Array.from(new Set((text.match(/(^|\s)(#[^\s#]+)/g) || []).map(s => s.trim())));
      wrap.innerHTML = tags.map(t => `<button class="tag" type="button" data-tag="${t.slice(1)}">${t}</button>`).join('');
    }

    let modal, sheet, content, btnClose, btnPrev, btnNext;
    let currentIndex = -1;
    let prevFocus = null;
    let untrapFocus = null;

    function trapFocus(scope){
      function onKey(e){
        if (e.key !== 'Tab') return;
        const focusables = Array.from(
          scope.querySelectorAll('a,button,input,select,textarea,[tabindex]')
        ).filter(el => !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null);
        if (!focusables.length) return;

        const first = focusables[0];
        const last  = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      scope.addEventListener('keydown', onKey);
      return () => scope.removeEventListener('keydown', onKey);
    }

    function inject(){
      if ($("#post-modal")) return;
      const wrap = document.createElement("div");
      wrap.id = "post-modal";
      wrap.className = "post-modal post-modal--split";
      wrap.hidden = true;
      wrap.innerHTML = `
        <div class="pm-sheet" role="dialog" aria-modal="true" aria-labelledby="pm-title">
          <header class="pm-head">
            <h3 id="pm-title" class="pm-title">Post</h3>
            <div class="pm-head-actions">
              <button type="button" class="pm-prev" aria-label="이전">‹</button>
              <button type="button" class="pm-next" aria-label="다음">›</button>
              <button type="button" class="pm-close" aria-label="닫기">✕</button>
            </div>
          </header>
          <div class="pm-content"></div>
        </div>`;
      document.body.appendChild(wrap);

      modal    = wrap;
      sheet    = $(".pm-sheet", wrap);
      content  = $(".pm-content", wrap);
      btnClose = $(".pm-close", wrap);
      btnPrev  = $(".pm-prev", wrap);
      btnNext  = $(".pm-next", wrap);

      // 기존 한 줄을 아래로 교체
      wrap.addEventListener("click", (e) => {
        if (!sheet.contains(e.target)) close();
      }, { capture: true }); // ← 캡처 단계에서 받아서 내부 stopPropagation에도 안전
      btnClose.addEventListener("click", close);
      btnPrev.addEventListener("click", () => step(-1));
      btnNext.addEventListener("click", () => step(+1));

      document.addEventListener("keydown", (e) => {
        if (modal.hidden) return;
        if (e.key === "Escape")      close();
        if (e.key === "ArrowLeft")   step(-1);
        if (e.key === "ArrowRight")  step(+1);
      });

      bindInsideEvents();
    }

    function bindInsideEvents(){
      // 모달 내부: 라벨 이동 / 좋아요만 처리 (투표는 POLL.mount가 바인딩)
      sheet.addEventListener("click", async (e) => {
        // 라벨 버튼 → 라벨 페이지로
        const labelBtn = e.target.closest?.(".label-tag");
        if (labelBtn) {
          e.preventDefault();
          e.stopPropagation();
          const lb = labelBtn.dataset.label || '';
          if (lb) {
            window.auth?.markNavigate?.();
            try {
              if (window.store?.setSelected) window.store.setSelected(lb);
              else sessionStorage.setItem(SELECTED_KEY, lb);
            } catch { try { sessionStorage.setItem(SELECTED_KEY, lb); } catch {} }
            location.assign(`${pageHref('labelmine.html')}?label=${encodeURIComponent(lb)}`);
          }
          return;
        }

        // 포스트 좋아요
        const likeBtn = e.target.closest?.(".btn-like");
        if (likeBtn) {
          const art = e.target.closest?.(".feed-card");
          if (art) toggleLike(art);
          return;
        }
      });
    }

    function ensureDeleteButtonFor(item) {
    const head = sheet?.querySelector?.('.pm-head-actions');
    if (!head) return;

    // 이미 버튼이 있으면 정리
    let btnDel = head.querySelector('.pm-delete');

    const mount = () => {
      if (!btnDel) {
        btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'pm-delete';
        btnDel.setAttribute('aria-label','삭제');
        btnDel.textContent = 'Delete';
        head.insertBefore(btnDel, btnClose || null);

        // 클릭 → 확인 → 낙관적 제거 → 서버 삭제 → 브로드캐스트
        if (!btnDel.__bound) btnDel.addEventListener('click', async () => {
          btnDel.__bound = true;
          const id = String(item.id);
          const ns = nsOf(item);
          const ok = confirm('이 게시물을 삭제할까요? 이 작업은 되돌릴 수 없습니다.');
          if (!ok) return;

          // 낙관적: 모달 닫고 카드 제거
          close();
          removeItemEverywhere(id);

          try {
            await deleteItemById(id, ns);
            try {
              __bcFeed?.postMessage({ kind: FEED_EVENT_KIND, payload: { type: "item:removed", data: { id } } });
            } catch {}
          } catch {
            alert('삭제에 실패했습니다. 새로고침 후 다시 시도해 주세요.');
          }
        });
      }
    };

    // 소유자 판단 → 버튼 노출/제거
    if (isMine(item)) {
      mount();
    } else {
      // 로컬 정보가 없을 수 있으니 1회 보강 후 재평가
      ensureAuthorInfo(item).then((it) => {
        if (isMine(it)) mount();
        else btnDel?.remove();
      });
    }
  }

    // NEW — 모달 2열 마크업(댓글 제거, 투표 추가)
    function modalSplitHTML(item){
      const liked = !!item.liked;
      const likes = Number(item.likes || 0);

      const rawLabel  = String(item.label || '').trim();
      const safeLabel = (item.label || '').replace(/[^\w-]+/g, '');

      // 내 글이면 me.html에서 저장한 최신 프로필 스냅샷을 우선 사용
      const profSnap = readProfileCache();
      const minePost = isMine(item);
      const userIdForDom =
        pickUserId(item) ||
        (minePost && (profSnap?.id || getMeId())) ||
        '';

      const name = (minePost && profSnap?.displayName)
        ? profSnap.displayName
        : (item?.user?.displayName || item?.user?.name || 'member');

      const avatarSrc = (minePost && profSnap?.avatarUrl)
        ? profSnap.avatarUrl
        : Avatar.fromUserObject(item?.user);
      const avatar = Avatar.resolve(avatarSrc, name);
      return `
      <article class="feed-card pm-split" data-id="${item.id}" data-ns="${nsOf(item)}">
        <div class="pm-layout">
          <div class="pm-left">
            <div class="media">
              <img src="${blobURL(item)}" alt="${safeLabel || 'item'}" />
            </div>
          </div>

          <aside class="pm-right">
            <header class="pm-right-head">
              <div class="account" data-user-id="${esc(userIdForDom)}">
                <img class="avatar" src="${avatar}" alt="${name}" />
                <div>
                  <div class="name">${name}</div>
                </div>
              </div>
              <button class="btn-more" type="button" aria-label="더 보기">•••</button>
            </header>

            <div class="pm-thread">
              <section class="pm-caption">
                <div class="caption-text" data-caption></div>
              </section>

              <!-- 투표 영역 -->
              <section class="pm-vote" data-for-id="${esc(item.id)}">
                <!-- mount 시 버튼/카운트가 채워짐 -->
              </section>
            </div>

            <div class="sticky-foot">
              <div class="actions">
                <button class="btn-like" type="button" aria-pressed="${liked}" aria-label="좋아요">
                  <span class="ico ico-heart" aria-hidden="true"></span>
                </button>
              </div>
              <div class="foot-meta">
                <div class="likes-line"><span class="likes-count">${fmtInt(likes)}</span> ${likeWordOf(likes)}</div>
                <div class="date-line">${fmtDate(item.created_at)}</div>
              </div>
            </div>
          </aside>
        </div>
      </article>`;
    }

    // 상세에서 caption을 보강해서 주입
    async function ensureCaptionLoaded(item, art) {
      const capEl = art?.querySelector('[data-caption]');
      if (!capEl || !item) return;

      if (typeof item.caption === 'string' && item.caption.trim()) {
        capEl.textContent = item.caption.trim();
        renderHashtagsFromCaption(art);
        return;
      }

      try {
        const ns = nsOf(item);
        let r, j = {};

        // ✅ 1순위: /api/items/:id
        r = await api(`/api/items/${encodeURIComponent(item.id)}?ns=${encodeURIComponent(ns)}`,
                      { credentials:'include', cache:'no-store' });
        j = await r.json().catch(() => ({}));

        // 폴백: /api/gallery/:id  (서버에 있을 수도 있으니 최후에만 시도)
        if (!r.ok) {
          r = await api(`/api/gallery/${encodeURIComponent(item.id)}?ns=${encodeURIComponent(ns)}`,
                        { credentials:'include', cache:'no-store' });
          j = await r.json().catch(() => ({}));
        }

        const pickText = (o) => {
          if (!o || typeof o !== 'object') return '';
          for (const k of ['caption','text','desc','description','message']) {
            const v = o[k]; if (typeof v === 'string' && v.trim()) return v.trim();
          }
          return '';
        };

        const txt = pickText(j) || pickText(j.item) || pickText(j.data) || '';
        if (txt) {
          item.caption = txt;
          capEl.textContent = txt;
          renderHashtagsFromCaption(art);
        }
      } catch {}
    }

    function renderAt(idx){
      const it = FEED.items[idx];
      if (!it) return;

      // 1) Heart HOTFIX STATE(낙관적 최신) 우선 반영
      try {
        const id = String(it.id);
        const st = (window.__HEART_STATE && window.__HEART_STATE.get(id)) || null;
        if (st) {
          if (typeof st.liked === "boolean") it.liked = st.liked;
          if (typeof st.likes === "number")  it.likes = st.likes;
        }
      } catch {}

      // 2) LikeIntent 캐시(영속)에 의한 보정
      try {
        const rec = (typeof window.getLikeIntent === "function") ? window.getLikeIntent(String(it.id)) : null;
        if (rec) {
          if (typeof rec.liked === "boolean") it.liked = rec.liked;
          if (typeof rec.likes === "number")  it.likes = rec.likes;
        }
      } catch {}
      
      currentIndex = idx;

      content.innerHTML = `<div class="pm-card">${modalSplitHTML(it)}</div>`;
      try { renderCountFromStore(it.id, content); } catch {}
      try { window.__hookA11yLikes?.(content); } catch {}
      try { BG.apply([it]); } catch {}
      const hex = pickBgHex(it);
      if (hex) {
        const card = content.querySelector(".feed-card");
        card?.style?.setProperty("--bg", hex);
        const pane = content.querySelector(".pm-left .media");
        if (pane) pane.style.background = hex;
      }

      const art = content.querySelector(".feed-card");
      try { window.__hookA11yLikes?.(art); } catch {}

      try { upgradeHeartIconIn(art); Avatar.install(art); } catch {}
      // 내 글이면 캐시로 강제 동기화(이름/아바타/데이터-id)
      try {
        const prof = readProfileCache();
        if (prof && isMine(it)) {
          const acc = art.querySelector('.pm-right .account');
          if (acc) {
            if (!acc.dataset.userId && prof.id) acc.dataset.userId = String(prof.id);
            const nameEl = acc.querySelector('.name');
            if (nameEl && prof.displayName) nameEl.textContent = prof.displayName;
            const img = acc.querySelector('.avatar');
            if (img) Avatar.wire(img, prof.avatarUrl, prof.displayName || img.alt || 'member');
          }
        }
      } catch {}

      // 캡션 주입
      const cap = art.querySelector('[data-caption]');
      if (cap) cap.textContent = String(
        it.caption ?? it.text ?? it.desc ?? it.description ?? it.message ?? ''
      );
      renderHashtagsFromCaption(art);

      // 없으면 상세 호출로 보강
      ensureCaptionLoaded(it, art);

      // 이미지 eager
      const img = content.querySelector(".pm-left .media img");
      if (img) { img.loading = "eager"; img.decoding = "sync"; }

      // 제목 업데이트
      const ttl = document.getElementById("pm-title");
      if (ttl) ttl.textContent = `#${(it.label||'').replace(/[^\w-]+/g,'')} · ${fmtDate(it.created_at)}`;

      // 양 끝 버튼 상태
      btnPrev.disabled = (idx <= 0);
      btnNext.disabled = (idx >= FEED.items.length - 1 && FEED.end);

      // 투표 mount
      const voteSec = art.querySelector('.pm-vote');
      if (voteSec) { POLL.mount(voteSec, it); }

      try { fixModalHeartPointerCapture(art); } catch {}

      ensureDeleteButtonFor(it);
    }

    async function step(delta){
      let next = currentIndex + delta;
      if (next >= FEED.items.length && !FEED.end) {
        await loadMore();
      }
      next = Math.max(0, Math.min(next, FEED.items.length - 1));
      renderAt(next);
    }

    function openById(id){
      const idx = FEED.idxById.get(String(id));
      if (typeof idx === "number") {
        openAt(idx);
      } else {
        const found = FEED.items.findIndex(x => String(x.id) === String(id));
        if (found >= 0) openAt(found);
      }
    }

    function openAt(idx){
      if (!modal) inject();
      const it = FEED.items[idx];
      if (it?.id) subscribeItems([String(it.id)]);
      renderAt(idx);
      prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      modal.hidden = false;
      document.documentElement.style.overflow = "hidden";
      untrapFocus?.(); // 안전 해제
      untrapFocus = trapFocus(sheet);
      setTimeout(() => sheet.focus?.(), 0);
    }

    // [PATCH #1-C] 모달 닫기 직전 DOM 스냅샷을 FEED/LikeCache에 즉시 반영
    function close(){
      if (!modal) return;

      // 1) 닫기 직전 스냅샷(좋아요 상태 동기화)
      try {
        const art = content?.querySelector?.('.feed-card[data-id]');
        if (art) {
          const id = String(art.getAttribute('data-id') || '');
          if (id) {
            // (참고) ns는 여기서 직사용하지 않음. store.js는 id 기준으로 저장/동기화.
            const btn = art.querySelector('.btn-like');
            const liked =
              !!(btn && (btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('is-liked')));

            // 카운트 읽기: .likes-count(모달) 우선, 없으면 [data-like-count](그리드) 사용
            let likes = 0;
            const elCount = art.querySelector('.likes-count') || art.querySelector('[data-like-count]');
            if (elCount) {
              likes = elCount.classList?.contains?.('likes-count')
                ? Number(String(elCount.textContent || '0').replace(/[^\d]/g, '')) || 0
                : Number(elCount.getAttribute('data-count') || elCount.dataset?.count || 0) || 0;
            }
            // 음수 방지
            likes = Math.max(0, likes);

            // FEED 메모리 & UI 즉시 반영
            try { setFeedMemoryLike(id, liked, likes); } catch {}
            try { updateLikeUIEverywhere(id, liked, likes); } catch {}

            // ★ 단일 소스: store.js에 스냅샷 기록 (LikeCache 제거)
            // setLikeIntent(id, liked, likes) 가 있으면 의도/카운트를 함께 저장
            try { window.setLikeIntent?.(id, liked, likes); } catch {}
          }
        }
      } catch {}

      // 2) 실제로 닫기
      untrapFocus?.(); // 포커스 트랩 해제
      untrapFocus = null;

      modal.hidden = true;
      document.documentElement.style.overflow = "";
      currentIndex = -1;
      content.innerHTML = "";

      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch {}
      }
      prevFocus = null;
    }

    window.openPostModalById = openById;
  })();

  /* =========================================================
   * 12) BROADCAST CHANNEL (aud:sync:<ns>)
   * ========================================================= */
  try {
    const __NS = (typeof getNS === "function" ? getNS() : (window.__STORE_NS || "default"));
    const __K_LABEL = LABEL_SYNC_KEY;
    const __K_JIB   = JIB_SYNC_KEY;
    const __bc = new BroadcastChannel(`aud:sync:${__NS}`);
    __bcFeed = __bc;
    __bc.addEventListener("message", (e) => {
      const m = e && e.data; if (!m || !m.kind) return;

      if (m.kind === __K_LABEL && m.payload && Array.isArray(m.payload.arr)) {
        if (window.store?.clear && window.store?.add) {
          window.store.clear();
          for (const lb of m.payload.arr) window.store.add(lb);
        } else {
          sessionStorage.setItem(REG_KEY, JSON.stringify(m.payload.arr));
          window.dispatchEvent(new Event(EVT_LABEL));
        }
        try { (window.mineRenderAll?.() || window.scheduleRender?.()); } catch {}
      }

      if (m.kind === __K_JIB && m.payload) {
        if (m.payload.type === "set" && Array.isArray(m.payload.arr)) {
          if (window.jib?.clear && window.jib?.add) {
            window.jib.clear();
            for (const k of m.payload.arr) window.jib.add(k);
          } else {
            sessionStorage.setItem(JIB_KEY, JSON.stringify(m.payload.arr));
            window.dispatchEvent(new Event(EVT_JIB));
          }
          try { (window.mineRenderAll?.() || window.scheduleRender?.()); } catch {}
        } else if (m.payload.type === "select") {
          if (window.jib?.setSelected) window.jib.setSelected(m.payload.k ?? null);
        }
      }

      if (m.kind === FEED_EVENT_KIND && m.payload) {
        const { type, data } = m.payload;
        if (type === "item:like")   try { window.applyItemLikeEvent?.(data); } catch {}
        if (data?.id || data?.itemId) { try { renderCountFromStore(String(data.id || data.itemId)); } catch {} }
        if (type === "vote:update") {
          try {
            const id = String(data?.id || data?.itemId || "");
            if (!id) return;
            const counts = data?.counts || data?.totals || data?.votes || data?.items || data?.data || {};
            const my = data?.my ?? data?.mine ?? data?.choice ?? null;
            POLL.updateEverywhere(id, counts, my);
          } catch {}
        }

        if (type === "item:removed") {
          try {
            const id = String(data?.id || data?.itemId || "");
            if (!id) return;
            removeItemEverywhere(id);
            const openCard = document.querySelector('#post-modal .feed-card[data-id]');
            if (openCard && String(openCard.getAttribute('data-id')) === id) {
              document.querySelector('.pm-close')?.click();
            }
          } catch {}
        }

      }
    });
  } catch {
    __bcFeed = null; // Safari 프라이빗 등: storage 폴백만 사용
  }

  // === FEED → other tabs (me.html) 알림 브릿지: 내가 한 행동을 방송 ===
  function bcNotifySelf(type, data){
    // BroadcastChannel
    try { __bcFeed?.postMessage({ kind: FEED_EVENT_KIND, payload: { type, data } }); } catch {}

    // localStorage 폴백 (다른 탭의 storage 이벤트가 받음)
    try {
      const ns = (typeof getNS === 'function' ? getNS() : 'default');
      localStorage.setItem(`notify:self:${ns}`, JSON.stringify({ type, data, t: Date.now() }));
    } catch {}
  }


  /* =========================================================
   * 13) LOGOUT BUTTON (robust, idempotent)
   * ========================================================= */
  

  

  /* =========================================================
  * 14) TITLE → me 페이지 이동(인증 가드 포함)
  * ========================================================= */
  function bindTitleToMe() {
    // 1) 우선 A안: a#title-link가 있으면 그걸 사용
    let el = document.getElementById('title-link');
    // 2) 혹시 HTML을 아직 안 바꿨다면 B안(.title 자체 바인딩)으로 폴백
    if (!el) el = document.querySelector('.mine .hero .title');

    if (!el || el.__bound) return;
    el.__bound = true;

    const go = (ev) => {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      try { window.auth?.markNavigate?.(); } catch {}

      const authed = (typeof window.auth?.isAuthed === 'function')
        ? !!window.auth.isAuthed()
        : (sessionStorage.getItem('auth:flag') === '1');

      const target = './me.html';
      if (authed) {
        location.assign(target);
      } else {
        const next = encodeURIComponent(target);
        location.assign(`${pageHref('login.html')}?next=${next}`);
      }
    };

    // A안: <a>인 경우 기본 동작을 가로채 인증 가드 적용
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') go(e);
    });

    // B안 폴백(엘리먼트가 <h1>일 수도 있으니 접근성 보강)
    if (el.tagName !== 'A') {
      el.setAttribute('role', 'link');
      el.tabIndex = 0;
      el.style.cursor = 'pointer';
    }
  }

  // === [ADD] Insights bridge for mine.js (reuse me.js cache; fallback to self-compute) ===
  (() => {
    const $ = (s, r=document) => r.querySelector(s);
    const INSIGHTS_TTL = 10 * 60 * 1000; // 10분
    const OPTIONS = ["thump","miro","whee","track","echo","portal"];
    const getNS = (window.getNS) ? window.getNS : () => {
      try { return (localStorage.getItem("auth:userns") || "default").trim().toLowerCase(); }
      catch { return "default"; }
    };
    const api = (path, opt) => (window.auth?.apiFetch ? window.auth.apiFetch(path, opt) : fetch(path, opt || {}));
    const KEY = (ns) => `insights:${ns}`;

    function readCache(ns, ttl=INSIGHTS_TTL){
      try{
        const raw = sessionStorage.getItem(KEY(ns)); if(!raw) return null;
        const obj = JSON.parse(raw); if(!obj?.t) return null;
        if (ttl>0 && (Date.now()-obj.t)>ttl) return null;
        return obj;
      }catch{ return null; }
    }
    function writeCache(ns, data){ try{ sessionStorage.setItem(KEY(ns), JSON.stringify({ ...data, t: Date.now() })); }catch{} }
    function invalidate(ns){ try{ sessionStorage.removeItem(KEY(ns)); }catch{} }

    const emptyCounts = () => OPTIONS.reduce((a,k)=>(a[k]=0,a),{});
    function normalizeCounts(raw){
      if (!raw) return emptyCounts();
      if (Array.isArray(raw)) {
        const out = emptyCounts();
        raw.forEach(r => {
          const k = String(r.label||"").trim(); const n = Number(r.count||0);
          if (OPTIONS.includes(k)) out[k] = Math.max(0, n);
        });
        return out;
      }
      if (typeof raw === "object") {
        const out = emptyCounts();
        for (const k of OPTIONS) out[k] = Math.max(0, Number(raw[k]||0));
        return out;
      }
      return emptyCounts();
    }
    const winnersOf = (counts)=>{
      const entries = Object.entries(counts||{});
      if (!entries.length) return [];
      const max = Math.max(...entries.map(([,n])=>Number(n||0)));
      return entries.filter(([,n])=>Number(n||0)===max).map(([k])=>k);
    };
    function pickVotesFrom(obj){
      const c = normalizeCounts(obj?.votes ?? obj?.counts ?? obj?.totals ?? obj?.items ?? obj?.data ?? obj);
      const total = Number(obj?.total ?? Object.values(c).reduce((s,n)=>s+Number(n||0),0));
      return { counts: c, total };
    }
    async function fetchVotesSafe(itemId, ns){
      const pid = encodeURIComponent(itemId); const nsq = `ns=${encodeURIComponent(ns)}`;
      // 1) /items/:id/votes
      try { const r = await api(`/api/items/${pid}/votes?${nsq}`, { credentials:"include", cache:"no-store" });
        const j = await r?.json()?.catch?.(()=>({})); if (r?.ok) return pickVotesFrom(j?.data ?? j?.item ?? j ?? {});
      } catch {}
      // 2) /votes?item=
      try { const r = await api(`/api/votes?item=${pid}&${nsq}`, { credentials:"include", cache:"no-store" });
        const j = await r?.json()?.catch?.(()=>({})); if (r?.ok) return pickVotesFrom(j?.data ?? j?.item ?? j ?? {});
      } catch {}
      // 3) /items/:id
      try { const r = await api(`/api/items/${pid}?${nsq}`, { credentials:"include", cache:"no-store" });
        const j = await r?.json()?.catch?.(()=>({})); if (r?.ok) return pickVotesFrom(j?.data ?? j?.item ?? j ?? {});
      } catch {}
      return { counts: emptyCounts(), total: 0 };
    }
    async function fetchAllMyItems(maxPages=20, pageSize=60){
      const out=[]; let cursor=null; const ns=getNS();
      for (let p=0; p<maxPages; p++){
      const qs=new URLSearchParams({ limit: String(Math.min(pageSize,60)), ns });
      if (cursor) {
        qs.set("after",  String(cursor)); // 신 라우터
        qs.set("cursor", String(cursor)); // 폴백
      }
        const r = await api(`/api/gallery/public?${qs.toString()}`, { credentials:"include" });
        if (!r || !r.ok) break;
        const j = await r.json().catch(()=>({})); const items = Array.isArray(j?.items) ? j.items : [];
        items.forEach(it => {
          const mine = it?.mine === true || String(it?.ns||"").toLowerCase()===ns || String(it?.owner?.ns||"").toLowerCase()===ns;
          if (mine) out.push(it);
        });
        cursor = j?.nextCursor || null; if(!cursor || items.length===0) break;
      }
      return out;
    }
    async function computeInsights(){
      const ns = getNS();
      const myItems = await fetchAllMyItems();
      const posts = myItems.length;
      const votes = await (async ()=>{
        // 피드 응답에 집계가 같이 실릴 수도 있음(있으면 재활용)
        const list = [];
        for (const it of myItems){
          if (it?.votes || it?.counts || it?.totals) {
            const v = pickVotesFrom(it);
            list.push({ label: String(it.label||"").trim(), total: v.total, tops: winnersOf(v.counts) });
          } else {
            const v = await fetchVotesSafe(it.id, it.ns || ns);
            list.push({ label: String(it.label||"").trim(), total: v.total, tops: winnersOf(v.counts) });
          }
        }
        return list;
      })();
      const participated = votes.filter(v => v && v.total>0).length;
      let matched=0; for (const v of votes){ if(!v||v.total===0) continue; if (v.label && v.tops.includes(v.label)) matched++; }
      const rate = participated>0 ? Math.round((matched/participated)*100) : 0;
      return { posts, participated, matched, rate };
    }
    async function getInsights(opts={}){
      const ns=getNS(); const cached=readCache(ns, opts.maxAge ?? INSIGHTS_TTL);
      if (cached) return cached;
      const data = await computeInsights(); writeCache(ns, data); return data;
    }
    // 공개 API
    window.mineInsights = { get: getInsights, _compute: computeInsights };

    // 1) me.js가 방송해 준 값 즉시 반영
    window.addEventListener("insights:ready", (e)=>{
      const d = e?.detail; if (!d || (d.ns||"").toLowerCase()!==getNS()) return;
      writeCache(getNS(), { posts:d.posts, participated:d.participated, matched:d.matched, rate:d.rate });
    });

    // 2) 투표 실시간 업데이트 수신 시 캐시 무효화(소켓/BC 경유)
    //    - server.js는 'vote:update'를 socket.io로 쏨
    try {
      if (!window.__insightsVoteHooked) {
        const s = ensureSocket();
        if (s) {
          s.on("vote:update", ()=> invalidate(getNS()));
          window.__insightsVoteHooked = true;
        }
      }
    } catch {}
    // 3) NS가 바뀌면 캐시 분리 — store.js가 이벤트를 쏴줌
    window.addEventListener("store:ns-changed", ()=>{/* no-op: 키가 ns별이라 충돌 없음 */});
  })();

})();
