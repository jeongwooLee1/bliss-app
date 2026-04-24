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
import { AuthProvider } from './lib/AuthContext'

// ?chat=1 → 사내 메신저 독립 프리뷰만 렌더 (라이브 앱 완전 우회)
const isChatPreview = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('chat') === '1'

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
