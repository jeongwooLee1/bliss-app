/**
 * AI 문서 인덱싱/검색 헬퍼 (RAG 시스템)
 *
 * 흐름:
 *   1. extractText(file)  — 파일 형식별 텍스트 추출 (브라우저 사이드)
 *   2. chunkText(text)    — 800자 + 50자 overlap 청크 분할
 *   3. embedTexts(texts)  — Gemini text-embedding-004로 임베딩 (768차원)
 *   4. ingestDocument()   — DB에 documents + document_chunks 저장
 *   5. searchDocs()       — 질문 임베딩 + match_documents RPC로 top K 검색
 */
import * as pdfjsLib from 'pdfjs-dist'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import { sb, SB_URL, sbHeaders } from './sb'
import { genId } from './utils'

// PDF.js worker (Vite에서 ESM URL로 import)
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc

// ─── 파일 형식별 텍스트 추출 ────────────────────────────────────────────────
async function extractPDF(file) {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const out = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    const txt = tc.items.map(it => it.str).join(' ')
    out.push(`[페이지 ${p}]\n${txt}`)
  }
  return out.join('\n\n')
}

async function extractDOCX(file) {
  const buf = await file.arrayBuffer()
  const r = await mammoth.extractRawText({ arrayBuffer: buf })
  return r.value || ''
}

async function extractXLSX(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const out = []
  wb.SheetNames.forEach(name => {
    const sheet = wb.Sheets[name]
    const csv = XLSX.utils.sheet_to_csv(sheet)
    if (csv.trim()) out.push(`[시트: ${name}]\n${csv}`)
  })
  return out.join('\n\n')
}

async function extractTXT(file) {
  return await file.text()
}

// 이미지 OCR — Gemini Vision (한글 지원)
async function extractImage(file, geminiKey) {
  if (!geminiKey) throw new Error('Gemini API 키가 설정되지 않음 (관리설정→AI 설정)')
  const buf = await file.arrayBuffer()
  const b64 = btoa(new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ''))
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: '이 이미지에 보이는 모든 텍스트를 한국어로 정확히 추출하세요. 표/리스트/번호도 그대로 포함. 설명·주석 없이 추출 텍스트만 출력.' },
          { inline_data: { mime_type: file.type || 'image/jpeg', data: b64 } }
        ]
      }],
      generationConfig: { temperature: 0 }
    })
  })
  if (!r.ok) throw new Error('이미지 OCR 실패: ' + (await r.text()).slice(0, 200))
  const j = await r.json()
  return j.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

// 메인 추출 함수 — 형식 자동 판별
export async function extractText(file, geminiKey) {
  const name = (file.name || '').toLowerCase()
  const type = (file.type || '').toLowerCase()
  if (name.endsWith('.pdf') || type === 'application/pdf') return { text: await extractPDF(file), kind: 'pdf' }
  if (name.endsWith('.docx') || type.includes('wordprocessingml')) return { text: await extractDOCX(file), kind: 'docx' }
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || type.includes('spreadsheetml') || type.includes('ms-excel'))
    return { text: await extractXLSX(file), kind: 'xlsx' }
  if (name.endsWith('.txt') || type === 'text/plain') return { text: await extractTXT(file), kind: 'txt' }
  if (type.startsWith('image/')) return { text: await extractImage(file, geminiKey), kind: 'image' }
  throw new Error(`지원하지 않는 파일 형식: ${file.name}`)
}

// ─── 청크 분할 (한글 800자 + 50자 overlap, 가능하면 줄/문장 경계) ─────────────
export function chunkText(text, opts = {}) {
  const SIZE = opts.size || 800
  const OVERLAP = opts.overlap || 50
  const clean = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
  if (!clean) return []
  const chunks = []
  let i = 0
  while (i < clean.length) {
    let end = Math.min(i + SIZE, clean.length)
    if (end < clean.length) {
      // 가능하면 줄바꿈/마침표/공백 경계로 백오프
      const slice = clean.slice(i, end)
      const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '))
      if (lastBreak > SIZE * 0.5) end = i + lastBreak + 1
    }
    const piece = clean.slice(i, end).trim()
    if (piece) chunks.push(piece)
    if (end >= clean.length) break
    i = Math.max(i + 1, end - OVERLAP)
  }
  return chunks
}

// ─── Gemini text-embedding-004 임베딩 (768 차원, 한국어 지원) ────────────────
export async function embedTexts(texts, apiKey) {
  if (!apiKey) throw new Error('Gemini API 키가 설정되지 않음')
  if (!Array.isArray(texts) || texts.length === 0) return []
  const out = []
  // 배치 호출 — Gemini batch embed up to 100 per request
  const BATCH = 50
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH)
    const body = {
      requests: batch.map(t => ({
        model: 'models/text-embedding-004',
        content: { parts: [{ text: t }] },
        taskType: 'RETRIEVAL_DOCUMENT',
      }))
    }
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!r.ok) throw new Error('임베딩 실패: ' + (await r.text()).slice(0, 200))
    const j = await r.json()
    ;(j.embeddings || []).forEach(e => out.push(e.values))
  }
  return out
}

// 단일 쿼리 임베딩 (검색용 — taskType=RETRIEVAL_QUERY)
export async function embedQuery(text, apiKey) {
  if (!apiKey) throw new Error('Gemini API 키가 설정되지 않음')
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/text-embedding-004',
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_QUERY',
    })
  })
  if (!r.ok) throw new Error('쿼리 임베딩 실패: ' + (await r.text()).slice(0, 200))
  const j = await r.json()
  return j.embedding?.values || []
}

// ─── 문서 통째 인덱싱 ───────────────────────────────────────────────────────
export async function ingestDocument({ file, businessId, geminiKey, uploadedBy = '', onProgress = null }) {
  if (!businessId || !geminiKey) throw new Error('businessId와 geminiKey 필수')
  // 1) 추출
  if (onProgress) onProgress({ phase: 'extract', file: file.name })
  const { text, kind } = await extractText(file, geminiKey)
  if (!text || text.trim().length < 10) throw new Error('텍스트 추출 결과 비어있음')
  // 2) 청크
  if (onProgress) onProgress({ phase: 'chunk' })
  const chunks = chunkText(text)
  if (chunks.length === 0) throw new Error('청크 생성 실패')
  // 3) 임베딩
  if (onProgress) onProgress({ phase: 'embed', total: chunks.length })
  const vectors = await embedTexts(chunks, geminiKey)
  if (vectors.length !== chunks.length) throw new Error('임베딩 개수 불일치')
  // 4) DB INSERT
  if (onProgress) onProgress({ phase: 'save' })
  const docId = 'doc_' + genId()
  const now = new Date().toISOString()
  await sb.upsert('documents', [{
    id: docId, business_id: businessId, name: file.name, file_type: kind,
    file_size: file.size || 0, chunk_count: chunks.length,
    uploaded_by: uploadedBy, uploaded_at: now, created_at: now, updated_at: now,
  }])
  // chunks 배치 INSERT
  const chunkRows = chunks.map((content, idx) => ({
    id: 'cnk_' + genId() + '_' + idx,
    document_id: docId, business_id: businessId, chunk_index: idx,
    content, embedding: vectors[idx], metadata: { source: file.name, kind },
    created_at: now,
  }))
  // 청크는 100개씩 나눠 upsert (한 요청 페이로드 제한 회피)
  const CHUNK_BATCH = 100
  for (let i = 0; i < chunkRows.length; i += CHUNK_BATCH) {
    await sb.upsert('document_chunks', chunkRows.slice(i, i + CHUNK_BATCH))
  }
  if (onProgress) onProgress({ phase: 'done', docId, chunks: chunks.length })
  return { docId, chunks: chunks.length, kind }
}

// ─── 질문으로 top K 청크 검색 ───────────────────────────────────────────────
export async function searchDocs({ question, businessId, geminiKey, threshold = 0.5, count = 5 }) {
  if (!question || !businessId || !geminiKey) return []
  try {
    const qvec = await embedQuery(question, geminiKey)
    if (!qvec.length) return []
    const r = await fetch(`${SB_URL}/rest/v1/rpc/match_documents`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_biz_id: businessId, query_embedding: qvec, match_threshold: threshold, match_count: count })
    })
    if (!r.ok) return []
    const rows = await r.json()
    return Array.isArray(rows) ? rows : []
  } catch (_) { return [] }
}

// 검색 결과를 LLM 컨텍스트 문자열로 포맷
export function buildDocsContext(hits) {
  if (!Array.isArray(hits) || hits.length === 0) return ''
  const lines = hits.map((h, i) => {
    const src = h?.metadata?.source ? ` (출처: ${h.metadata.source})` : ''
    return `[문서 ${i + 1}${src}]\n${h.content}`
  })
  return `[하우스왁싱 업로드 문서 — 답변 시 우선 참고]\n${lines.join('\n\n')}`
}

export default { extractText, chunkText, embedTexts, embedQuery, ingestDocument, searchDocs, buildDocsContext }
