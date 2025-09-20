// me.js — Web 마이페이지 (no inline styles; CSS-only rendering)
// 2025-09-14 rebuilt from scratch (server-first counts; safe fallbacks)

(() => {
  "use strict";

  /* ─────────────────────────────────────────────────────────────────────────────
   * 0) Utilities & Globals
   * ──────────────────────────────────────────────────────────────────────────── */

  const qty = (n, one, many = one + "s") => `${Number(n||0)} ${Number(n||0) === 1 ? one : many}`;

  // === Watched NS (로그인 없이도 '내 글'로 간주할 네임스페이스 목록) ==================
  const WATCHED_NS_KEY = "me:watched-ns";   // 로컬 퍼시스턴스 키
  function readWatchedNS() {
    try { const arr = JSON.parse(localStorage.getItem(WATCHED_NS_KEY) || "[]"); return Array.isArray(arr) ? arr.map(s=>String(s).toLowerCase()) : []; }
    catch { return []; }
  }
  function writeWatchedNS(list) {
    try { localStorage.setItem(WATCHED_NS_KEY, JSON.stringify(Array.from(new Set((list||[]).map(s=>String(s).toLowerCase()))))); } catch {}
  }
  function addWatchedNS(ns) { const cur = readWatchedNS(); cur.push(String(ns||"").toLowerCase()); writeWatchedNS(cur); }
  function isOwnerWatched(ownerNS) {
    const v = String(ownerNS||"").toLowerCase();
    if (!v) return false;
    const mine = (typeof window.__STORE_NS === "string" ? window.__STORE_NS.toLowerCase() : "default");
    if (v === mine) return true;
    return readWatchedNS().includes(v);
  }

  // 프로필 캐시/최근 로그인 정보에서 NS 추정 → 최초 1회 자동 추가(게스트 대비)
  (function seedWatchedNSFromProfile(){
    try {
      const cached = (function() {
        const keys = ["me:profile", `me:profile:${(localStorage.getItem("auth:userns")||"default").toLowerCase()}`];
        for (const k of keys) { const v = sessionStorage.getItem(k) || localStorage.getItem(k); if (v) return JSON.parse(v); }
        return null;
      })();
      const ns = (localStorage.getItem("auth:userns") || "").trim().toLowerCase();
      if (ns) addWatchedNS(ns);
      if (cached?.ns) addWatchedNS(String(cached.ns).toLowerCase());
    } catch {}
  })();

  function isMineOrWatchedFromPayload(data) {
    // mine.js에서 보내주는 payload에는 보통 owner.ns 또는 ns가 들어있음
    const ownerNS = String(data?.owner?.ns || data?.ns || "").toLowerCase();
    // mine:true 플래그 최우선
    if (data?.mine === true) return true;
    // NS 일치/감시 여부 체크
    return isOwnerWatched(ownerNS);
  }

  const $  = (sel, root = document) => root.querySelector(sel);

  const fmtInt = (n) => {
    try { return new Intl.NumberFormat("en-US").format(Number(n ?? 0)); }
    catch { return String(n ?? 0); }
  };

  const getNS = () => {
    try { return (localStorage.getItem("auth:userns") || "default").trim().toLowerCase(); }
    catch { return "default"; }
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // External knobs / keys (backward compatible)
  const REG_KEY        = "collectedLabels";
  const JIB_KEY        = "jib:collected";
  const LABEL_SYNC_KEY = (window.LABEL_SYNC_KEY || "label:sync");
  const JIB_SYNC_KEY   = (window.JIB_SYNC_KEY   || "jib:sync");
  const EVT_LABEL      = (window.LABEL_COLLECTED_EVT || "label:collected-changed");
  const EVT_JIB        = (window.JIB_COLLECTED_EVT   || "jib:collection-changed");

  let __LIKES_PREV = {};  
  let __VOTES_PREV = {}; 

  // === Backlog Queue (알림 버퍼) ==========================================
  // OFF 상태에서 들어온 알림은 큐에 쌓아두었다가 ON으로 전환 시 재생한다.
  const QUEUE_MAX = 200;                         // 큐 최대 길이
  const QUEUE_TTL = 1000 * 60 * 60 * 24 * 2;     // 48시간 보관
  const QUEUE_FLUSH_LIMIT = 50;                  // ON 전환 시 최대 재생 개수

  const QUEUE_KEY = () => `notify:queue:${getNS()}`;

  function readQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY()) || "[]"); }
    catch { return []; }
  }
  function writeQueue(arr) {
    try { localStorage.setItem(QUEUE_KEY(), JSON.stringify(arr)); } catch {}
  }
  function enqueueNotice(n) {
    const now = Date.now();
    const q = readQueue().filter(it => (now - (it.ts || 0)) < QUEUE_TTL);
    q.push({ text: n.text || "", sub: n.sub || "", tag: n.tag || "", data: n.data || null, ts: n.ts || now });
    while (q.length > QUEUE_MAX) q.shift();
    writeQueue(q);
  }

  // 재생 시 pushNotice가 다시 큐에 넣지 않도록 방지 플래그
  let __replayMode = false;

  async function flushQueuedNotices(limit = QUEUE_FLUSH_LIMIT) {
    const q = readQueue();
    if (!q.length) return 0;

    const cut = Math.max(0, q.length - limit); // 오래된 것들은 남겨두고 최근 limit개만 재생
    const recent = q.slice(cut);
    writeQueue(q.slice(0, cut));               // 남겨둘 구간만 저장(초과분 삭제)

    if (cut > 0) {
      // 오래된 알림이 많을 땐 요약 1건 먼저
      __replayMode = true;
      pushNotice(`Skipped ${cut} older notifications`, `Replaying the most recent ${recent.length}.`, { tag: `replay:summary:${Date.now()}`, replay: true });
      __replayMode = false;
    }

    for (const it of recent) {
      __replayMode = true;
      // tag 중복 억제를 위해 ts를 덧붙여 충돌 최소화
      const tagWithTs = it.tag ? `${it.tag}@${it.ts}` : `replay:${it.ts}`;
      pushNotice(it.text, it.sub, { tag: tagWithTs, data: it.data, replay: true });
      __replayMode = false;
      // 너무 몰아서 뜨지 않게 약간의 쉬는 시간(필요 시 조정/삭제)
      await new Promise(r => setTimeout(r, 30));
    }

    return recent.length;
  }



  // Auth helpers (no-op safe)
  const ensureCSRF = window.auth?.ensureCSRF || (async () => {});
  const withCSRF   = window.auth?.withCSRF   || (async (opt) => opt);

  // In-memory state
  let MY_UID   = null;
  let ME_STATE = { displayName: "member", email: "", avatarUrl: "" };

  // JSON & list normalization
  const parseJSON = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };
  const normalizeId = (v) => String(v ?? "").trim().toLowerCase();
  const dedupList   = (arr) => Array.isArray(arr) ? [...new Set(arr.map(normalizeId).filter(Boolean))] : [];
  const uniqueCount = (arr) => dedupList(arr).length;

  /**
   * Any → string[] (IDs). Accepts common shapes & coerces into de-duplicated IDs.
   * @param {any} x
   * @param {'label'|'jib'=} kind
   */
  function coerceList(x, kind) {
    if (!x) return null;

    // 1) JSON text
    if (typeof x === "string") {
      const p = parseJSON(x, null);
      if (p) return coerceList(p, kind);
    }

    // 2) Array of anything (object gets best-effort id-ish pick)
    if (Array.isArray(x)) {
      const pick = (o) => (o && typeof o === "object")
        ? (o.id ?? o.label ?? o.name ?? o.key ?? o.value ?? o.uid ?? o.slug ?? o._id)
        : o;
      return dedupList(x.map(pick));
    }

    // 3) Set / Map
    if (x instanceof Set) return dedupList([...x]);
    if (x instanceof Map) return dedupList([...x.keys()]);

    // 4) Object candidates
    if (typeof x === "object") {
      const candidates =
        kind === "jib"
          ? ["jibs", "jibIds", "ids", "items", "list", "collection", "data"]
          : kind === "label"
            ? ["labels", "labelIds", "ids", "items", "list", "collection", "data"]
            : ["labels", "jibs", "ids", "items", "list", "collection", "data"];

      for (const k of candidates) {
        if (Array.isArray(x[k])) return coerceList(x[k], kind);
        if (x[k] && typeof x[k] === "object") {
          const nested = coerceList(x[k], kind);
          if (Array.isArray(nested)) return nested;
        }
      }

      // Flag-shape { idA:true, idB:1, ... }
      const vals = Object.values(x);
      if (vals.length && vals.every(v => typeof v === "boolean" || typeof v === "number")) {
        return dedupList(Object.keys(x).filter(Boolean));
      }

      // Nested `data`
      if (x.data) {
        const d = coerceList(x.data, kind);
        if (Array.isArray(d)) return d;
      }
    }

    return null;
  }

  /* ─────────────────────────────────────────────────────────────────────────────
   * 1) Collections: store/session readers & stabilizers
   * ──────────────────────────────────────────────────────────────────────────── */
  function readRawLists() {
    let storeLabels = null, storeJibs = null;

    // Primary: flexible getters
    try {
      const s = window.store?.getCollected?.();
      const l = coerceList(s, "label");
      const j = coerceList(s, "jib");
      if (Array.isArray(l)) storeLabels = l;
      if (Array.isArray(j)) storeJibs   = j;
    } catch {}

    // Secondary: explicit store paths
    try { if (!storeLabels) storeLabels = coerceList(window.store?.getLabels?.() ?? window.store?.labels ?? window.store?.state?.labels, "label"); } catch {}
    try { if (!storeJibs)   storeJibs   = coerceList(window.jib  ?.getCollected?.() ?? window.jib?.getJibs?.() ?? window.jib?.jibs ?? window.jib?.state?.jibs, "jib"); } catch {}

    // Session/local fallback
    const sessLabels = dedupList(parseJSON(sessionStorage.getItem(REG_KEY), []) || []);
    const sessJibs   = dedupList(parseJSON(sessionStorage.getItem(JIB_KEY), []) || []);
    let   localLabels = []; let localJibs = [];
    try { localLabels = dedupList(parseJSON(localStorage.getItem(REG_KEY), []) || []); } catch {}
    try { localJibs   = dedupList(parseJSON(localStorage.getItem(JIB_KEY), []) || []); } catch {}

    return {
      storeLabels: Array.isArray(storeLabels) ? storeLabels : null,
      storeJibs:   Array.isArray(storeJibs)   ? storeJibs   : null,
      sessLabels:  (sessLabels.length ? sessLabels : localLabels),
      sessJibs:    (sessJibs.length   ? sessJibs   : localJibs),
    };
  }

  function readLabels() {
    const { storeLabels, sessLabels } = readRawLists();
    if (Array.isArray(storeLabels) && storeLabels.length) return dedupList(storeLabels);
    if (sessLabels.length) return dedupList(sessLabels);
    return dedupList(storeLabels || []);
  }

  function readJibs() {
    const { storeJibs, sessJibs } = readRawLists();
    if (Array.isArray(storeJibs) && storeJibs.length) return dedupList(storeJibs);
    if (sessJibs.length) return dedupList(sessJibs);
    return dedupList(storeJibs || []);
  }

  /** Wait until store shape stabilizes or timeout, then pick robust counts. */
  async function settleInitialCounts(maxWaitMs = 1800, tickMs = 50) {
    const t0 = performance.now();
    let prev = "", stable = 0;

    while (performance.now() - t0 < maxWaitMs) {
      const { storeLabels, storeJibs, sessLabels, sessJibs } = readRawLists();
      const storeShapeReady = Array.isArray(storeLabels) || Array.isArray(storeJibs);
      const storeNonEmpty   = (Array.isArray(storeLabels) && storeLabels.length) || (Array.isArray(storeJibs) && storeJibs.length);

      const L = storeNonEmpty
        ? uniqueCount(storeLabels || [])
        : (sessLabels.length ? uniqueCount(sessLabels) : uniqueCount(storeLabels || []));

      const J = storeNonEmpty
        ? uniqueCount(storeJibs || [])
        : (sessJibs.length ? uniqueCount(sessJibs) : uniqueCount(storeJibs || []));

      const sig = `${storeShapeReady ? "S" : "X"}|${storeNonEmpty ? "N" : "0"}|${L}|${J}`;
      if (sig === prev) { if (++stable >= 2) return { labels: L, jibs: J }; } else { stable = 0; prev = sig; }

      await sleep(tickMs);
    }

    // Final fallback
    const { storeLabels, storeJibs, sessLabels, sessJibs } = readRawLists();
    const pick = (sArr, fArr) => (Array.isArray(sArr) && sArr.length) ? sArr : (fArr || sArr || []);
    return {
      labels: uniqueCount(pick(storeLabels, sessLabels)),
      jibs:   uniqueCount(pick(storeJibs,   sessJibs)),
    };
  }

  /** Clear session collections when user or namespace changes. */
  function purgeCollectionsIfUserChanged(prevProfile, meProfileNow) {
    const ns = getNS();
    const lastUIDKey = `me:last-uid:${ns}`;
    const lastNSKey  = `me:last-ns`;

    const lastUIDSeen = sessionStorage.getItem(lastUIDKey) || (prevProfile?.id ? String(prevProfile.id) : null);
    const lastNSSeen  = sessionStorage.getItem(lastNSKey);
    const currUID     = meProfileNow?.user?.id ?? meProfileNow?.id ?? meProfileNow?.uid ?? meProfileNow?.sub ?? null;

    const sessLabels = dedupList(parseJSON(sessionStorage.getItem(REG_KEY), []) || []);
    const sessJibs   = dedupList(parseJSON(sessionStorage.getItem(JIB_KEY), []) || []);
    const hasSessPayload = (sessLabels.length > 0) || (sessJibs.length > 0);

    const nsChanged   = !!lastNSSeen && lastNSSeen !== ns;
    const userChanged = !!currUID && !!lastUIDSeen && String(lastUIDSeen) !== String(currUID);
    const firstRunWithResidue = !!currUID && !lastUIDSeen && hasSessPayload;

    if (nsChanged || userChanged || firstRunWithResidue) {
      try { sessionStorage.removeItem(REG_KEY); } catch {}
      try { sessionStorage.removeItem(JIB_KEY); } catch {}
    }

    if (currUID != null) { try { sessionStorage.setItem(lastUIDKey, String(currUID)); } catch {} }
    try { sessionStorage.setItem(lastNSKey, ns); } catch {}
  }

  /** When store becomes ready with values, snapshot into session once (to prevent residue). */
  function syncSessionFromStoreIfReady() {
    const { storeLabels, storeJibs } = readRawLists();
    const ready = (Array.isArray(storeLabels) && storeLabels.length) || (Array.isArray(storeJibs) && storeJibs.length);
    if (!ready) return;
    try { if (Array.isArray(storeLabels)) sessionStorage.setItem(REG_KEY, JSON.stringify(dedupList(storeLabels))); } catch {}
    try { if (Array.isArray(storeJibs))   sessionStorage.setItem(JIB_KEY,  JSON.stringify(dedupList(storeJibs))); } catch {}
  }

  /* ─────────────────────────────────────────────────────────────────────────────
   * 2) Profile cache & avatar rendering
   * ──────────────────────────────────────────────────────────────────────────── */
  const PROFILE_KEY_PREFIX = "me:profile";

  const profileKeys = () => {
    const ns  = getNS();
    const uid = MY_UID || "anon";
    return [
      `${PROFILE_KEY_PREFIX}:${ns}:${uid}`,
      `${PROFILE_KEY_PREFIX}:${ns}`,
      PROFILE_KEY_PREFIX, // legacy
    ];
  };

  function writeProfileCache(detail) {
    const ns  = getNS();
    const uid = detail?.id ?? MY_UID ?? "anon";
    const payload = JSON.stringify({ ns, ...(detail || {}) });
    const kUID = `${PROFILE_KEY_PREFIX}:${ns}:${uid}`;
    const kNS  = `${PROFILE_KEY_PREFIX}:${ns}`;
    try { sessionStorage.setItem(kUID, payload); } catch {}
    try { localStorage.setItem(kUID,  payload); } catch {}
    try { sessionStorage.setItem(kNS,  payload); } catch {}
    try { localStorage.setItem(kNS,   payload); } catch {}
  }

  function readProfileCache() {
    let latest = null;
    const consider = (obj) => {
      if (!obj) return;
      const rv = Number(obj.rev ?? obj.updatedAt ?? obj.updated_at ?? obj.ts ?? 0);
      if (!latest || rv > Number(latest.rev ?? latest.updatedAt ?? latest.updated_at ?? latest.ts ?? 0)) {
        latest = obj;
      }
    };
    for (const k of profileKeys()) {
      try { consider(parseJSON(sessionStorage.getItem(k), null)); } catch {}
      try { consider(parseJSON(localStorage.getItem(k),  null)); } catch {}
    }
    return latest;
  }

  const initials = (name = "member") => {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    const init  = (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
    return (init || name[0] || "U").toUpperCase().slice(0, 2);
  };

  const hueIndexFrom = (s = "") => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    const hue = Math.abs(h) % 360;
    return Math.round(hue / 15) % 24; // 24 buckets
  };

  function ensureAvatarEl() {
    let el = $("#me-avatar");
    if (!el) return null;
    if (el.tagName === "IMG") {
      // Convert <img> to <div> avatar container (CSS-only)
      const div = document.createElement("div");
      div.id = el.id;
      div.className = `${el.className || ""} avatar`;
      el.replaceWith(div);
      el = div;
    } else {
      el.classList.add("avatar");
    }
    return el;
  }

  function paintAvatar(nameOrEmail) {
    const name = String(nameOrEmail || "member").trim() || "member";
    const el   = ensureAvatarEl(); if (!el) return;
    const init = initials(name);
    const idx  = hueIndexFrom(name);
    // remove old hue classes
    for (const c of Array.from(el.classList)) if (/^h\d+$/.test(c)) el.classList.remove(c);
    el.classList.add(`h${idx}`);
    el.setAttribute("data-initials", init);
    el.setAttribute("aria-label", `avatar ${init}`);
    el.classList.remove("has-img", "url-mode");
  }

  function ensureAvatarImg(container, url, opts = {}) {
    let img = container.querySelector("img.avatar-img");
    if (!img) {
      img = document.createElement("img");
      img.className = "avatar-img";
      img.alt = "";
      img.decoding = "async";
      img.loading = "lazy";
      img.fetchPriority = "low";
      img.referrerPolicy = "no-referrer";
      container.appendChild(img);
    }
    let nextSrc = url;
    try {
      const u = new URL(url, location.origin);
      if (opts && opts.version != null) {
        u.searchParams.set("v", String(opts.version));
      } else if (!u.searchParams.has("v")) {
        const cached = readProfileCache() || {};
        const rev = Number(cached.rev ?? cached.updatedAt ?? cached.updated_at ?? cached.ts ?? 0) || Date.now();
        u.searchParams.set("v", String(rev));
      }
      nextSrc = u.toString();
    } catch {}
    if (img.src !== nextSrc) img.src = nextSrc;
    container.classList.add("has-img", "url-mode");
    container.removeAttribute("data-initials");
  }

  function clearAvatarImg() {
    const el = ensureAvatarEl(); if (!el) return;
    el.querySelector("img.avatar-img")?.remove();
    el.classList.remove("has-img", "url-mode");
  }

  async function broadcastMyProfile(patch = {}) {
    let me = null;
    try { me = await window.auth?.getUser?.().catch(() => null); } catch {}
    const id = me?.user?.id ?? me?.id ?? me?.uid ?? me?.sub ?? null;
    const detail = {
      id,
      displayName: ME_STATE.displayName || me?.user?.displayName || me?.user?.name || "member",
      avatarUrl:   ME_STATE.avatarUrl || "",
      ...patch,
      rev: Date.now(),
    };
    writeProfileCache(detail);
    try { window.dispatchEvent(new CustomEvent("user:updated", { detail })); } catch {}
  }

  /* ─────────────────────────────────────────────────────────────────────────────
   * 3) API helpers & rendering
   * ──────────────────────────────────────────────────────────────────────────── */
  const hasAuthedFlag = () => sessionStorage.getItem("auth:flag") === "1";
  const serverAuthed  = () => !!(window.auth?.isAuthed && window.auth.isAuthed());
  const sessionAuthed = () => hasAuthedFlag() || serverAuthed();

  async function api(path, opt = {}) {
    const fn = window.auth?.apiFetch || fetch;
    try {
      const res = await fn(path, opt);
      if (res && res.status === 401) {
        try { sessionStorage.removeItem("auth:flag"); } catch {}
        try { localStorage.removeItem("auth:flag"); } catch {}
        return null;
      }
      return res;
    } catch {
      return null;
    }
  }

  async function fetchMe() {
    const r = await api("/auth/me", { credentials: "include", cache: "no-store" });
    if (!r || !r.ok) return null;
    try { return await r.json(); } catch { return null; }
  }

  function renderProfile({ name, displayName, email, avatarUrl }) {
    const nm = name || displayName || "member";
    ME_STATE.displayName = nm;
    ME_STATE.email = email || "";
    ME_STATE.avatarUrl = avatarUrl || "";

    const nameEl  = $("#me-name");  if (nameEl)  nameEl.textContent  = nm;
    const emailEl = $("#me-email"); if (emailEl) emailEl.textContent = email || "";

    if (avatarUrl) {
      const el = ensureAvatarEl();
      if (el) ensureAvatarImg(el, avatarUrl);
    } else {
      clearAvatarImg();
      paintAvatar(nm || email || "member");
    }
  }

  function renderQuick({ labels = 0, jibs = 0, posts = 0 /* authed unused */ }) {
    $("#k-labels") && ($("#k-labels").textContent = fmtInt(labels));
    $("#k-jibs")   && ($("#k-jibs").textContent   = fmtInt(jibs));
    $("#k-posts")  && ($("#k-posts").textContent  = fmtInt(posts));
  }

  window.addEventListener("user:updated", (ev) => {
    const d = ev?.detail; if (!d) return;
    renderProfile({
      displayName: d.displayName ?? ME_STATE.displayName,
      email:       ME_STATE.email,
      avatarUrl:   d.avatarUrl   ?? ME_STATE.avatarUrl,
    });
  });

  /* ─────────────────────────────────────────────────────────────────────────────
   * 3.5) Server-first quick counts (labels & jibbitz)
   * ──────────────────────────────────────────────────────────────────────────── */
  const OPTIONS = ["thump", "miro", "whee", "track", "echo", "portal"]; // valid label set

  const arrify = (x, kind) => {
    const a = coerceList(x, kind);
    return Array.isArray(a) ? a : [];
  };

  async function fetchCountsFromServer(ns) {
    const res = await api(`/api/state?ns=${encodeURIComponent(ns)}`, { method: "GET", credentials: "include", cache: "no-store" });
    if (!res || !res.ok) return null;
    const j  = await res.json().catch(() => ({}));
    const st = j?.state || j || {};
    const labels = arrify(st.labels, "label").filter((k) => OPTIONS.includes(k)).length || 0;
    const jibs   = arrify(st.jibs?.collected, "jib").length || 0;
    return { labels, jibs, source: "server" };
  }

  async function getQuickCounts() {
    const ns = getNS();
    if (sessionAuthed()) {
      const s = await fetchCountsFromServer(ns).catch(() => null);
      if (s && (s.labels || s.jibs || s.source)) return s;
    }
    // fallback to local/store (stabilized)
    try { return await settleInitialCounts(1000, 40); }
    catch { return { labels: readLabels().length, jibs: readJibs().length }; }
  }

  let __countsBusy = false;
  async function refreshQuickCounts() {
    if (__countsBusy) return;
    __countsBusy = true;
    try {
      const postsNow = Number($("#k-posts")?.textContent?.replace(/[^0-9]/g, "") || 0);
      const counts = await getQuickCounts();
      renderQuick({ labels: counts.labels || 0, jibs: counts.jibs || 0, posts: postsNow, authed: sessionAuthed() });
    } finally { __countsBusy = false; }
  }
  window.__meCountsRefresh = refreshQuickCounts;

  /* ─────────────────────────────────────────────────────────────────────────────
   * 4) Notifications (native + in-page)
   * ──────────────────────────────────────────────────────────────────────────── */
  const NOTIFY_KEY = "me:notify-enabled";
  const NATIVE_KEY = "me:notify-native";

  let socket      = null;
  let MY_ITEM_IDS = new Set();
  let __PREV_ITEM_IDS = new Set();

  const isNotifyOn    = () => { try { return localStorage.getItem(NOTIFY_KEY) === "1"; } catch { return false; } };
  const setNotifyOn   = (on) => {
    try { localStorage.setItem(NOTIFY_KEY, on ? "1" : "0"); } catch {}
    const tgl = $("#notify-toggle");
    if (tgl) tgl.checked = !!on;
  };
  const wantsNative   = () => { try { return localStorage.getItem(NATIVE_KEY) === "1"; } catch { return false; } };
  const setWantsNative = (v) => { try { localStorage.setItem(NATIVE_KEY, v ? "1" : "0"); } catch {} };
  const hasNativeAPI  = () => typeof window.Notification === "function";

  async function ensureNativePermission() {
    if (!hasNativeAPI()) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied")  return false;
    try { const p = await Notification.requestPermission(); return p === "granted"; } catch { return false; }
  }

  function maybeNativeNotify(title, body, { tag, data } = {}) {
    if (!isNotifyOn() || !hasNativeAPI() || !wantsNative() || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;

    const icon = (() => {
      try {
        const cached = readProfileCache();
        if (cached?.avatarUrl) return cached.avatarUrl;
      } catch {}
      const link = document.querySelector('link[rel="icon"],link[rel="shortcut icon"]');
      return link?.href || "/favicon.ico";
    })();

    const n = new Notification(title, { body, tag, icon, badge: icon, data });
    n.onclick = () => { try { window.focus(); } catch {} try { n.close(); } catch {} };
  }

  const __recentNotify = new Map(); // tag -> timestamp(ms)
  const __RECENT_TTL = 4000; // 4초 내 동일 tag 차단 (원하면 2~5초로 조절)
  function pushNotice(text, sub = "", opt = {}) {
    if (!__replayMode && !isNotifyOn()) {
      try { enqueueNotice({ text, sub, tag: opt?.tag || "", data: opt?.data || null }); } catch {}
      return;
    }

    // 중복 억제
    const tag = opt?.tag || "";
    if (tag) {
      const now = Date.now();
      const last = __recentNotify.get(tag) || 0;
      if (now - last < __RECENT_TTL) return;
      __recentNotify.set(tag, now);
      for (const [k, t] of __recentNotify) if (now - t > __RECENT_TTL * 4) __recentNotify.delete(k);
    }

    const ul = $("#notify-list");
    const empty = $("#notify-empty");
    if (!ul) return;

    // ✅ DOM 안전 조립 (중복 제거/불용변수 제거)
    const li = document.createElement("li");
    li.className = "notice";

    const row = document.createElement("div");
    row.className = "row between";

    const strong = document.createElement("strong");
    strong.textContent = String(text || "");

    const timeEl = document.createElement("time");
    timeEl.className = "time";
    const nowDate = new Date();
    timeEl.dateTime = nowDate.toISOString();
    timeEl.textContent =
      `${String(nowDate.getHours()).padStart(2,"0")}:${String(nowDate.getMinutes()).padStart(2,"0")}`;

    row.append(strong, timeEl);
    li.append(row);

    if (sub) {
      const p = document.createElement("p");
      p.className = "sub";
      p.textContent = String(sub || "");
      li.append(p);
    }

    ul.prepend(li);

    if (empty) empty.style.display = "none";
    while (ul.children.length > 20) ul.removeChild(ul.lastChild);

    try { maybeNativeNotify(text, sub, { tag: opt?.tag, data: opt?.data }); } catch {}
  }

  function setupNotifyUI() {
    // 1) 로그인 여부 무관 기본 ON (게스트 포함) —— 토글 유무와 상관없이 먼저 실행
    setNotifyOn(true);
    setWantsNative(true);
    // 권한 요청 실패해도 in-page 알림은 계속 동작하므로 await 불필요
    ensureNativePermission();
    ensureSocket();
    if (isNotifyOn()) { flushQueuedNotices().catch(() => {}); }
    // 2) 토글 UI가 있는 경우에만 동기화/이벤트 바인딩
    const tgl = $("#notify-toggle");
    if (!tgl) return;

    // 중복 바인딩 가드
    if (tgl.__bound) {
      // 외부에서 setNotifyOn(true) 했으니, 표시만 맞춰주기
      tgl.checked = isNotifyOn();
      return;
    }
    tgl.__bound = true;

    // 현재 설정 반영
    tgl.checked = isNotifyOn();

    // 변경 이벤트
    tgl.addEventListener("change", async () => {
      setNotifyOn(tgl.checked);
      if (tgl.checked) {
        setWantsNative(true);
        await ensureNativePermission();  // 허용되면 네이티브 알림, 거부돼도 in-page 유지
        ensureSocket();
      } else {
        setWantsNative(false);
        // 필요시 소켓 연결을 유지할지/끊을지 정책적으로 결정.
        // "토글은 네이티브 알림만 제어하고 in-page는 항상 ON"이라면 여기서 소켓 끊지 않습니다.
      }
      if (tgl.checked) await flushQueuedNotices();
    });
  }

  function ensureSocket() {
    // 1) 소켓 인스턴스 확보 (있으면 재사용, 없으면 생성)
    if (socket && socket.connected !== undefined) {
      // 이미 리스너가 붙어 있다면 그대로 반환
    } else if (window.sock && window.sock.connected !== undefined) {
      socket = window.sock;
    } else {
      if (!window.io) return null;
      socket = window.io({ path: "/socket.io" });
      try { window.sock = socket; } catch {}
    }

    // 2) 리스너가 중복으로 붙지 않도록 가드
    if (!socket.__meHandlersAttached) {
      Object.defineProperty(socket, "__meHandlersAttached", { value: true, enumerable: false });

      socket.on("connect", () => {
        const watch = (localStorage.getItem("me:watched-ns") || "[]");
        const payload = { items: [...MY_ITEM_IDS], ns: getNS() };
        try { payload.watch = JSON.parse(watch); } catch {}
        socket.emit("subscribe", payload);
      });

      // ── 알림 리스너들
      socket.on("item:like", (p) => {
        if (!isNotifyOn() || !p || !p.id) return;
        const mineOrWatched = isMineOrWatchedFromPayload(p);
        if (!(MY_ITEM_IDS.has(String(p.id)) || mineOrWatched)) return;
        if (MY_UID && String(p.by) === String(MY_UID)) return;
        if (p.liked) {
          const likes = Number(p.likes || 0);
          pushNotice("My post got liked", `Total ${qty(likes, "like")}`, { tag: `like:${p.id}`, data: { id: String(p.id) } });
        }
      });

      socket.on("comment:like", (p) => {
        if (!isNotifyOn() || !p || !p.id) return;
        const mineOrWatched = isMineOrWatchedFromPayload(p);
        if (!(MY_ITEM_IDS.has(String(p.id)) || mineOrWatched)) return;
        if (MY_UID && String(p.by) === String(MY_UID)) return;
        if (p.liked) {
          const likes = Number(p.likes || 0);
          pushNotice("A comment on my post got a like",
            `Comment ${p.cid} · Total ${qty(likes, "like")}`,
            { tag: `comment-like:${p.id}:${p.cid}`, data: { id: String(p.id), cid: String(p.cid || "") } }
          );
        }
      });

      socket.on("vote:update", (p) => {
        if (!isNotifyOn() || !p || !p.id) return;
        const mineOrWatched = isMineOrWatchedFromPayload(p);
        if (!(MY_ITEM_IDS.has(String(p.id)) || mineOrWatched)) return;

        try {
          const entries = Object.entries(p.counts || {});
          const max = Math.max(...entries.map(([, n]) => Number(n || 0)), 0);
          const tops = entries.filter(([, n]) => Number(n || 0) === max && max > 0).map(([k]) => k);
          const total = entries.reduce((s, [, n]) => s + Number(n || 0), 0);
          const label = tops.length ? tops.join(", ") : "—";
          pushNotice("My post votes have been updated",
            `Most votes: ${label} · Total ${qty(total, "vote")}`,
            { tag: `vote:${p.id}`, data: { id: String(p.id) } }
          );
        } catch {
          pushNotice("My post votes have been updated", "", { tag: `vote:${p?.id||""}`, data: { id: String(p?.id||"") } });
        }
      });
    }

    return socket;
  }

  function updateMyItemRooms(ids) {
    __PREV_ITEM_IDS = MY_ITEM_IDS;
    MY_ITEM_IDS = new Set((ids || []).map(String));
    if (socket && socket.connected) {
      // 서버가 교체를 지원하면:
      socket.emit("subscribe", { items: [...MY_ITEM_IDS], replace: true });
      // 교체 미지원이면 아래 주석 해제해서 diff 적용
      // const toUnsub = [...__PREV_ITEM_IDS].filter(id => !MY_ITEM_IDS.has(id));
      // const toSub   = [...MY_ITEM_IDS].filter(id => !__PREV_ITEM_IDS.has(id));
      // if (toUnsub.length) socket.emit("unsubscribe", { items: toUnsub });
      // if (toSub.length)   socket.emit("subscribe",   { items: toSub   });
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────────
   * 5) Vote insights (KPI)
   * ──────────────────────────────────────────────────────────────────────────── */
  const emptyCounts = () => OPTIONS.reduce((a, k) => (a[k] = 0, a), {});

  function normalizeCounts(raw) {
    if (!raw) return emptyCounts();

    if (Array.isArray(raw)) {
      const out = emptyCounts();
      raw.forEach((r) => {
        const k = String(r.label || "").trim();
        const n = Number(r.count || 0);
        if (OPTIONS.includes(k)) out[k] = Math.max(0, n);
      });
      return out;
    }

    if (typeof raw === "object") {
      const out = emptyCounts();
      for (const k of OPTIONS) out[k] = Math.max(0, Number(raw[k] || 0));
      return out;
    }

    return emptyCounts();
  }

  function pickVotesFrom(obj) {
    if (!obj || typeof obj !== "object") return { counts: emptyCounts(), my: null, total: 0 };
    const c = normalizeCounts(obj.votes || obj.counts || obj.totals || obj.items || obj.data || obj);
    const my = obj.my ?? obj.mine ?? obj.choice ?? obj.selected ?? null;
    const sum = Object.values(c).reduce((s, n) => s + Number(n || 0), 0);
    const total = Number.isFinite(Number(obj.total)) ? Number(obj.total) : sum;
    return { counts: c, my: (OPTIONS.includes(my) ? my : null), total };
  }

  async function fetchVotesSafe(itemId, ns) {
    const pid = encodeURIComponent(itemId);
    const nsq = `ns=${encodeURIComponent(ns)}`;

    // Try item votes endpoints
    try {
      const r = await api(`/api/items/${pid}/votes?${nsq}`, { credentials: "include", cache: "no-store" });
      if (r?.ok) {
        const j = await r.json().catch(() => ({}));
        const picked = pickVotesFrom(j) || pickVotesFrom(j.item) || pickVotesFrom(j.data);
        if (picked?.counts) return picked;
      }
    } catch {}

    try {
      const r = await api(`/api/votes?item=${pid}&${nsq}`, { credentials: "include", cache: "no-store" });
      if (r?.ok) {
        const j = await r.json().catch(() => ({}));
        const picked = pickVotesFrom(j) || pickVotesFrom(j?.item) || pickVotesFrom(j?.data);
        if (picked?.counts) return picked;
      }
    } catch {}

    try {
      const r = await api(`/api/items/${pid}?${nsq}`, { credentials: "include", cache: "no-store" });
      if (r?.ok) {
        const j = await r.json().catch(() => ({}));
        const picked = pickVotesFrom(j) || pickVotesFrom(j?.item) || pickVotesFrom(j?.data);
        if (picked?.counts) return picked;
      }
    } catch {}

    return { counts: emptyCounts(), my: null, total: 0 };
  }

  async function fetchAllMyItems(maxPages = 20, pageSize = 60) {
    if (!sessionAuthed()) return [];
    const out = [];
    let cursor = null;
    const myns = getNS();

    for (let p = 0; p < maxPages; p++) {
      const qs = new URLSearchParams({ limit: String(Math.min(pageSize, 60)), ns: myns });
      if (cursor) { qs.set("after", String(cursor)); qs.set("cursor", String(cursor)); }
      const r = await api(`/api/gallery/public?${qs.toString()}`, { credentials: "include", cache: "no-store" });
      if (!r || !r.ok) break;

      const j = await r.json().catch(() => ({}));
      const items = Array.isArray(j?.items) ? j.items : [];
      items.forEach((it) => {
        const nsMatch   = String(it?.ns || "").toLowerCase() === myns;
        const mineFlag  = (it?.mine === true);
        const ownerMatch= (MY_UID != null) && (String(it?.user?.id || "").toLowerCase() === String(MY_UID).toLowerCase());
        if (nsMatch || mineFlag || ownerMatch) out.push(it);
      });

      cursor = j?.nextCursor || null;
      if (!cursor || items.length === 0) break;
    }

    return out;
  }

  async function mapLimit(arr, limit, worker) {
    const ret = new Array(arr.length);
    let idx = 0, running = 0;
    return await new Promise((resolve) => {
      const pump = () => {
        while (running < limit && idx < arr.length) {
          const i = idx++; running++;
          Promise.resolve(worker(arr[i], i))
            .then((v) => { ret[i] = v; })
            .catch(() => { ret[i] = null; })
            .finally(() => { running--; (idx >= arr.length && running === 0) ? resolve(ret) : pump(); });
        }
      };
      pump();
    });
  }

  const winnersOf = (counts) => {
    const entries = Object.entries(counts || {});
    if (!entries.length) return [];
    const max = Math.max(...entries.map(([, n]) => Number(n || 0)), 0);
    if (max <= 0) return [];
    return entries.filter(([, n]) => Number(n || 0) === max).map(([k]) => k);
  };

  function setRateBar(rate = 0) {
    const el = $("#m-rate-bar"); if (!el) return;
    const clamped = Math.max(0, Math.min(100, Math.round(rate)));

    if (el.tagName === "PROGRESS") {
      el.max = 100; el.value = clamped;
      el.setAttribute("aria-valuemin", "0");
      el.setAttribute("aria-valuemax", "100");
      el.setAttribute("aria-valuenow", String(clamped));
    } else {
      const step = Math.round(clamped / 5) * 5;
      for (const c of Array.from(el.classList)) if (/^p(100|[0-9]{1,2})$/.test(c)) el.classList.remove(c);
      el.classList.add(`p${step}`);
      el.setAttribute("data-pct", String(step));
    }
  }

  async function computeAndRenderInsights() {
    const elPosts = $("#m-posts");
    const elPart  = $("#m-participated");
    const elRate  = $("#m-rate");
    const elRateDetail = $("#m-rate-detail");

    const myItems = await fetchAllMyItems();
    const postCount = myItems.length;
    updateMyItemRooms(myItems.map((it) => it?.id).filter(Boolean));

    const votes = await mapLimit(myItems, 6, async (it) => {
      if (it?.votes || it?.counts || it?.totals) {
        const vRaw = pickVotesFrom(it);
        return { label: String(it.label || "").trim(), total: Number(vRaw.total || 0), tops: winnersOf(vRaw.counts) };
      }
      const v = await fetchVotesSafe(it.id, it.ns || getNS());
      const total = Number(v.total || Object.values(v.counts || {}).reduce((s, n) => s + Number(n || 0), 0));
      const tops  = winnersOf(v.counts);
      return { label: String(it.label || "").trim(), total, tops };
    });

    const participated = votes.filter((v) => v && v.total > 0).length;
    let matched = 0;
    for (const v of votes) {
      if (!v || v.total === 0) continue;
      if (v.label && v.tops.includes(v.label)) matched++;
    }
    const rate = (participated > 0) ? Math.round((matched / participated) * 100) : 0;

    try {
      const insights = { posts: postCount, participated, matched, rate };
      sessionStorage.setItem(`insights:${getNS()}`, JSON.stringify({ ...insights, t: Date.now() }));
      window.dispatchEvent(new CustomEvent("insights:ready", { detail: { ns: getNS(), ...insights } }));
    } catch {}

    elPosts && (elPosts.textContent = fmtInt(postCount));
    elPart  && (elPart.textContent  = fmtInt(participated));
    elRate  && (elRate.textContent  = `${rate}%`);
    setRateBar(rate);
    elRateDetail && (elRateDetail.textContent = `(${fmtInt(matched)} / ${fmtInt(participated)})`);
    $("#k-posts") && ($("#k-posts").textContent = fmtInt(postCount));
  }

  /* ─────────────────────────────────────────────────────────────────────────────
   * 6) Profile & Password update
   * ──────────────────────────────────────────────────────────────────────────── */
  async function updateDisplayName(displayName) {
    const name = String(displayName || "").trim();
    if (!name) return { ok: false, msg: "Display name is required." };

    const jsonBody = JSON.stringify({ displayName: name, name });
    const asJson = (url, method) => ({ url, method, headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: jsonBody });
    const asForm = (url, method, extra = {}) => {
      const usp = new URLSearchParams({ displayName: name, name, ...extra });
      return { url, method, headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Accept": "application/json" }, body: usp.toString() };
    };

    await ensureCSRF();
    const variants = [
      asJson("/auth/me",          "PATCH"),
      asJson("/api/users/me",     "PUT"),
      asJson("/auth/profile",     "POST"),
      asForm("/auth/me",          "POST", { _method: "PATCH" }),
      asForm("/api/users/me",     "POST", { _method: "PUT" }),
      asForm("/auth/profile",     "POST"),
    ];

    for (const v of variants) {
      const opt = await withCSRF({ method: v.method, credentials: "include", headers: v.headers, body: v.body });
      const res = await api(v.url, opt);
      if (!res) continue;
      if (res.ok) return { ok: true };
      if (res.status === 400 || res.status === 422) {
        let err = "Invalid input.";
        try { const j = await res.json(); err = j?.message || j?.error || err; } catch {}
        return { ok: false, msg: err };
      }
    }
    return { ok: false, msg: "The server couldn’t update your display name." };
  }

  async function updatePassword(currentPassword, newPassword) {
    const pw  = String(newPassword || "");
    const cur = String(currentPassword || "");
    if (!pw || pw.length < 8) return { ok: false, msg: "Your new password must be at least 8 characters long." };
    if (!cur) return { ok: false, msg: "Please enter your current password." };

    await ensureCSRF();
    const payloads = [
      { url: "/auth/password",         method: "POST",  body: { currentPassword: cur, newPassword: pw } },
      { url: "/auth/change-password",  method: "POST",  body: { currentPassword: cur, newPassword: pw } },
      { url: "/api/users/me/password", method: "PUT",   body: { currentPassword: cur, newPassword: pw } },
      { url: "/auth/me",               method: "PATCH", body: { currentPassword: cur, password: pw } },
    ];

    for (const p of payloads) {
      try {
        const r = await api(p.url, await withCSRF({
          method: p.method, credentials: "include",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify(p.body),
        }));
        if (r?.ok) return { ok: true };
      } catch {}
    }
    return { ok: false, msg: "Password change request was rejected." };
  }

  /* ─────────────────────────────────────────────────────────────────────────────
   * 7) Edit Modal (CSS-only structure)
   * ──────────────────────────────────────────────────────────────────────────── */
  function ensureEditModal() {
    let wrap = $("#edit-modal");
    if (wrap) return wrap;

    wrap = document.createElement("div");
    wrap.id = "edit-modal";
    wrap.className = "modal";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "edit-title");
    wrap.innerHTML = `
      <button type="button" class="overlay" aria-label="Close"></button>
      <div class="sheet" role="document" aria-labelledby="edit-title">
        <h2 id="edit-title" class="title">Edit profile</h2>

        <div class="toolbar">
          <button type="button" class="btn" id="btn-change-avatar">Change profile</button>
        </div>

        <form id="edit-form" novalidate>
          <div class="form-row">
            <label for="f-displayName">Name</label>
            <input id="f-displayName" name="displayName" autocomplete="nickname" required maxlength="40" />
            <p class="hint">This is the name that will appear on the screen, not the email address.</p>
          </div>

          <fieldset class="fieldset">
            <legend>Change password</legend>
            <div class="form-row">
              <label for="f-current">Current password</label>
              <input id="f-current" name="currentPassword" type="password" autocomplete="current-password" />
            </div>
            <div class="form-row">
              <label for="f-new">New password</label>
              <input id="f-new" name="newPassword" type="password" autocomplete="new-password" minlength="8" />
            </div>
            <div class="form-row">
              <label for="f-new2">Confirm new password</label>
              <input id="f-new2" name="newPassword2" type="password" autocomplete="new-password" minlength="8" />
            </div>
            <p class="hint">If you do not wish to change your password, leave it blank.</p>
          </fieldset>

          <div class="actions">
            <button type="submit" class="btn btn-primary" id="btn-save">Save</button>
            <button type="button" class="btn" id="btn-cancel">Cancel</button>
          </div>

          <p class="msg" id="edit-msg" aria-live="polite"></p>
        </form>
      </div>
    `.trim();

    document.body.appendChild(wrap);

    wrap.querySelector(".overlay")?.addEventListener("click", closeEditModal);
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") closeEditModal(); });

    wrap.querySelector("#edit-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msgEl = wrap.querySelector("#edit-msg");
      const dnEl  = wrap.querySelector("#f-displayName");
      const curEl = wrap.querySelector("#f-current");
      const nwEl  = wrap.querySelector("#f-new");
      const nw2El = wrap.querySelector("#f-new2");

      const displayName = (dnEl?.value || "").trim();
      const cur = curEl?.value || "";
      const nw  = nwEl?.value || "";
      const nw2 = nw2El?.value || "";

      if (!displayName) { msgEl.textContent = "Please enter your name."; dnEl?.focus(); return; }
      if (nw || nw2 || cur) {
        if (!cur)          { msgEl.textContent = "Please enter your current password."; curEl?.focus(); return; }
        if (nw.length < 8) { msgEl.textContent = "Your new password must be at least 8 characters long."; nwEl?.focus(); return; }
        if (nw !== nw2)    { msgEl.textContent = "New passwords do not match."; nw2El?.focus(); return; }
      }

      msgEl.textContent = "Submitting…";

      if (displayName !== (ME_STATE.displayName || "")) {
        const r = await updateDisplayName(displayName);
        if (!r.ok) { msgEl.textContent = r.msg || "Failed to change your name."; return; }
      }
      if (nw) {
        const r2 = await updatePassword(cur, nw);
        if (!r2.ok) { msgEl.textContent = r2.msg || "Failed to change your password."; return; }
      }

      ME_STATE.displayName = displayName;
      $("#me-name") && ($("#me-name").textContent = displayName);
      paintAvatar(displayName);
      await broadcastMyProfile({});

      msgEl.textContent = "Saved";
      setTimeout(closeEditModal, 350);
    });

    wrap.querySelector("#btn-change-avatar")?.addEventListener("click", () => {
      try { window.auth?.markNavigate?.(); } catch {}
      openAvatarCropper();
    });
    wrap.querySelector("#btn-cancel")?.addEventListener("click", closeEditModal);

    return wrap;
  }

  function openEditModal() {
    const modal = ensureEditModal();
    const dn = modal.querySelector("#f-displayName");
    if (dn) dn.value = ME_STATE.displayName || ME_STATE.email || "member";
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    setTimeout(() => dn?.focus(), 0);
  }

  function closeEditModal() {
    const modal = $("#edit-modal");
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  /* ─────────────────────────────────────────────────────────────────────────────
   * 8) Avatar Cropper (client-only, no external lib)
   * ──────────────────────────────────────────────────────────────────────────── */
  const AV = {
    img: null, url: null,
    scale: 1, minScale: 1,
    tx: 0, ty: 0, drag: false, sx: 0, sy: 0,
    canvas: null, ctx: null, size: 360, rotate: 0,
  };

  function ensureAvatarCropper() {
    let wrap = $("#avatar-modal");
    if (wrap) return wrap;

    wrap = document.createElement("div");
    wrap.id = "avatar-modal";
    wrap.className = "modal";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "avatar-title");
    wrap.innerHTML = `
      <button type="button" class="overlay" aria-label="Close"></button>
      <div class="sheet" role="document">
        <h2 id="avatar-title" class="title">Change profile</h2>

        <div class="form-row">
          <input id="av-file" type="file" accept="image/*" />
          <p class="hint">Crop</p>
        </div>

        <div class="cropper">
          <canvas id="av-canvas" width="360" height="360" aria-label="Preview crop"></canvas>
        </div>

        <div class="form-row">
          <label for="av-zoom">Zoom in/out</label>
          <input id="av-zoom" type="range" min="1" max="4" step="0.01" value="1" />
        </div>

        <div class="actions">
          <button type="button" class="btn" id="av-rotate">Rotate 90°</button>
          <button type="button" class="btn" id="av-reset">Reset</button>
          <button type="button" class="btn btn-primary" id="av-save">Save</button>
          <button type="button" class="btn" id="av-cancel">Cancel</button>
        </div>

        <p class="msg" id="av-msg" aria-live="polite"></p>
      </div>
    `.trim();

    document.body.appendChild(wrap);

    AV.canvas = wrap.querySelector("#av-canvas");
    AV.ctx    = AV.canvas.getContext("2d", { alpha: false });

    const inp  = wrap.querySelector("#av-file");
    const zoom = wrap.querySelector("#av-zoom");
    const msg  = wrap.querySelector("#av-msg");

    wrap.querySelector(".overlay")?.addEventListener("click", closeAvatarCropper);
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAvatarCropper(); });

    inp?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { msg.textContent = "Please choose an image file."; return; }
      await loadImageFile(f);
      fitImage(true);
      drawCrop();
      msg.textContent = "Drag the image to adjust its position.";
    });

    zoom?.addEventListener("input", () => {
      AV.scale = Math.max(AV.minScale, Number(zoom.value) || 1);
      drawCrop();
    });

    const start = (x, y) => { AV.drag = true; AV.sx = x; AV.sy = y; };
    const move  = (x, y) => { if (!AV.drag) return; AV.tx += (x - AV.sx); AV.ty += (y - AV.sy); AV.sx = x; AV.sy = y; drawCrop(); };
    const end   = () => { AV.drag = false; };

    AV.canvas.addEventListener("pointerdown", (e) => { AV.canvas.setPointerCapture(e.pointerId); start(e.clientX, e.clientY); });
    AV.canvas.addEventListener("pointermove",  (e) => move(e.clientX, e.clientY));
    AV.canvas.addEventListener("pointerup",    end);
    AV.canvas.addEventListener("pointercancel",end);

    AV.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const z = (-e.deltaY || 0) > 0 ? 1.06 : 0.94;
      const next = Math.max(AV.minScale, Math.min(4, AV.scale * z));
      AV.scale = next;
      zoom.value = String(next);
      drawCrop();
    }, { passive: false });

    wrap.querySelector("#av-rotate")?.addEventListener("click", () => {
      AV.rotate = (AV.rotate + 90) % 360;
      fitImage(true);
      drawCrop();
    });

    wrap.querySelector("#av-reset")?.addEventListener("click", () => {
      fitImage(true);
      drawCrop();
      msg.textContent = "Reset.";
    });

    wrap.querySelector("#av-save")?.addEventListener("click", async () => {
      msg.textContent = "Uploading…";
      const blob = await exportCroppedBlob(512);
      const r = await uploadAvatar(blob);
      if (r?.ok) {
        ME_STATE.avatarUrl = r.url || "";
        renderProfile({ displayName: ME_STATE.displayName, email: ME_STATE.email, avatarUrl: r.url });
        await broadcastMyProfile({ avatarUrl: r.url });
        msg.textContent = "Saved.";
        setTimeout(closeAvatarCropper, 350);
      } else {
        msg.textContent = r?.msg || "Upload failed.";
      }
    });

    wrap.querySelector("#av-cancel")?.addEventListener("click", closeAvatarCropper);

    return wrap;
  }

  function openAvatarCropper() {
    const m = ensureAvatarCropper();
    m.classList.add("open");
    m.setAttribute("aria-hidden", "false");
    const file = m.querySelector("#av-file");
    if (file) file.value = "";
    cleanupImage();
    drawBlank();
  }

  function closeAvatarCropper() {
    const m = $("#avatar-modal");
    if (!m) return;
    m.classList.remove("open");
    m.setAttribute("aria-hidden", "true");
    cleanupImage();
  }

  function cleanupImage() {
    if (AV.url) { try { URL.revokeObjectURL(AV.url); } catch {} AV.url = null; }
    AV.img = null;
  }

  function drawBlank() {
    const { ctx, size } = AV;
    ctx.fillStyle = "#E9E9EC";
    ctx.fillRect(0, 0, size, size);
    drawMask();
  }

  async function loadImageFile(file) {
    cleanupImage();
    AV.url = URL.createObjectURL(file);
    try {
      AV.img = await createImageBitmap(file);
    } catch {
      const img = new Image();
      img.decoding = "async";
      img.src = AV.url;
      await img.decode().catch(() => {});
      AV.img = img;
    }
  }

  function fitImage(resetOffset = false) {
    const { img, size } = AV; if (!img) return;
    const rotated = (AV.rotate % 180) !== 0;
    const iw = rotated ? img.height : img.width;
    const ih = rotated ? img.width  : img.height;
    const coverScale = Math.max(size / iw, size / ih);
    AV.minScale = coverScale;
    AV.scale = Math.max(AV.scale || coverScale, coverScale);
    if (resetOffset) { AV.tx = 0; AV.ty = 0; }
    const zoom = $("#av-zoom");
    if (zoom) zoom.value = String(AV.scale);
  }

  function drawMask() {
    const { ctx, size } = AV;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    const r = size * 0.48;
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = 2;
    ctx.arc(size / 2, size / 2, size * 0.48, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawCrop() {
    const { ctx, size, img, scale, tx, ty, rotate } = AV;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#F3F3F6";
    ctx.fillRect(0, 0, size, size);
    if (img) {
      ctx.save();
      ctx.translate(size / 2 + tx, size / 2 + ty);
      ctx.rotate(rotate * Math.PI / 180);
      ctx.scale(scale, scale);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
    }
    drawMask();
  }

  async function exportCroppedBlob(outSize = 512) {
    const { img, scale, tx, ty, rotate, size } = AV;
    if (!img) return null;

    const off = document.createElement("canvas");
    off.width = outSize; off.height = outSize;
    const oc = off.getContext("2d", { alpha: false });

    oc.fillStyle = "#F3F3F6";
    oc.fillRect(0, 0, outSize, outSize);

    const k = outSize / size;
    oc.save();
    oc.translate(outSize / 2 + tx * k, outSize / 2 + ty * k);
    oc.rotate(rotate * Math.PI / 180);
    oc.scale(scale * k, scale * k);
    oc.drawImage(img, -img.width / 2, -img.height / 2);
    oc.restore();

    const tryWebp = await new Promise((res) => { if (off.toBlob) off.toBlob(res, "image/webp", 0.92); else res(null); });
    if (tryWebp) return tryWebp;
    return await new Promise((res) => { if (off.toBlob) off.toBlob(res, "image/png"); else res(null); });
  }

  async function uploadAvatar(blob) {
    if (!blob) return { ok: false, msg: "There’s no image to export." };
    await ensureCSRF();
    const fd = new FormData();
    fd.append("avatar", blob, "avatar.webp");
    const url = "/api/users/me/avatar";
    try {
      const r = await api(url, await withCSRF({ method: "POST", credentials: "include", body: fd }));
      const j = await r?.json?.().catch?.(() => ({}));
      if (!r || !r.ok) return { ok: false, msg: `Upload failed (HTTP ${r?.status || 0})` };
      return { ok: true, url: j.avatarUrl || j.url || j.location || "" };
    } catch {
      return { ok: false, msg: "Network error" };
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────────
   * 9) Reactive resync hooks for late-ready stores
   * ──────────────────────────────────────────────────────────────────────────── */
  const RESYNC_EVENTS = [
    "store:ready","labels:ready","label:ready","collected:ready",
    "jib:ready","jibs:ready","collection:ready",
    "store:changed","labels:changed","jibs:changed",
    "collectedLabels:changed", // EVT_LABEL alias
    "jib:collection-changed",  // EVT_JIB alias
  ];

  RESYNC_EVENTS.forEach((ev) => {
    window.addEventListener(ev, () => {
      setTimeout(() => {
        try {
          const { storeLabels, storeJibs } = readRawLists();
          if (Array.isArray(storeLabels) && storeLabels.length) sessionStorage.setItem(REG_KEY, JSON.stringify(dedupList(storeLabels)));
          if (Array.isArray(storeJibs)   && storeJibs.length)   sessionStorage.setItem(JIB_KEY,  JSON.stringify(dedupList(storeJibs)));
        } catch {}
        refreshQuickCounts();
      }, 0);
    });
  });

  /* ─────────────────────────────────────────────────────────────────────────────
   * 10) Boot
   * ──────────────────────────────────────────────────────────────────────────── */
  async function boot() {
    let me    = { displayName: "member", email: "", avatarUrl: "" };
    let quick = { posts: 0, labels: 0, jibs: 0, authed: false };

    // 0) Warm from cache
    const cached = readProfileCache();
    if (cached) {
      me.displayName = cached.displayName || me.displayName;
      me.email       = cached.email || "";
      me.avatarUrl   = cached.avatarUrl || "";
    }

    // 1) Server /auth/me → cleanse session residues if needed
    const meResp = await fetchMe();
    if (meResp && typeof meResp === "object") {
      purgeCollectionsIfUserChanged(cached, meResp);
      MY_UID = meResp?.user?.id ?? meResp?.id ?? null;
      me = {
        displayName: meResp.displayName || meResp.name || me.displayName,
        email:       meResp.email || me.email,
        avatarUrl:   meResp.avatarUrl || me.avatarUrl,
      };
      quick.authed = true;
    }

    // 2) Initial counts (server-first)
    try {
      const c = await getQuickCounts();
      quick.labels = c.labels || 0;
      quick.jibs   = c.jibs   || 0;
    } catch {
      quick.labels = readLabels().length;
      quick.jibs   = readJibs().length;
    }

    // 3) Render
    renderProfile(me);
    renderQuick(quick);

    try {
      __LIKES_PREV = (window.readLikesMap && window.readLikesMap()) ? window.readLikesMap() : {};
    } catch { __LIKES_PREV = {}; }

    try {
      __VOTES_PREV = (window.readLabelVotes && window.readLabelVotes()) ? window.readLabelVotes() : {};
    } catch { __VOTES_PREV = {}; }

    // 4) snapshot store → session once
    syncSessionFromStoreIfReady();

    // 5) periodic refreshes
    refreshQuickCounts();
    setTimeout(() => { syncSessionFromStoreIfReady(); refreshQuickCounts(); }, 300);
    setTimeout(() => { syncSessionFromStoreIfReady(); refreshQuickCounts(); }, 1500);

    // 6) event subscriptions → refresh counts
    window.addEventListener(EVT_LABEL, refreshQuickCounts);
    window.addEventListener(EVT_JIB,   refreshQuickCounts);

    window.addEventListener("storage", (e) => {
      if (!e?.key) return;

      if (e.key === LABEL_SYNC_KEY || /label:sync/.test(e.key)) refreshQuickCounts();
      if (e.key === JIB_SYNC_KEY   || /jib:sync/.test(e.key))   refreshQuickCounts();
      if (e.key === "auth:userns" || e.key === "auth:flag")     refreshQuickCounts();

      if (e.key.startsWith(PROFILE_KEY_PREFIX) && e.newValue) {
        const parts = e.key.split(":");
        const nsFromKey = parts[2] || "default";
        if (nsFromKey === getNS()) {
          try { renderProfile(parseJSON(e.newValue, {})); } catch {}
        }
      }
      // 원격(다른 사람이 한) 액션 알림 폴백
      if (e.key.startsWith("notify:remote:") && e.newValue) {
        try {
          const p = parseJSON(e.newValue, null);
          const t = String(p?.type || "");
          const d = p?.data || {};
          if (!isMineOrWatchedFromPayload(d)) return; // ★ Watched NS 기반 필터
          if (t === "item:like" && d?.liked) {
            const _l = Number(d.likes || 0);
            pushNotice("My post got liked", `Total ${_l} ${_l === 1 ? "like" : "likes"}`, { tag:`like:${d.id}`, data:{ id:String(d.id||"") } });
          }
          if (t === "vote:update") {
            try {
              const entries = Object.entries(d.counts || {});
              const max = Math.max(...entries.map(([, n]) => Number(n||0)), 0);
              const tops = entries.filter(([, n]) => Number(n||0) === max && max > 0).map(([k])=>k);
              const total = entries.reduce((s, [, n]) => s + Number(n||0), 0);
              const label = tops.length ? tops.join(", ") : "—";
              pushNotice("My post votes have been updated", `Top: ${label} · Total ${total} ${total === 1 ? "vote" : "votes"}`, { tag:`vote:${d.id}`, data:{ id:String(d.id||"") } });
            } catch {
              pushNotice("My post votes have been updated", "", { tag:`vote:${d?.id||""}`, data:{ id:String(d?.id||"") } });
            }
          }
        } catch {}
      }

    }, { capture: true });

    window.addEventListener("auth:state", refreshQuickCounts);
    window.addEventListener("store:ns-changed", refreshQuickCounts);

    // === store.js 변화 이벤트 → 알림 ===

    // 좋아요 스냅샷 맵 변경
    window.addEventListener("itemLikes:changed", (ev) => {
      try {
        const cur = (ev?.detail?.map && typeof ev.detail.map === "object") ? ev.detail.map : (window.readLikesMap?.() || {});
        const changedIds = new Set([...Object.keys(cur), ...Object.keys(__LIKES_PREV)]);

        for (const id of changedIds) {
          const a = __LIKES_PREV[id] || {};
          const b = cur[id] || {};
          const likedChanged = (typeof a.l === "boolean" || typeof b.l === "boolean") && (!!a.l !== !!b.l);
          const countChanged = (typeof a.c === "number" || typeof b.c === "number") && ((a.c|0) !== (b.c|0));

          // ✅ 내가 방금 누른/취소한 경우: 완전 무시 (개수 변화라도 알림 X)
          if (likedChanged) continue;

          // 원격 변화(다른 사람이 누른 것)만 알림
          if (countChanged) {
            const _cnt = Number(b.c ?? 0);
            pushNotice("Like count updated", `Total ${_cnt} ${_cnt === 1 ? "like" : "likes"}`, {
              tag: `like-count:${id}`,
              data: { id: String(id) }
            });
          }
        }
        __LIKES_PREV = cur;
      } catch {}
    });

    // 라벨별 투표 총합 변경
    window.addEventListener("label:votes-changed", (ev) => {
      try {
        const cur = (ev?.detail?.map && typeof ev.detail.map === "object") ? ev.detail.map : (window.readLabelVotes?.() || {});
        // 총합 증감 감지 → 상위 득표 라벨 안내
        const entries = Object.entries(cur);
        const max = Math.max(...entries.map(([, n]) => Number(n||0)), 0);
        const tops = entries.filter(([, n]) => Number(n||0) === max && max > 0).map(([k]) => k);
        if (tops.length) {
          pushNotice("Vote totals updated", `Top: ${tops.join(", ")} (${max})`, { tag: `votes-total`, data: {} });
        } else {
          pushNotice("Vote totals updated", "", { tag: `votes-total`, data: {} });
        }
        __VOTES_PREV = cur;
      } catch {}
    });

    // 7) UI handlers
    $("#btn-edit")?.addEventListener("click", () => { try { window.auth?.markNavigate?.(); } catch {} openEditModal(); });
    $("#me-avatar")?.addEventListener("click", () => { try { window.auth?.markNavigate?.(); } catch {} openAvatarCropper(); });

    // 8) notifications & sockets
    setupNotifyUI();
    ensureSocket();
    try {
      const ns = getNS();
      const bc = new BroadcastChannel(`aud:sync:${ns}`);
      bc.addEventListener("message", (e) => {
        const m = e?.data; if (!m || m.kind !== "feed:event") return;
        const { type, data } = m.payload || {};
        if (!type) return;

        // 2) 원격(다른 사람이 한) 행동 → 알림 (소켓 미연결/다른 탭만 mine 열려 있을 때 대비)
        //    mine.js 쪽에서 1차 필터링하지만, 여기서도 내 게시물인지 2차 방어
        if (!isMineOrWatchedFromPayload(data)) return;

        if (type === "item:like" && data?.liked) {
          const likes = Number(data.likes || 0);
          pushNotice("My post got liked", `Total ${qty(likes, "like")}`, { tag: `like:${data.id}`, data: { id: String(data.id || "") } });
        }
        if (type === "vote:update") {
          try {
            const entries = Object.entries(data?.counts || {});
            const max = Math.max(...entries.map(([, n]) => Number(n || 0)), 0);
            const tops = entries.filter(([, n]) => Number(n || 0) === max && max > 0).map(([k]) => k);
            const total = entries.reduce((s, [, n]) => s + Number(n || 0), 0);
            const label = tops.length ? tops.join(", ") : "—";
            pushNotice(
              "My post votes have been updated",
              `Most votes: ${label} · Total ${qty(total, "vote")}`,
              { tag: `vote:${data.id}`, data: { id: String(data.id || "") } }
            );
          } catch {
            pushNotice("My post votes have been updated", "", { tag: `vote:${data?.id || ""}`, data: { id: String(data?.id || "") } });
          }
        }
      });
    } catch {}
    if (isNotifyOn() && wantsNative() && hasNativeAPI() && Notification.permission === "default") {
      ensureNativePermission();
    }

    // 9) insights or redirect
    if (quick.authed) {
      computeAndRenderInsights().catch(() => { /* silent */ });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // === 강제 로컬 정리: store.js 및 저장소 전체 정리 ===
  function __purgeLocalStateHard(reason = "account-delete") {
    try { window.store?.purgeAccount?.(); } catch {}
    try { window.store?.reset?.(); } catch {}
    try { window.store?.clearAll?.(); } catch {}
    try { window.jib?.reset?.(); } catch {}
    try { window.__flushStoreSnapshot?.({ server:false }); } catch {}

    const wipeKey = (k) => { try { sessionStorage.removeItem(k); } catch {} try { localStorage.removeItem(k); } catch {} };

    ["auth:flag","auth:userns","collectedLabels","jib:collected","me:notify-enabled","me:notify-native"].forEach(wipeKey);

    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i); if (!key) continue;
        if (key.startsWith("me:profile") || key.startsWith("insights:")
          || key.startsWith("mine:") || key.startsWith("aud:label:")
          || key.startsWith("notify:self:") || key.startsWith("notify:remote:")) {
          wipeKey(key);
        }
      }
    } catch {}

    try { localStorage.setItem(`purge:reason:${Date.now()}`, reason); } catch {}
    try { window.dispatchEvent(new Event("store:purged")); } catch {}
    try { window.dispatchEvent(new Event("auth:logout")); } catch {}
  }

  // === 탈퇴 전용: 경고 + 하드 정리 + 백엔드 삭제 ===
  async function __confirmAndDeleteAccount() {
    const ok = window.confirm("Are you sure you want to permanently delete your account?\nThis action cannot be undone and all saved data will be removed.");
    if (!ok) return { ok: false, msg: "cancelled" };

    __purgeLocalStateHard("account-delete");

    try { await ensureCSRF(); } catch {}
    const attempts = [
      { url: "/auth/me",          method: "DELETE" },
      { url: "/api/users/me",     method: "DELETE" },
      { url: "/auth/delete",      method: "POST"   },
      { url: "/api/users/me",     method: "POST",  body: { _method: "DELETE" } },
    ];

    for (const a of attempts) {
      try {
        const opt = await withCSRF({
          method: a.method, credentials: "include",
          headers: { "Accept": "application/json", ...(a.body ? { "Content-Type": "application/json" } : {}) },
          body: a.body ? JSON.stringify(a.body) : undefined,
        });
        const r = await api(a.url, opt);
        if (r && (r.status === 200 || r.status === 204)) return { ok: true };
      } catch {}
    }
    return { ok: false, msg: "server-failed" };
  }


  // === Logout button support (ported from mine.js) ===
  async function __safeBeaconLogout() {
    try { window.__flushStoreSnapshot?.({ server:true }); } catch {}
    try {
      const blob = new Blob([JSON.stringify({})], { type: "application/json" });
      (navigator.sendBeacon && navigator.sendBeacon("/auth/logout-beacon", blob)) ||
        await fetch("/auth/logout-beacon", { method: "POST", keepalive: true, credentials: "include" });
    } catch {}
    try { sessionStorage.removeItem("auth:flag"); } catch {}
    try { localStorage.removeItem("auth:flag"); localStorage.removeItem("auth:userns"); } catch {}
    try { window.dispatchEvent(new Event("auth:logout")); } catch {}
  }

  function bindLogoutButtonForMe() {
    const btn = $("#btn-logout");
    if (!btn || btn.__bound) return;
    btn.__bound = true;

    btn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      try { btn.disabled = true; btn.setAttribute("aria-busy", "true"); } catch {}
      try {
        // ✅ 순수 로그아웃만 수행
        await __safeBeaconLogout();
        try { window.auth?.markNavigate?.(); } catch {}
        const loginURL = new URL("./login.html", document.baseURI);
        loginURL.searchParams.set("next", new URL("./me.html", document.baseURI).href);
        location.assign(loginURL.href);
      } finally {
        try { btn.disabled = false; btn.removeAttribute("aria-busy"); } catch {}
      }
    }, { capture: false });

    btn.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); btn.click(); }
    });

    try {
      const mo = new MutationObserver(() => {
        const b = $("#btn-logout");
        if (b && !b.__bound) bindLogoutButtonForMe();
      });
      mo.observe(document.body, { childList:true, subtree:true });
    } catch {}
  }

  // === Delete(탈퇴) 버튼 바인딩: #btn-delete ===
  function bindDeleteButtonForMe() {
    const btn = $("#btn-delete");
    if (!btn || btn.__bound) return;
    btn.__bound = true;

    // inline 스타일 금지 정책을 지키기 위해 style 조작은 하지 않습니다.

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const res = await __confirmAndDeleteAccount();

      // ⬇️ 확인 취소 시 즉시 중단 (아무 변화 없음)
      if (!res?.ok && res?.msg === "cancelled") return;

      // ⬇️ 서버 실패 시: 알림만 띄우고 현재 페이지 유지 (로컬은 이미 정리됨)
      if (!res?.ok) {
        alert("Failed to delete your account on the server. Local data has been cleared; please try again later.");
        return;
      }

      // 성공 시 세션 마무리 후 로그인으로
      await __safeBeaconLogout();
      try { window.auth?.markNavigate?.(); } catch {}
      const loginURL = new URL("./login.html", document.baseURI);
      loginURL.searchParams.set("next", new URL("./me.html", document.baseURI).href);
      location.assign(loginURL.href);
    }, { capture: false });

    // 접근성: 키보드 엔터/스페이스로 활성화
    btn.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); btn.click(); }
    });

    // 동적 리렌더 대비 재바인딩 가드
    try {
      const mo = new MutationObserver(() => {
        const b = $("#btn-delete");
        if (b && !b.__bound) bindDeleteButtonForMe();
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      bindLogoutButtonForMe();
      bindDeleteButtonForMe();
    }, { once: true });
  } else {
    bindLogoutButtonForMe();
    bindDeleteButtonForMe();
  }

})();
