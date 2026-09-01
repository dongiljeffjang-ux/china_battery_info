async function initializeAccessGate(){
  const gate = document.querySelector('#access-gate');
  const shell = document.querySelector('#app-shell');
  const form = document.querySelector('#access-form');
  const message = document.querySelector('#access-message');

  try {
    const result = await fetch('/api/access', { cache: 'no-store' });
    if (result.ok) {
      gate.hidden = true;
      shell.hidden = false;
      return;
    }
  } catch {}

  gate.hidden = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    message.textContent = '';
    try {
      const result = await fetch('/api/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKey: document.querySelector('#access-key').value })
      });
      const payload = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(payload.status || 'access_failed');
      const session = await fetch('/api/access', { cache: 'no-store' });
      if (!session.ok) throw new Error('session_cookie_not_saved');
      gate.hidden = true;
      shell.hidden = false;
    } catch (error) {
      message.textContent = error.message === 'invalid_access_key'
        ? '접근 키가 Vercel에 저장된 값과 일치하지 않습니다.'
        : error.message === 'access_key_not_configured'
          ? 'Vercel의 APP_ACCESS_KEY가 Production 환경에 설정되지 않았습니다.'
          : error.message === 'session_cookie_not_saved'
            ? '키는 확인됐지만 브라우저가 입장 세션을 저장하지 못했습니다.'
            : `접근 실패 진단 코드: ${error.message || 'unknown'}`;
      button.disabled = false;
    }
  });
}

initializeAccessGate();
