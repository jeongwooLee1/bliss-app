import React, { useState, useMemo, useEffect } from 'react'
import QRCode from 'qrcode'
import { T } from '../../lib/constants'
import { sb } from '../../lib/sb'
import { genId } from '../../lib/utils'

const SIGN_HOST = 'https://sign.blissme.ai'

/**
 * 키오스크 (매장 비치 태블릿) 등록·관리.
 * businesses.settings.kiosks = [{id, name, branch_id}]
 * 각 태블릿에 이 URL을 띄워두면 직원이 고객관리에서 '태블릿으로 전송' 시 자동 서명 UI 뜸.
 */
export default function AdminKiosks({ data, setData, bizId }) {
  const biz = (data?.businesses || [])[0]
  const branches = data?.branches || []

  const settings = useMemo(() => {
    try {
      const raw = biz?.settings
      return typeof raw === 'string' ? JSON.parse(raw) : (raw || {})
    } catch { return {} }
  }, [biz?.settings])

  const [kiosks, setKiosks] = useState(() => Array.isArray(settings.kiosks) ? settings.kiosks : [])
  const [editing, setEditing] = useState(null) // {id?, name, branch_id} — null이면 폼 숨김
  const [qrMap, setQrMap] = useState({}) // {kioskId: dataUri}

  // QR 미리 생성
  useEffect(() => {
    (async () => {
      const next = {}
      for (const k of kiosks) {
        if (qrMap[k.id]) { next[k.id] = qrMap[k.id]; continue }
        try {
          next[k.id] = await QRCode.toDataURL(`${SIGN_HOST}/?k=${k.id}`, { width: 180, margin: 1 })
        } catch {}
      }
      setQrMap(next)
    })()
  }, [kiosks.map(k => k.id).join(',')])

  const save = async (list) => {
    const nextSettings = { ...settings, kiosks: list }
    try {
      await sb.update('businesses', bizId, { settings: JSON.stringify(nextSettings) })
      setKiosks(list)
      // data.businesses 갱신 (SaleForm 등에서 바로 쓸 수 있게)
      setData(prev => prev ? {
        ...prev,
        businesses: (prev.businesses || []).map(b => b.id === bizId ? { ...b, settings: JSON.stringify(nextSettings) } : b),
      } : prev)
    } catch (e) {
      console.error('[kiosks] save', e)
      alert('저장 실패: ' + (e?.message || e))
    }
  }

  const submit = async () => {
    if (!editing?.name?.trim()) return alert('이름을 입력하세요')
    const k = {
      id: editing.id || 'kiosk_' + genId(),
      name: editing.name.trim(),
      branch_id: editing.branch_id || null,
    }
    const exists = kiosks.some(x => x.id === k.id)
    const next = exists ? kiosks.map(x => x.id === k.id ? k : x) : [...kiosks, k]
    await save(next)
    setEditing(null)
  }

  const remove = async (id) => {
    if (!confirm('이 태블릿을 삭제하시겠습니까?')) return
    await save(kiosks.filter(k => k.id !== id))
  }

  const copyUrl = (id) => {
    navigator.clipboard?.writeText(`${SIGN_HOST}/?k=${id}`).then(() => alert('URL 복사됨'))
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: T.fs.lg, fontWeight: T.fw.black, color: T.text }}>📲 태블릿 (키오스크) 관리</h3>
        <div style={{ fontSize: T.fs.xs, color: T.textMuted, marginTop: 4, lineHeight: 1.6 }}>
          매장에 비치한 태블릿을 등록합니다. 등록 후 각 태블릿의 URL을 해당 태블릿 브라우저에 띄워두면,<br />
          고객관리에서 "📲 태블릿으로 전송" 선택 시 자동으로 서명 화면이 열립니다.
        </div>
      </div>

      {kiosks.length === 0 && !editing && (
        <div style={{ padding: 30, textAlign: 'center', color: T.textMuted, fontSize: 13, background: T.gray100, borderRadius: 8, marginBottom: 12 }}>
          등록된 태블릿이 없습니다
        </div>
      )}

      <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
        {kiosks.map(k => {
          const br = branches.find(b => b.id === k.branch_id)
          const url = `${SIGN_HOST}/?k=${k.id}`
          return (
            <div key={k.id} style={{ padding: 14, background: '#fff', border: '1px solid ' + T.border, borderRadius: 10, display: 'flex', gap: 14, alignItems: 'center' }}>
              {qrMap[k.id] && <img src={qrMap[k.id]} alt="QR" style={{ width: 100, height: 100, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: T.fs.md, fontWeight: T.fw.bolder, color: T.text }}>{k.name}</div>
                <div style={{ fontSize: T.fs.xs, color: T.textMuted, marginTop: 2 }}>
                  지점: {br ? (br.short || br.name) : '미지정'}
                </div>
                <div style={{ fontSize: 10, color: T.textMuted, wordBreak: 'break-all', marginTop: 6, padding: '4px 6px', background: T.gray100, borderRadius: 4 }}>{url}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button onClick={() => copyUrl(k.id)} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, background: T.gray200, color: T.text, border: 'none', borderRadius: 4, cursor: 'pointer' }}>📋 URL 복사</button>
                <a href={url} target="_blank" rel="noopener noreferrer" style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, background: T.primary, color: '#fff', borderRadius: 4, textDecoration: 'none', textAlign: 'center' }}>🖥 열기</a>
                <button onClick={() => setEditing({ ...k })} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, background: '#fff', color: T.textSub, border: '1px solid ' + T.border, borderRadius: 4, cursor: 'pointer' }}>수정</button>
                <button onClick={() => remove(k.id)} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, background: '#fff', color: T.danger, border: '1px solid ' + T.danger + '44', borderRadius: 4, cursor: 'pointer' }}>삭제</button>
              </div>
            </div>
          )
        })}
      </div>

      {editing ? (
        <div style={{ padding: 14, background: T.primaryLt, border: '1px solid ' + T.primary, borderRadius: 10 }}>
          <div style={{ fontSize: T.fs.sm, fontWeight: T.fw.black, color: T.primary, marginBottom: 10 }}>
            {editing.id ? '태블릿 수정' : '새 태블릿 등록'}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: T.fs.xs }}>
              <span style={{ width: 80, color: T.textSub, fontWeight: 600 }}>이름</span>
              <input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="예: 강남점 1번 태블릿"
                style={{ flex: 1, padding: '6px 10px', fontSize: 13, border: '1px solid ' + T.border, borderRadius: 6 }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: T.fs.xs }}>
              <span style={{ width: 80, color: T.textSub, fontWeight: 600 }}>지점</span>
              <select value={editing.branch_id || ''} onChange={e => setEditing({ ...editing, branch_id: e.target.value || null })}
                style={{ flex: 1, padding: '6px 10px', fontSize: 13, border: '1px solid ' + T.border, borderRadius: 6, background: '#fff' }}>
                <option value="">미지정</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.short || b.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <button onClick={() => setEditing(null)} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, background: '#fff', color: T.textSub, border: '1px solid ' + T.border, borderRadius: 6, cursor: 'pointer' }}>취소</button>
            <button onClick={submit} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, background: T.primary, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>저장</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing({ name: '', branch_id: branches[0]?.id || null })}
          style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, background: T.primaryLt, color: T.primary, border: '1.5px dashed ' + T.primary, borderRadius: 8, cursor: 'pointer' }}>
          + 새 태블릿 등록
        </button>
      )}
    </div>
  )
}
