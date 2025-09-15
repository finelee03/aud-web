// home.js (patched)
(function () {
  "use strict";

  // ---- DOM Ready 유틸 (defer 유무/스크립트 위치와 무관하게 안전) ----
  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  // =========================
  // 1) home.js 내용
  // =========================
  onReady(function () {
    var tone = document.querySelector(".h0 .tone");
    if (tone) tone.classList.add("slide-in-left");
  });

  // =========================
  // 2) aud-word.js 내용
  // =========================
  onReady(function () {
    var SELECTED_KEY = "aud:selectedLabel";

    // 단어 후보
    var wordList = ["PLAY", "LINGER", "THRILL", "RELEASE", "RUSH", "WANDER"];

    // 매핑
    var wordToLabelMap = {
      PLAY: "miro",
      LINGER: "echo",
      THRILL: "track",
      RELEASE: "thump",
      RUSH: "whee",
      WANDER: "portal"
    };

    var el = document.getElementById("audWord");
    var link = document.getElementById("audWordLink");
    if (!el || !link) return;

    // 랜덤 선택
    var word = wordList[Math.floor(Math.random() * wordList.length)];
    el.textContent = word;

    // 클릭 시 선택 라벨 저장
    link.addEventListener("click", function () {
      var label = wordToLabelMap[word];
      try {
        if (label) {
          sessionStorage.setItem(SELECTED_KEY, label);
        } else {
          sessionStorage.removeItem(SELECTED_KEY);
        }
      } catch (e) {}
    });

    // (선택) 진입 지연 후 등장 효과
    // setTimeout(function () {
    //   el.style.animationDelay = "120ms";
    //   el.classList.add("show");
    // }, 100);
  });

  // =========================
  // 3) random-photo.js 내용
  // =========================
  onReady(function () {
    // 랜덤 후보
    var sources = [
      "./asset/black-01.png",
      "./asset/black-02.png",
      "./asset/black-03.png",
      "./asset/black-04.png",
      "./asset/black-05.png",
      "./asset/black-06.png"
    ];

    var slot = document.getElementById("randomSlot");
    if (!slot) return;

    function createMediaEl(src) {
      var parts = String(src).split(".");
      var ext = parts.length ? parts[parts.length - 1].toLowerCase() : "";
      var isVideo = (ext === "mp4" || ext === "webm" || ext === "mov");

      if (isVideo) {
        var v = document.createElement("video");
        v.src = src;
        v.autoplay = true;
        v.muted = true;
        v.loop = true;           // 랜덤 박스는 루프
        v.playsInline = true;
        v.preload = "metadata";
        return v;
      } else {
        var img = document.createElement("img");
        img.src = src;
        img.alt = "Random artwork";
        return img;
      }
    }

    // 랜덤 하나 골라서 삽입
    var pick = sources[Math.floor(Math.random() * sources.length)];
    var mediaEl = createMediaEl(pick);
    slot.innerHTML = "";
    if (mediaEl) slot.appendChild(mediaEl);
  });

  // =========================
  // 4) FEATURE 텍스트 slide-in-left 트리거 (스크롤 진입 시 1회 재생)
  // =========================
  onReady(function () {
    var reduced = false;
    try { reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    // opt-in 요소만 관찰: data-anim="slide-in-left" 또는 보조 클래스
    var targets = document.querySelectorAll('.ft-copy[data-anim="slide-in-left"], .ft-copy.slide-in-when-visible');
    if (targets.length === 0) return;

    var activate = function(el){
      // 왜: 기존 .reveal 시스템과 충돌 방지 (자식 opacity:0/transform 초기화 방지)
      if (el.classList.contains('reveal')){
        el.classList.add('in');                 // 가시화
        el.classList.remove('reveal-left','reveal-right');
      }
      if (!el.classList.contains('slide-in-left')){
        el.classList.add('slide-in-left');      // 스태거 애니메이션 트리거
      }
    };

    if (reduced || !("IntersectionObserver" in window)){
      // 접근성/폴백: 즉시 적용
      targets.forEach(activate);
      return;
    }

    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (entry.isIntersecting){
          activate(entry.target);
          io.unobserve(entry.target); // 1회만
        }
      });
    }, { threshold: 0.35 });

    targets.forEach(function(el){ io.observe(el); });
  });

})();
// =========================
// Gate + IO (group-aware, two-phase, bottom-edge trigger)
// - 첫 상호작용 전까지 절대 노출 없음
// - 요소가 "뷰포트 하단에 1px이라도 들어온 순간" 재생
// - 같은 data-reveal-group은 동시에(또는 스태거) 재생
// =========================
(function () {
  var CFG = {
    REPEAT: false,                         // true: 뷰 밖→재진입 때마다 반복
    ROOT_MARGIN: "0px 0px 0px 0px",        // 하단 진입 즉시 트리거 (필요하면 "0px 0px -1px 0px")
    MOBILE_BREAKPOINT: 624,
    MOBILE_RISE: "24px",
    DESKTOP_RISE: "42px",
    SLIDE_DX: { L: "-42px", R: "42px" },
    GROUP_STAGGER: false,
    STAGGER_MS: 0,
    UNSET_WILL_CHANGE: true
  };

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isMobile = function(){ return window.matchMedia("(max-width:"+CFG.MOBILE_BREAKPOINT+"px)").matches; };

  // 대상 수집
  var targets = Array.prototype.slice.call(document.querySelectorAll(".ft-copy, .reveal-up"));

  // 초기화
  targets.forEach(function (el) {
    el.classList.remove("slide-in-left","slide-in-right","slide-in-up","is-ready","animate");
    el.dataset.animated = "false";
  });

  // 그룹 매핑
  var groups = {};
  targets.forEach(function (el) {
    var gid = el.getAttribute("data-reveal-group");
    if (!gid) return;
    (groups[gid] || (groups[gid] = [])).push(el);
  });

  // 접근성: 모션 축소면 즉시 표시
  if (reduceMotion) {
    targets.forEach(function (el) {
      el.style.opacity = "1";
      el.style.visibility = "visible";
      el.style.transform = "none";
    });
    return;
  }

  // 첫 상호작용 게이트
  var interacted = false;
  ["scroll","wheel","touchstart","keydown","pointerdown"].forEach(function (ev) {
    window.addEventListener(ev, openGate, { passive: true, once: true });
  });
  function openGate(){
    if (interacted) return;
    interacted = true;
    startObservers();
    requestAnimationFrame(immediateCheck);
  }

  // 옵저버
  function startObservers(){
    if (!("IntersectionObserver" in window)) {
      function onScroll(){ immediateCheck(); }
      window.addEventListener("scroll", onScroll, { passive:true });
      window.addEventListener("resize", onScroll);
      onScroll();
      return;
    }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        var el = entry.target;
        // ★ 핵심: isIntersecting이면 "하단에 보이자마자" 트리거
        if (entry.isIntersecting){
          playGroupOrOne(el, io);
        } else if (CFG.REPEAT){
          reset(el);
        }
      });
    }, { threshold: 0, rootMargin: CFG.ROOT_MARGIN });

    targets.forEach(function(el){ io.observe(el); });
  }

  // 현재 이미 보이는 요소도 즉시 판정
  function immediateCheck(){
    var vh = (window.visualViewport && window.visualViewport.height) ||
             window.innerHeight || document.documentElement.clientHeight;
    targets.forEach(function(el){
      if (el.dataset.animated === "true" && !CFG.REPEAT) return;
      var r = el.getBoundingClientRect();
      // 하단에 1px이라도 보이면 true
      if (r.top <= vh && r.bottom >= 0) playGroupOrOne(el, null);
      else if (CFG.REPEAT) reset(el);
    });
  }

  // 그룹 동시(또는 스태거) 재생
  function playGroupOrOne(el, io){
    var gid = el.getAttribute("data-reveal-group");
    if (gid && groups[gid] && groups[gid].length){
      var members = groups[gid];
      if (CFG.GROUP_STAGGER && CFG.STAGGER_MS > 0){
        members.forEach(function(m, i){
          setTimeout(function(){
            playOne(m);
            if (io && !CFG.REPEAT) io.unobserve(m);
          }, i * CFG.STAGGER_MS);
        });
      }else{
        members.forEach(function(m){
          playOne(m);
          if (io && !CFG.REPEAT) io.unobserve(m);
        });
      }
    }else{
      playOne(el);
      if (io && !CFG.REPEAT) io.unobserve(el);
    }
  }

  // 방향/거리 변수 주입
  function setDirectionVars(el){
    if (el.classList.contains("reveal-up")){
      el.style.setProperty("--rise-dy", isMobile() ? CFG.MOBILE_RISE : CFG.DESKTOP_RISE);
    } else if (el.classList.contains("ft-copy")){
      var dx = el.classList.contains("align-right") ? CFG.SLIDE_DX.R : CFG.SLIDE_DX.L;
      el.style.setProperty("--slide-dx", dx);
    }
  }

  // 두-단계 재생
  function playOne(el){
    if (el.dataset.animated === "true" && !CFG.REPEAT) return;

    setDirectionVars(el);

    // 1) 준비: 보이되 0/offset
    el.classList.add("is-ready");

    // 2) 리플로우 후 재생
    el.getBoundingClientRect();
    el.classList.add("animate");
    el.dataset.animated = "true";

    el.addEventListener("animationend", function once(){
      el.style.opacity = "1";
      el.style.visibility = "visible";
      el.style.transform = "none";
      if (CFG.UNSET_WILL_CHANGE) el.style.willChange = "auto";
      el.removeEventListener("animationend", once);
    }, { once:true });
  }

  function reset(el){
    el.classList.remove("is-ready","animate");
    el.dataset.animated = "false";
    // 반복 모드에서 완전 숨김으로 되돌리려면:
    // el.style.opacity = "0";
    // el.style.visibility = "hidden";
  }
})();
