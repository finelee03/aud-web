(() => {
  // ====== 설정 ======
  const LABELS = ["thump","miro","whee","track","echo","portal"];
  const SELECTED_KEY = "aud:selectedLabel";
  const MIRROR_KEY   = "aud:selectedLabel:mirror"; 
  const LABEL_SYNC_KEY = (window.LABEL_SYNC_KEY || "label:sync"); 
  const ROUTE_ON_REGISTERED   = "./label.html";
  const ROUTE_ON_UNREGISTERED = "./aud.html";

  const LABEL_COLLECTED_EVT = window.LABEL_COLLECTED_EVT || "collectedLabels:changed";

  // ====== assets ======
  const ICONS = {
    thump: { orange: `./asset/thumpvideo.mp4`,  black: `./asset/blackthump.mp4` },
    miro:  { orange: `./asset/mirovideo.mp4`,   black: `./asset/blackmiro.mp4` },
    whee:  { orange: `./asset/wheevideo.mp4`,   black: `./asset/blackwhee.mp4` },
    track: { orange: `./asset/trackvideo.mp4`,  black: `./asset/blacktrack.mp4` },
    echo:  { orange: `./asset/echovideo.mp4`,   black: `./asset/blackecho.mp4` },
    portal:{ orange: `./asset/portalvideo.mp4`, black: `./asset/blackportal.mp4` },
  };

  // ====== 헬퍼 ======
  function setSelectedLabel(label){
    if (!LABELS.includes(label)) return;
    try{
      sessionStorage.setItem(SELECTED_KEY, label);
      window.dispatchEvent(new Event("aud:selectedLabel-changed"));
      if (isAuthed()) {
        localStorage.setItem(MIRROR_KEY, JSON.stringify({ label, t: Date.now() }));
      } else {
        try { localStorage.removeItem(MIRROR_KEY); } catch {}
      }
    }catch{}
  }

  // 공통 패치: label.js, gallery.js 모두 동일하게 고쳐주세요
  function gotoPage(label, isRegistered){
    const url = new URL(isRegistered ? ROUTE_ON_REGISTERED : ROUTE_ON_UNREGISTERED, location.href);
    url.searchParams.set("label", label);

    // ⬇️ 내부 이동 표시 (이 줄이 핵심)
    try { window.auth?.markNavigate?.(); } catch {}

    // ⬇️ assign을 쓰면 의미가 더 분명하고 일부 브라우저에서 setter가 막힌 케이스도 회피
    location.assign(url.toString());
  }

  function isAuthed() {
    try {
      return !!(window.auth?.isAuthed?.() || window.auth?.state?.authed);
    } catch { return false; }
  }

  // ====== 비디오 생성 공통 함수 ======
  function createVideo(src, speed = 1) {
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.style.width = "190%";
    video.style.height = "190%";
    video.style.objectFit = "contain";
    video.playbackRate = speed;

    const source = document.createElement("source");
    source.src = src;
    source.type = "video/mp4";
    video.appendChild(source);
    video.play().catch(()=>{});
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(entries => {
        for (const ent of entries) {
          const v = ent.target;
          if (ent.isIntersecting) v.play().catch(()=>{});
          else v.pause();
        }
      }, { threshold: 0.2 });
      io.observe(video);
    }
    return video;
  }

  // ====== 타일 생성 ======
  function makeTile(label, isOn){
    const el = document.createElement("button");
    el.type = "button";
    el.className = `tile ${isOn ? "registered" : "unregistered"}`;
    el.setAttribute("role","listitem");
    el.setAttribute("aria-label", label);
    el.setAttribute("aria-pressed", String(isOn));
    el.style.backgroundColor = "#F5F5F5";

    const wrap = document.createElement("div");
    wrap.className = "tile__content";

    const icon = ICONS[label];
    const src = icon ? (isOn ? icon.orange : icon.black) : "";

    if (src && src.endsWith(".mp4")) {
      wrap.appendChild(createVideo(src, 0.6));
    }

    el.appendChild(wrap);

    el.addEventListener("click", ()=>{
      setSelectedLabel(label);
      const isReg = typeof window.store?.isCollected === "function"
        ? window.store.isCollected(label)
        : Array.isArray(window.store?.registered) && window.store.registered.includes(label);
      gotoPage(label, !!isReg);
    });

    return el;
  }

  // ====== 렌더링 ======
  function renderGrid(){
    const grid = document.querySelector(".gallery-grid");
    if(!grid) return;
    grid.innerHTML = "";

  // 1) 우선 store 우선
  let collected = [];
  if (typeof window.store?.getCollected === "function") {
    collected = window.store.getCollected() || [];
  } else if (Array.isArray(window.store?.registered)) {
    collected = window.store.registered || [];
  }

  // 2) 게스트 fallback: collectedLabels:<ns> (session + local) 병합
  try {
    const ns = (window.__STORE_NS || "default").toLowerCase();
    const KEY_COL = `collectedLabels:${ns}`;
    const gSess = JSON.parse(sessionStorage.getItem(KEY_COL) || "[]");
    const gLoc  = JSON.parse(localStorage.getItem(KEY_COL)    || "[]");
    const merged = Array.from(new Set([...(collected||[]), ...(Array.isArray(gSess)?gSess:[]), ...(Array.isArray(gLoc)?gLoc:[])]));
    collected = merged;
  } catch {}

    const regSet = new Set(collected);
    LABELS.forEach(label=> grid.appendChild(makeTile(label, regSet.has(label))));
  }
  window.renderGrid = renderGrid;

  // ====== 이벤트 바인딩 ======
  function bindStoreEvents(){
    window.addEventListener(LABEL_COLLECTED_EVT, renderGrid);
    window.addEventListener("label:collected-changed", renderGrid);

    document.addEventListener("visibilitychange", ()=>{ 
      if(document.visibilityState==="visible") renderGrid(); 
    });

    window.addEventListener("storage", (e)=>{
      if (e.key === MIRROR_KEY && e.newValue) {
        if (!isAuthed()) return;
        try{
          const payload = JSON.parse(e.newValue || "null");
          if (payload?.label && LABELS.includes(payload.label)) {
            sessionStorage.setItem(SELECTED_KEY, payload.label);
            window.dispatchEvent(new Event("aud:selectedLabel-changed"));
          }
        }catch{}
      }

      if (e.key === LABEL_SYNC_KEY && e.newValue) {
        try {
          const { arr } = JSON.parse(e.newValue);
          if (Array.isArray(arr)) {
            const filtered = arr.filter(l => LABELS.includes(l));
            sessionStorage.setItem("collectedLabels", JSON.stringify(filtered));
            window.dispatchEvent(new Event(LABEL_COLLECTED_EVT));
          }
        } catch {}
      }
    });
  }

  // ====== Socket.IO 연동 ======
  function bindSocket(){
    const sock = window.sock;
    if(!sock || sock.__galleryBound) return;
    sock.__galleryBound = true;

    const UID_TO_LABEL = {
      "045D830A751D90": "whee",
      "044A840A751D90": "thump",
    };

    sock.on("nfc", (evt) => {
      const label = UID_TO_LABEL[evt.id] || null;
      if (!label) return;
      setSelectedLabel(label);
      console.log("[nfc]", evt, "⇒ label:", label);
    });
  }

  // ====== Hero 애니메이션 ======
  function heroIn() {
    const hero = document.querySelector(".gallery .hero");
    if (!hero) return;
    requestAnimationFrame(() => {
      setTimeout(() => hero.classList.add("is-in"), 0);
    });
  }

  // ====== Bootstrap ======
  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  onReady(() => {
    try {
      const q = new URLSearchParams(location.search);
      const label = q.get("label");
      if (label && LABELS.includes(label)) setSelectedLabel(label);
    } catch {}

    renderGrid();
    bindStoreEvents();
    bindSocket();
    heroIn();

    // socket 재시도
    setTimeout(bindSocket, 50);
    setTimeout(bindSocket, 250);
  });
})();

// 렌더러가 makeTile/renderGrid 형태라면, 부트 코드 끝에:
(function bindGalleryRefresh(){
  if (window.__galleryBound) return; window.__galleryBound = true;

  const rerender = ()=> { try { renderGrid(); } catch {} };

  window.addEventListener("auth:state", rerender);
  window.addEventListener("storage", (e)=> {
    if (e?.key === (window.LABEL_SYNC_KEY || "label:sync")) rerender();
  });
  window.addEventListener(window.LABEL_COLLECTED_EVT || "collectedLabels:changed", rerender);
})();
