// 필요 시 서버에서 window.CSRF를 주입하거나, /auth/csrf 호출로 채워라.
// 이 파일은 비어 있어도 되지만, 존재하면 스크립트에서 window.CSRF 참조 가능.
window.CSRF = window.CSRF || '';
