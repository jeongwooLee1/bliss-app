import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { T } from '../../lib/constants'
import { SB_URL, sbHeaders } from '../../lib/sb'

// 접속 이력 (계정 보안 감시) — 로그인 시 기록된 IP/국가/OS/브라우저/기기 조회
const fmtKst = (iso) => {
  try {
    const d = new Date(iso);
    const k = new Date(d.getTime() + 9 * 3600 * 1000); // UTC→KST
    const p = (n) => String(n).padStart(2, '0');
    return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
  } catch { return ''; }
};
const COUNTRY = { KR: '🇰🇷 한국', US: '🇺🇸 미국', JP: '🇯🇵 일본', CN: '🇨🇳 중국', '': '-' };

export default function AdminLoginLog({ data, bizId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30');   // 7 | 30 | this | last | all
  const [q, setQ] = useState('');

  const _bizId = bizId || data?.businesses?.[0]?.id;

  const load = useCallback(async () => {
    if (!_bizId) return;
    setLoading(true);
    let since = null, until = null;
    const now = new Date();
    if (period === '7') since = new Date(now.getTime() - 7 * 864e5);
    else if (period === '30') since = new Date(now.getTime() - 30 * 864e5);
    else if (period === 'this') since = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (period === 'last') { since = new Date(now.getFullYear(), now.getMonth() - 1, 1); until = new Date(now.getFullYear(), now.getMonth(), 1); }
    let url = `${SB_URL}/rest/v1/account_login_log?business_id=eq.${_bizId}&order=created_at.desc&limit=500&select=*`;
    if (since) url += `&created_at=gte.${since.toISOString()}`;
    if (until) url += `&created_at=lt.${until.toISOString()}`;
    try {
      const r = await fetch(url, { headers: sbHeaders });
      setRows(await r.json() || []);
    } catch { setRows([]); }
    setLoading(false);
  }, [_bizId, period]);

  useEffect(() => { load(); }, [load]);

  // 계정별 사용 IP 개수 (여러 IP = 주의 신호)
  const ipCountByAcct = useMemo(() => {
    const m = {};
    rows.forEach(r => { const k = r.account_id || r.login_id; if (!k) return; (m[k] = m[k] || new Set()).add(r.ip); });
    const o = {}; Object.keys(m).forEach(k => o[k] = m[k].size); return o;
  }, [rows]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(r => [r.login_id, r.name, r.ip, r.os, r.browser].some(v => String(v || '').toLowerCase().includes(t)));
  }, [rows, q]);

  const Btn = ({ v, label }) => (
    <button onClick={() => setPeriod(v)} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${period === v ? T.primary : T.border}`, background: period === v ? T.primary : '#fff', color: period === v ? '#fff' : T.textSub, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
  );

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: T.fs.xl, fontWeight: T.fw.black, color: T.text }}>접속 이력</h2>
      <div style={{ fontSize: 12.5, color: T.textSub, marginBottom: 16 }}>계정별 로그인 접속 정보(IP·국가·기기) 기록 — 의심스러운 접속을 직접 확인하세요. 같은 계정이 평소와 다른 IP/기기로 접속했는지 살펴보세요.</div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <Btn v="7" label="최근 7일" /><Btn v="30" label="최근 30일" /><Btn v="this" label="이번 달" /><Btn v="last" label="지난달" /><Btn v="all" label="전체" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름·로그인ID·IP 검색"
          style={{ flex: 1, minWidth: 150, padding: '7px 11px', borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: 'inherit', color: T.text }} />
        <button onClick={load} title="새로고침" style={{ padding: '7px 11px', borderRadius: 8, border: `1px solid ${T.border}`, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, color: T.textSub }}>↻</button>
      </div>

      <div style={{ fontSize: 12.5, color: T.textSub, marginBottom: 8 }}>총 {filtered.length}건</div>

      {loading ? <div style={{ padding: 40, textAlign: 'center', color: T.textSub }}>불러오는 중…</div>
        : filtered.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: T.textSub }}>접속 기록이 없습니다.</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(r => {
              const multi = (ipCountByAcct[r.account_id || r.login_id] || 1) >= 3;
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: T.bgCard, borderRadius: 10, flexWrap: 'wrap', boxShadow: T.shadow.sm }}>
                  <div style={{ minWidth: 130 }}>
                    <div style={{ fontWeight: 700, color: T.text, fontSize: 13.5 }}>{r.name || r.login_id || '-'}
                      {r.role && <span style={{ marginLeft: 5, fontSize: 11, color: T.textSub, fontWeight: 500 }}>{r.role === 'owner' ? '대표' : r.role === 'manager' ? '지점장' : r.role === 'staff' ? '직원' : r.role}</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: T.textSub }}>{r.login_id}</div>
                  </div>
                  <div style={{ minWidth: 120, fontSize: 13, color: T.text }}>{fmtKst(r.created_at)}</div>
                  <div style={{ minWidth: 130, fontSize: 13 }}>
                    <span style={{ fontWeight: 600, color: multi ? T.danger : T.text }}>{r.ip || '-'}</span>
                    {multi && <span title="이 계정이 3개 이상의 IP에서 접속" style={{ marginLeft: 5, fontSize: 10.5, color: T.danger, fontWeight: 700 }}>다중IP</span>}
                  </div>
                  <div style={{ minWidth: 70, fontSize: 12.5, color: T.textSub }}>{COUNTRY[r.country] || r.country || '-'}</div>
                  <div style={{ fontSize: 12.5, color: T.textSub }}>{r.device} · {r.os} · {r.browser}</div>
                </div>
              );
            })}
          </div>}
    </div>
  );
}
