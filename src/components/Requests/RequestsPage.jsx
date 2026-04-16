import { useState, useEffect } from 'react'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import { T } from '../../lib/constants'
import I from '../common/I'

// 이미지 리사이즈 (max 1200px, JPEG 0.8)
const resizeImage = (file) => new Promise((resolve) => {
  const reader = new FileReader()
  reader.onload = (e) => {
    const img = new Image()
    img.onload = () => {
      const MAX = 1200
      let { width: w, height: h } = img
      if (w > MAX || h > MAX) {
        if (w > h) { h = h * MAX / w; w = MAX }
        else { w = w * MAX / h; h = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve({ name: file.name, data: canvas.toDataURL('image/jpeg', 0.8) })
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
})

export default function RequestsPage({ data, bizId, currentUser }) {
  const [name, setName] = useState(currentUser?.name || '')
  const [content, setContent] = useState('')
  const [photos, setPhotos] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [photoView, setPhotoView] = useState(null)

  const loadRequests = async () => {
    setLoading(true)
    const rows = await sb.get('user_requests', `&business_id=eq.${bizId}&order=created_at.desc&limit=50`)
    setRequests(rows || [])
    setLoading(false)
  }

  useEffect(() => { if (bizId) loadRequests() }, [bizId])

  const handleFiles = async (files) => {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (!arr.length) return
    const processed = []
    for (const f of arr) {
      const resized = await resizeImage(f)
      processed.push(resized)
    }
    setPhotos(prev => [...prev, ...processed])
  }

  const removePhoto = (i) => setPhotos(prev => prev.filter((_, idx) => idx !== i))

  const handleSubmit = async () => {
    if (!name.trim()) return alert('이름을 입력해 주세요.')
    if (!content.trim()) return alert('요청 내용을 입력해 주세요.')
    setSubmitting(true)
    try {
      const row = {
        business_id: bizId,
        user_id: currentUser?.id || null,
        user_name: name.trim(),
        content: content.trim(),
        photos: photos,
        status: 'pending',
      }
      const r = await fetch(`${SB_URL}/rest/v1/user_requests`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify(row)
      })
      if (!r.ok) {
        const err = await r.text()
        alert('전송 실패: ' + err)
      } else {
        setContent('')
        setPhotos([])
        await loadRequests()
        alert('요청이 전송되었습니다. 빠르게 확인하고 답변드리겠습니다.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const fmtDate = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const statusLabel = (s) => ({
    pending: { text: '접수됨', color: T.orange, bg: T.orangeLt },
    in_progress: { text: '처리 중', color: T.primary, bg: T.primaryHover },
    done: { text: '완료', color: T.successDk, bg: T.successLt },
    rejected: { text: '반려', color: T.danger, bg: T.dangerLt || '#FEE' },
  })[s] || { text: s, color: T.gray500, bg: T.gray100 }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '8px 4px' }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: '0 0 8px' }}>
        <I name="msgSq" size={18}/> 요청사항
      </h2>
      <p style={{ fontSize: 13, color: T.textSub, margin: '0 0 20px' }}>
        개선 제안이나 버그를 보내주세요. 빠르게 확인하고 처리하겠습니다.
      </p>

      {/* 작성 폼 */}
      <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: T.textSub, marginBottom: 4, display: 'block' }}>이름</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="홍길동"
              style={{ width: '100%', padding: '8px 10px', fontSize: 14, border: `1px solid ${T.border}`, borderRadius: 6, fontFamily: 'inherit', boxSizing: 'border-box' }}/>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: T.textSub, marginBottom: 4, display: 'block' }}>요청 내용</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={5}
              placeholder="개선 제안, 버그, 불편한 점 등을 자유롭게 적어주세요."
              style={{ width: '100%', padding: '8px 10px', fontSize: 14, border: `1px solid ${T.border}`, borderRadius: 6, fontFamily: 'inherit', resize: 'vertical', minHeight: 100, boxSizing: 'border-box' }}/>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: T.textSub, marginBottom: 6, display: 'block' }}>사진 첨부 (선택)</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 80, height: 80, border: `2px dashed ${T.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 24, color: T.gray400, background: T.gray100 }}>
                +
                <input type="file" accept="image/*" multiple onChange={e => handleFiles(e.target.files)} style={{ display: 'none' }}/>
              </label>
              {photos.map((p, i) => (
                <div key={i} style={{ position: 'relative', width: 80, height: 80 }}>
                  <img src={p.data} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, border: `1px solid ${T.border}` }}
                    onClick={() => setPhotoView(p.data)}/>
                  <button onClick={() => removePhoto(i)}
                    style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: T.danger, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, lineHeight: 1, padding: 0 }}>×</button>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11, color: T.gray500, margin: '6px 0 0' }}>최대 1200px로 자동 리사이즈됩니다.</p>
          </div>
          <button onClick={handleSubmit} disabled={submitting}
            style={{ padding: '10px 16px', background: submitting ? T.gray400 : T.primary, color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: submitting ? 'default' : 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
            {submitting ? '전송 중…' : '요청 전송'}
          </button>
        </div>
      </div>

      {/* 요청 내역 */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, margin: '0 0 12px' }}>요청 내역</h3>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: T.gray500 }}>로딩…</div>
      ) : requests.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: T.gray500, background: T.gray100, borderRadius: 8 }}>
          아직 요청이 없습니다.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {requests.map(r => {
            const st = statusLabel(r.status)
            return (
              <div key={r.id} style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14, color: T.text }}>{r.user_name}</strong>
                  <span style={{ fontSize: 11, color: T.gray500 }}>{fmtDate(r.created_at)}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: st.color, background: st.bg, padding: '2px 8px', borderRadius: 10 }}>{st.text}</span>
                </div>
                <div style={{ fontSize: 13, color: T.text, whiteSpace: 'pre-wrap', lineHeight: 1.5, marginBottom: r.photos?.length ? 8 : 0 }}>{r.content}</div>
                {r.photos?.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {r.photos.map((p, i) => (
                      <img key={i} src={p.data} alt={p.name}
                        style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 6, border: `1px solid ${T.border}`, cursor: 'pointer' }}
                        onClick={() => setPhotoView(p.data)}/>
                    ))}
                  </div>
                )}
                {r.admin_reply && (
                  <div style={{ marginTop: 10, padding: 10, background: T.primaryHover, borderRadius: 6, borderLeft: `3px solid ${T.primary}` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.primary, marginBottom: 4 }}>답변 · {fmtDate(r.replied_at)}</div>
                    <div style={{ fontSize: 13, color: T.text, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{r.admin_reply}</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 사진 확대 모달 */}
      {photoView && (
        <div onClick={() => setPhotoView(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'pointer' }}>
          <img src={photoView} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}/>
        </div>
      )}
    </div>
  )
}
