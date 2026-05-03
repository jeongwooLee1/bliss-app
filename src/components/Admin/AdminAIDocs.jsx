import React, { useState, useEffect, useRef } from 'react'
import { T } from '../../lib/constants'
import { sb, SB_URL, sbHeaders } from '../../lib/sb'
import { ingestDocument } from '../../lib/aiDocs'
import I from '../common/I'

// 📚 AI 학습 문서 — 매장이 PDF/워드/엑셀/이미지/TXT 업로드 → 청크/임베딩 → BlissAI가 검색해서 답변
function AdminAIDocs({ bizId, geminiKey }) {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(null) // { phase, file, total, done }
  const [err, setErr] = useState('')
  const fileRef = useRef(null)

  const load = async () => {
    if (!bizId) return
    setLoading(true)
    try {
      const r = await fetch(`${SB_URL}/rest/v1/documents?business_id=eq.${bizId}&select=*&order=uploaded_at.desc`, { headers: sbHeaders })
      const j = await r.json()
      setDocs(Array.isArray(j) ? j : [])
    } catch (e) { setErr('목록 로드 실패: ' + e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [bizId])

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    if (!geminiKey) { setErr('먼저 위에서 Gemini API 키를 저장해주세요'); return }
    setErr('')
    for (const f of files) {
      try {
        await ingestDocument({
          file: f, businessId: bizId, geminiKey,
          uploadedBy: '대표',
          onProgress: (p) => setProgress({ ...p, file: f.name }),
        })
      } catch (ex) {
        setErr(`${f.name} 업로드 실패: ${ex.message}`)
      }
    }
    setProgress(null)
    if (fileRef.current) fileRef.current.value = ''
    await load()
  }

  const handleDelete = async (doc) => {
    if (!confirm(`'${doc.name}' 문서와 ${doc.chunk_count || 0}개 청크를 모두 삭제할까요?`)) return
    try {
      await sb.del('documents', doc.id)
      // CASCADE로 chunks도 자동 삭제
      await load()
    } catch (e) { setErr('삭제 실패: ' + e.message) }
  }

  const fmtSize = (n) => {
    if (!n) return ''
    if (n < 1024) return n + 'B'
    if (n < 1024*1024) return (n/1024).toFixed(1) + 'KB'
    return (n/1024/1024).toFixed(1) + 'MB'
  }
  const fmtDate = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }
  const KIND_ICON = { pdf:'📕', docx:'📄', xlsx:'📊', image:'🖼️', txt:'📝' }

  return <div>
    <div style={{padding:'10px 14px',background:'#f0f7ff',border:'1px solid #cfe2ff',borderRadius:8,fontSize:T.fs.xs,color:T.text,marginBottom:10,lineHeight:1.5}}>
      <div style={{fontWeight:T.fw.bold,marginBottom:4}}>📚 학습 문서 — RAG 시스템</div>
      매장 노하우/매뉴얼/가격표 등을 업로드하면 BlissAI가 그 내용을 학습해 답변에 활용합니다.
      <div style={{fontSize:9,color:T.textMuted,marginTop:4}}>
        지원 형식: PDF · 워드(.docx) · 파워포인트(.pptx) · 엑셀(.xlsx/.csv) · 한글(.hwpx) · HTML · RTF · 텍스트(.txt/.md/.json) · 이미지(.jpg/.png/.webp — 한글 OCR)
        <br/>※ 한글 .hwp(구버전 바이너리)·워드 .doc는 PDF 또는 .docx로 변환 후 업로드 필요
      </div>
    </div>

    <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12,flexWrap:'wrap'}}>
      <input ref={fileRef} type="file" multiple
        accept=".pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,.md,.markdown,.json,.log,.html,.htm,.rtf,.hwpx,image/*"
        onChange={handleUpload}
        style={{display:'none'}}/>
      <button onClick={()=>fileRef.current?.click()} disabled={!!progress || !geminiKey}
        style={{padding:'8px 14px',borderRadius:8,border:'none',background:T.primary,color:'#fff',cursor:'pointer',fontWeight:T.fw.bold,fontSize:T.fs.xs,opacity:(!!progress || !geminiKey)?0.5:1}}>
        + 문서 업로드 (다중 선택 가능)
      </button>
      {!geminiKey && <span style={{fontSize:T.fs.xxs,color:T.danger}}>Gemini API 키 먼저 저장 필요</span>}
      {progress && <span style={{fontSize:T.fs.xxs,color:T.primary,fontWeight:T.fw.bold}}>
        ⏳ {progress.file} — {
          progress.phase==='extract'?'텍스트 추출 중...':
          progress.phase==='chunk'?'청크 분할 중...':
          progress.phase==='embed'?`임베딩 생성 중 (${progress.total}개 청크)...`:
          progress.phase==='save'?'저장 중...':
          progress.phase==='done'?`완료 (${progress.chunks}개 청크)`:''
        }
      </span>}
    </div>

    {err && <div style={{padding:'8px 12px',background:'#fee',border:'1px solid #fcc',borderRadius:6,fontSize:T.fs.xxs,color:T.danger,marginBottom:8}}>⚠️ {err}</div>}

    {loading ? <div style={{textAlign:'center',padding:20,color:T.textMuted,fontSize:T.fs.xxs}}>로드 중...</div>
      : docs.length === 0 ? <div style={{textAlign:'center',padding:30,color:T.textMuted,fontSize:T.fs.xs,background:T.gray100,borderRadius:8}}>
          업로드된 문서가 없습니다. 첫 문서를 올려주세요.
        </div>
      : <div style={{border:'1px solid '+T.border,borderRadius:8,overflow:'hidden'}}>
          {docs.map((d, i) => (
            <div key={d.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderBottom:i<docs.length-1?'1px solid '+T.gray100:'none'}}>
              <span style={{fontSize:18,flexShrink:0}}>{KIND_ICON[d.file_type] || '📎'}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:T.fs.sm,fontWeight:T.fw.bold,color:T.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{d.name}</div>
                <div style={{fontSize:T.fs.xxs,color:T.textMuted,marginTop:2}}>
                  {d.chunk_count}개 청크 · {fmtSize(d.file_size)} · {fmtDate(d.uploaded_at)} · {d.file_type}
                </div>
              </div>
              <button onClick={()=>handleDelete(d)}
                style={{padding:'4px 10px',borderRadius:6,border:'1px solid #fecaca',background:'#fff5f5',color:T.danger,cursor:'pointer',fontSize:T.fs.xxs}}>
                삭제
              </button>
            </div>
          ))}
        </div>}
  </div>
}

export default AdminAIDocs
