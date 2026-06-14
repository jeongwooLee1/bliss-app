import React from 'react'
import ReactDOM from 'react-dom/client'

// Show import errors on screen (append to separate div, don't touch React root)
window.addEventListener('error', e => {
  let errDiv = document.getElementById('bliss-error-overlay');
  if (!errDiv) { errDiv = document.createElement('div'); errDiv.id = 'bliss-error-overlay'; document.body.appendChild(errDiv); }
  errDiv.innerHTML = `<pre style="color:red;padding:20px;white-space:pre-wrap;position:fixed;top:0;left:0;right:0;z-index:99999;background:#fff">ERROR: ${e.message}\n${e.filename}:${e.lineno}\n${e.error?.stack||''}</pre>`;
});
window.addEventListener('unhandledrejection', e => {
  let errDiv = document.getElementById('bliss-error-overlay');
  if (!errDiv) { errDiv = document.createElement('div'); errDiv.id = 'bliss-error-overlay'; document.body.appendChild(errDiv); }
  errDiv.innerHTML += `<pre style="color:orange;padding:20px;white-space:pre-wrap;position:fixed;top:50px;left:0;right:0;z-index:99999;background:#fff">PROMISE: ${e.reason?.message||e.reason}\n${e.reason?.stack||''}</pre>`;
});

import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ChatPreview from './pages/ChatPreview'
import PaymentApp from './pages/PaymentApp'
import { AuthProvider } from './lib/AuthContext'

// 보안: Supabase REST 요청에 로그인 세션 토큰(x-bliss-session) 자동 부착 (2026-06-14 보안사고 대응).
// 공개 키 단독으로는 민감 테이블 못 읽게 — 서버 RLS가 이 헤더를 검증(차단 적용 후). 적용 전엔 무해(무시됨).
(function(){
  if (typeof window === 'undefined' || !window.fetch || window.__blissFetchPatched) return;
  window.__blissFetchPatched = true;
  const _f = window.fetch.bind(window);
  window.fetch = function(input, init){
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      // /rest/ (DB) + /storage/ (서명URL 생성 등) 둘 다 토큰 부착 — 버킷 비공개 전환 대비
      if (url.indexOf('dpftlrsuqxqqeouwbfjd.supabase.co/rest/') !== -1 ||
          url.indexOf('dpftlrsuqxqqeouwbfjd.supabase.co/storage/') !== -1) {
        const tok = localStorage.getItem('bliss_session_token') || '';
        if (tok) {
          const h = new Headers((init && init.headers) || (typeof input !== 'string' && input && input.headers) || {});
          if (!h.has('x-bliss-session')) h.set('x-bliss-session', tok);
          init = Object.assign({}, init, { headers: h });
        }
      }
    } catch(e){}
    return _f(input, init);
  };
})();

// ?chat=1 → 사내 메신저 독립 프리뷰만 렌더 (라이브 앱 완전 우회)
const isChatPreview = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('chat') === '1'

// /pay/* → 익명 결제 페이지 (AuthProvider/AppShell 우회)
const isPaymentPage = typeof window !== 'undefined' &&
  /^\/pay(\/|$)/.test(window.location.pathname)

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <div style={{padding:20,color:'red',fontFamily:'monospace',whiteSpace:'pre-wrap'}}>
      <h2>앱 오류 발생</h2><p>{this.state.error.message}</p><p>{this.state.error.stack}</p>
    </div>;
    return this.props.children;
  }
}

try {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <ErrorBoundary>
      {isChatPreview ? (
        <ChatPreview />
      ) : isPaymentPage ? (
        <BrowserRouter>
          <PaymentApp />
        </BrowserRouter>
      ) : (
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      )}
    </ErrorBoundary>
  );
} catch(e) {
  document.getElementById('root').innerHTML = `<pre style="color:red;padding:20px">RENDER ERROR: ${e.message}\n${e.stack}</pre>`;
}
