// FAQ를 RAG 검색 청크로 저장/관리 (확장형). 항목별 편집 + 임베딩 → document_chunks.
// 기존 학습문서와 동일한 임베딩(embedTexts)을 써서 같은 벡터 공간 → 서버 RAG(match_documents)가 자동 검색.
// ★핵심(core) 항목은 호출부(AdminAISettings)에서 settings.ai_faq에도 동기화해 항상 직접 주입.
import { sb, SB_URL, SB_KEY } from './sb'
import { embedTexts } from './aiDocs'

const H = () => ({ apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' })
const FAQ_DOC_ID = (biz) => `doc_faq_${biz}`
const _gid = () => 'faq_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4)

// FAQ 전용 documents row 보장 (학습문서 목록에선 숨기고 싶으면 name 규칙으로 필터 가능)
export async function ensureFaqDoc(biz) {
  const id = FAQ_DOC_ID(biz)
  await fetch(`${SB_URL}/rest/v1/documents?on_conflict=id`, {
    method: 'POST',
    headers: { ...H(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id, business_id: biz, name: 'FAQ (항목 관리)', file_type: 'faq', file_size: 0 }),
  }).catch(() => {})
  return id
}

// FAQ 항목 로드 — document_chunks(FAQ 문서) → [{chunkId,q,a,category,core}]
export async function loadFaqItems(biz) {
  const rows = await sb.getAll('document_chunks', `&document_id=eq.${FAQ_DOC_ID(biz)}&select=id,content,metadata&order=created_at`).catch(() => [])
  return (Array.isArray(rows) ? rows : []).map(r => {
    const m = r.metadata || {}
    return { chunkId: r.id, q: m.q || '', a: m.a || '', category: m.category || '기타', core: !!m.core, active: m.active !== false }
  })
}

// FAQ 항목 저장(추가/수정) — 임베딩 후 청크 upsert. geminiKey 필수.
export async function saveFaqItem(biz, item, geminiKey) {
  if (!geminiKey) throw new Error('Gemini 키 없음 (임베딩 불가)')
  const q = (item.q || '').trim(), a = (item.a || '').trim()
  if (!q || !a) throw new Error('질문/답변을 입력하세요')
  await ensureFaqDoc(biz)
  const content = `Q. ${q}\nA. ${a}`
  const [vec] = await embedTexts([content], geminiKey)
  if (!vec || !vec.length) throw new Error('임베딩 실패')
  const id = item.chunkId || _gid()
  const row = {
    id, document_id: FAQ_DOC_ID(biz), business_id: biz, chunk_index: 0,
    content, embedding: vec,
    metadata: { kind: 'faq', q, a, category: item.category || '기타', core: !!item.core, active: item.active !== false },
  }
  await sb.upsert('document_chunks', [row])
  return id
}

export async function deleteFaqItem(chunkId) {
  await sb.del('document_chunks', chunkId).catch(() => {})
}

// 메타데이터만 수정(활성/핵심 토글 등) — 재임베딩 불필요
export async function updateFaqMeta(chunkId, item) {
  await sb.update('document_chunks', chunkId, {
    metadata: { kind: 'faq', q: (item.q || '').trim(), a: (item.a || '').trim(), category: item.category || '기타', core: !!item.core, active: item.active !== false },
  }).catch(() => {})
}

// 일괄 이관용 — 여러 FAQ 항목을 임베딩 후 청크 batch upsert (마이그레이션).
export async function bulkImportFaq(biz, items, geminiKey, onProgress) {
  await ensureFaqDoc(biz)
  const out = []
  const B = 80
  for (let i = 0; i < items.length; i += B) {
    const slice = items.slice(i, i + B)
    const texts = slice.map(it => `Q. ${(it.q || '').trim()}\nA. ${(it.a || '').trim()}`)
    const vecs = await embedTexts(texts, geminiKey)
    if (vecs.length !== slice.length) throw new Error('임베딩 개수 불일치')
    const rows = slice.map((it, k) => ({
      id: _gid(), document_id: FAQ_DOC_ID(biz), business_id: biz, chunk_index: 0,
      content: texts[k], embedding: vecs[k],
      metadata: { kind: 'faq', q: (it.q || '').trim(), a: (it.a || '').trim(), category: it.category || '기타', core: !!it.core, active: true },
    }))
    await sb.upsert('document_chunks', rows)
    out.push(...rows)
    if (onProgress) onProgress(Math.min(i + B, items.length), items.length)
  }
  return out
}
