(() => {
  const API = "https://aud-api-dtd1.onrender.com";
  window.PROD_BACKEND = API;  // 신규 코드가 참조
  window.API_ORIGIN   = API;  // 레거시 코드가 참조
  window.API_BASE     = API;  // 레거시 alias
})();
