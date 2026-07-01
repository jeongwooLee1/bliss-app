// 거래관리 순수 헬퍼 — 금액 포맷, 한글금액, 명세서/세금계산서 HTML, 엑셀 export
import * as XLSX from 'xlsx'

export const TAX_RATE = 0.1

export const fmt = (n) => (n == null || n === 0) ? '0' : Number(n).toLocaleString('ko-KR')

export const genId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

// 주문 상태 메타 (지점/본사 공통)
export const ORDER_STATUS = {
  requested: { label: '신청/입금대기', color: '#e8b830', bg: '#fffde7' },
  paid:      { label: '입금확인',      color: '#5cb5c5', bg: '#e0f7fa' },
  shipped:   { label: '배송완료',      color: '#6ab56a', bg: '#e8f5e9' },
  done:      { label: '완료',          color: '#6b7684', bg: '#f2f4f6' },
  cancelled: { label: '취소',          color: '#ef5350', bg: '#fdecea' },
}
export const STATUS_FLOW = ['requested', 'paid', 'shipped', 'done']

export function numToKor(num) {
  num = Math.round(Number(num) || 0)
  if (num === 0) return '영'
  const units = ['', '만', '억', '조'], digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'], sub = ['', '십', '백', '천']
  let r = '', ui = 0
  while (num > 0) {
    let p = num % 10000
    if (p > 0) {
      let ps = '', si = 0
      while (p > 0) { const dd = p % 10; if (dd > 0) ps = digits[dd] + sub[si] + ps; p = Math.floor(p / 10); si++ }
      r = ps + units[ui] + r
    }
    num = Math.floor(num / 10000); ui++
  }
  return r
}

// 품목 배열 합계 (지점 신청/본사 공통)
export function calcTotals(items) {
  return (items || []).reduce((a, it) => ({
    totalQty: a.totalQty + (Number(it.qty) || 0),
    totalSupply: a.totalSupply + (Number(it.supply) || 0),
    totalTax: a.totalTax + (Number(it.tax) || 0),
    grandTotal: a.grandTotal + (Number(it.total) || 0),
  }), { totalQty: 0, totalSupply: 0, totalTax: 0, grandTotal: 0 })
}

// 품목 라인 계산
export function lineOf(product, qty = 1) {
  const price = Number(product.price) || 0
  const supply = price * qty
  const tax = Math.round(supply * TAX_RATE)
  return { code: product.code || '', name: product.name, spec: product.spec || '1', unit: product.unit || '1', qty, price, supply, tax, total: supply + tax }
}

// ── 거래명세서 HTML (원본 디자인 이식) ──
export function buildStatementHTML({ order, supplier, customer }) {
  const items = order.items || []
  const t = calcTotals(items)
  let rows = items.map((it, i) => `<tr><td style="border:1px solid #ccc;padding:6px;text-align:center;font-size:12px">${i + 1}</td><td style="border:1px solid #ccc;padding:6px;font-size:12px">${it.name}</td><td style="border:1px solid #ccc;padding:6px;text-align:center;font-size:12px">${it.spec}</td><td style="border:1px solid #ccc;padding:6px;text-align:right;font-size:12px">${it.qty}</td><td style="border:1px solid #ccc;padding:6px;text-align:right;font-size:12px">${fmt(it.price)}</td><td style="border:1px solid #ccc;padding:6px;text-align:right;font-size:12px">${fmt(it.supply)}</td><td style="border:1px solid #ccc;padding:6px;text-align:right;font-size:12px">${fmt(it.tax)}</td><td style="border:1px solid #ccc;padding:6px;text-align:right;font-size:12px">${fmt(it.total)}</td></tr>`).join('')
  for (let i = 0; i < Math.max(0, 10 - items.length); i++) rows += '<tr>' + '<td style="border:1px solid #ccc;padding:6px;font-size:12px">&nbsp;</td>'.repeat(8) + '</tr>'
  return `
    <div style="text-align:center;margin-bottom:20px"><h1 style="font-size:26px;font-weight:700;letter-spacing:10px;color:#1e3a5f">거 래 명 세 서</h1><p style="font-size:12px;color:#666;margin-top:4px">(공급받는자 보관용)</p></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:16px;font-size:13px"><div><strong>${customer?.name || ''}</strong> 귀하</div><div>거래일자: ${order.tx_date || ''}</div></div>
    <table style="border-collapse:collapse;width:100%;margin-bottom:16px"><thead><tr style="background:#f0f4f8"><th style="border:1px solid #999;padding:8px 6px;font-size:12px;width:30px">No</th><th style="border:1px solid #999;padding:8px 6px;font-size:12px">품명</th><th style="border:1px solid #999;padding:8px 6px;font-size:12px;width:50px">규격</th><th style="border:1px solid #999;padding:8px 6px;font-size:12px;width:40px">수량</th><th style="border:1px solid #999;padding:8px 6px;font-size:12px;width:80px">단가</th><th style="border:1px solid #999;padding:8px 6px;font-size:12px;width:90px">공급가액</th><th style="border:1px solid #999;padding:8px 6px;font-size:12px;width:80px">세액</th><th style="border:1px solid #999;padding:8px 6px;font-size:12px;width:90px">합계</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr style="background:#f0f4f8;font-weight:700"><td colspan="3" style="border:1px solid #999;padding:8px 6px;text-align:center;font-size:13px">합 계</td><td style="border:1px solid #999;padding:8px 6px;text-align:right;font-size:13px">${t.totalQty}</td><td style="border:1px solid #999;padding:8px 6px"></td><td style="border:1px solid #999;padding:8px 6px;text-align:right;font-size:13px">${fmt(t.totalSupply)}</td><td style="border:1px solid #999;padding:8px 6px;text-align:right;font-size:13px">${fmt(t.totalTax)}</td><td style="border:1px solid #999;padding:8px 6px;text-align:right;font-size:13px">${fmt(t.grandTotal)}</td></tr></tfoot></table>
    <div style="text-align:center;font-size:13px;padding:12px 0;border-top:2px solid #1e3a5f;border-bottom:2px solid #1e3a5f;margin-bottom:20px"><strong>합계금액: ${numToKor(t.grandTotal)}원정 (₩${fmt(t.grandTotal)})</strong></div>
    <div style="display:flex;justify-content:space-between;margin-top:16px;font-size:11px;color:#555">
      <div style="flex:1"><strong>입금계좌:</strong> ${supplier?.bank || '-'}</div>
      <div style="flex:1;text-align:right"><strong>${supplier?.name || ''}</strong> &nbsp;대표: ${supplier?.rep || ''}<br>사업자번호: ${supplier?.biz_no || ''}<br>${supplier?.address || ''}</div>
    </div>`
}

// ── 세금계산서 HTML (인쇄/미리보기용, 원본 이식) ──
export function buildTaxInvoiceHTML({ order, supplier, customer }) {
  const items = order.items || []
  const t = calcTotals(items)
  const d = order.tx_date || ''
  const m = d ? parseInt(d.split('-')[1]) : '', dy = d ? parseInt(d.split('-')[2]) : ''
  const s = supplier || {}, c = customer || {}
  let rows = items.map((it, i) => `<tr><td style="border:1px solid #ccc;padding:5px;text-align:center;font-size:11px">${i === 0 ? m : ''}</td><td style="border:1px solid #ccc;padding:5px;text-align:center;font-size:11px">${i === 0 ? dy : ''}</td><td style="border:1px solid #ccc;padding:5px;font-size:11px">${it.name}</td><td style="border:1px solid #ccc;padding:5px;text-align:center;font-size:11px">${it.spec}</td><td style="border:1px solid #ccc;padding:5px;text-align:right;font-size:11px">${it.qty}</td><td style="border:1px solid #ccc;padding:5px;text-align:right;font-size:11px">${fmt(it.price)}</td><td style="border:1px solid #ccc;padding:5px;text-align:right;font-size:11px">${fmt(it.supply)}</td><td style="border:1px solid #ccc;padding:5px;text-align:right;font-size:11px">${fmt(it.tax)}</td><td style="border:1px solid #ccc;padding:5px;font-size:11px"></td></tr>`).join('')
  for (let i = 0; i < Math.max(0, 4 - items.length); i++) rows += '<tr>' + '<td style="border:1px solid #ccc;padding:5px">&nbsp;</td>'.repeat(9) + '</tr>'
  return `<div style="border:3px solid #1e3a5f">
    <div style="background:#1e3a5f;color:#fff;text-align:center;padding:10px 0"><h1 style="font-size:20px;font-weight:700;letter-spacing:14px;margin:0">세 금 계 산 서</h1><span style="font-size:11px">(공급자 보관용)</span></div>
    <table style="border-collapse:collapse;width:100%"><tbody>
      <tr><td rowspan="4" style="border:1px solid #999;width:20px;text-align:center;background:#e8eef4;font-weight:700;font-size:12px;writing-mode:vertical-lr;letter-spacing:4px">공급자</td><td style="border:1px solid #999;width:80px;background:#f5f7fa;font-size:11px">등록번호</td><td colspan="3" style="border:1px solid #999;font-size:12px;font-weight:500">${s.biz_no || ''}</td><td rowspan="4" style="border:1px solid #999;width:20px;text-align:center;background:#e8eef4;font-weight:700;font-size:12px;writing-mode:vertical-lr;letter-spacing:4px">공급받는자</td><td style="border:1px solid #999;width:80px;background:#f5f7fa;font-size:11px">등록번호</td><td colspan="3" style="border:1px solid #999;font-size:12px;font-weight:500">${c.biz_no || ''}</td></tr>
      <tr><td style="border:1px solid #999;background:#f5f7fa;font-size:11px">상호</td><td style="border:1px solid #999;font-size:12px">${s.name || ''}</td><td style="border:1px solid #999;background:#f5f7fa;font-size:11px;width:50px">성명</td><td style="border:1px solid #999;font-size:12px">${s.rep || ''}</td><td style="border:1px solid #999;background:#f5f7fa;font-size:11px">상호</td><td style="border:1px solid #999;font-size:12px">${c.name || ''}</td><td style="border:1px solid #999;background:#f5f7fa;font-size:11px;width:50px">성명</td><td style="border:1px solid #999;font-size:12px">${c.rep || ''}</td></tr>
      <tr><td style="border:1px solid #999;background:#f5f7fa;font-size:11px">주소</td><td colspan="3" style="border:1px solid #999;font-size:10px">${s.address || ''}</td><td style="border:1px solid #999;background:#f5f7fa;font-size:11px">주소</td><td colspan="3" style="border:1px solid #999;font-size:10px">${c.address || ''}</td></tr>
      <tr><td style="border:1px solid #999;background:#f5f7fa;font-size:11px">업태</td><td style="border:1px solid #999;font-size:11px">${s.biz_type || ''}</td><td style="border:1px solid #999;background:#f5f7fa;font-size:11px">종목</td><td style="border:1px solid #999;font-size:11px">${s.biz_item || ''}</td><td style="border:1px solid #999;background:#f5f7fa;font-size:11px">업태</td><td style="border:1px solid #999;font-size:11px">${c.biz_type || ''}</td><td style="border:1px solid #999;background:#f5f7fa;font-size:11px">종목</td><td style="border:1px solid #999;font-size:11px">${c.biz_item || ''}</td></tr>
    </tbody></table>
    <table style="border-collapse:collapse;width:100%;margin-top:-1px"><tbody>
      <tr style="background:#e8eef4"><td style="border:1px solid #999;text-align:center;font-size:11px;font-weight:700;width:80px">작성일자</td><td style="border:1px solid #999;text-align:center;font-size:11px;font-weight:700">공급가액</td><td style="border:1px solid #999;text-align:center;font-size:11px;font-weight:700">세액</td><td style="border:1px solid #999;text-align:center;font-size:11px;font-weight:700">비고</td></tr>
      <tr><td style="border:1px solid #999;text-align:center;font-size:12px;padding:8px">${d}</td><td style="border:1px solid #999;text-align:right;font-size:13px;padding:8px;font-weight:700">${fmt(t.totalSupply)}</td><td style="border:1px solid #999;text-align:right;font-size:13px;padding:8px;font-weight:700">${fmt(t.totalTax)}</td><td style="border:1px solid #999;padding:8px"></td></tr>
    </tbody></table>
    <table style="border-collapse:collapse;width:100%;margin-top:-1px"><thead><tr style="background:#e8eef4"><th style="border:1px solid #999;padding:6px;font-size:11px;width:30px">월</th><th style="border:1px solid #999;padding:6px;font-size:11px;width:30px">일</th><th style="border:1px solid #999;padding:6px;font-size:11px">품목</th><th style="border:1px solid #999;padding:6px;font-size:11px;width:50px">규격</th><th style="border:1px solid #999;padding:6px;font-size:11px;width:40px">수량</th><th style="border:1px solid #999;padding:6px;font-size:11px;width:80px">단가</th><th style="border:1px solid #999;padding:6px;font-size:11px;width:90px">공급가액</th><th style="border:1px solid #999;padding:6px;font-size:11px;width:80px">세액</th><th style="border:1px solid #999;padding:6px;font-size:11px;width:60px">비고</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr style="background:#e8eef4;font-weight:700"><td colspan="4" style="border:1px solid #999;text-align:center;font-size:12px;padding:8px">합계금액</td><td style="border:1px solid #999;text-align:right;font-size:12px;padding:8px">${t.totalQty}</td><td style="border:1px solid #999;padding:8px"></td><td style="border:1px solid #999;text-align:right;font-size:12px;padding:8px">${fmt(t.totalSupply)}</td><td style="border:1px solid #999;text-align:right;font-size:12px;padding:8px">${fmt(t.totalTax)}</td><td style="border:1px solid #999;padding:8px"></td></tr></tfoot></table>
    <div style="text-align:center;padding:12px 0;font-size:13px;font-weight:700;background:#f5f7fa;border-top:1px solid #999">합계금액: ₩${fmt(t.grandTotal)} (${numToKor(t.grandTotal)}원정)</div>
  </div>`
}

// 새 창 인쇄
export function printHTML(html, title) {
  const w = window.open('', '_blank', 'width=850,height=1000')
  if (!w) return
  w.document.write(`<html><head><title>${title}</title><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Noto Sans KR',sans-serif;padding:20px}table{border-collapse:collapse;width:100%}@media print{body{padding:10mm}}</style></head><body>${html}</body></html>`)
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300)
}

// ── 홈택스 대량발행 엑셀 export ──
// 홈택스 전자세금계산서 "일괄(대량)발급" 표준서식 컬럼 순서. 품목 1건/1행.
export function exportHometaxExcel(orders, { suppliersMap, customersMap }) {
  const HEADER = [
    '전자세금계산서분류(01일반)', '전자세금계산서종류(01세금계산서)', '작성일자(YYYYMMDD)', '과세형태(과세/영세/면세)',
    '공급자등록번호', '공급자종사업장', '공급자상호', '공급자성명', '공급자사업장주소', '공급자업태', '공급자종목', '공급자이메일',
    '공급받는자등록번호', '공급받는자종사업장', '공급받는자상호', '공급받는자성명', '공급받는자사업장주소', '공급받는자업태', '공급받는자종목', '공급받는자이메일1', '공급받는자이메일2',
    '품목일자(YYYYMMDD)', '품목명', '규격', '수량', '단가', '공급가액', '세액', '품목비고',
    '합계금액', '현금', '수표', '어음', '외상미수금', '영수청구구분(영수/청구)', '비고',
  ]
  const rows = [HEADER]
  const taxMap = { 별도: '과세', 포함: '과세', 영세: '영세', 면세: '면세' }
  orders.forEach((o) => {
    const s = suppliersMap[o.supplier_id] || {}
    const c = customersMap[o.customer_id] || {}
    const t = calcTotals(o.items || [])
    const dd = (o.tx_date || '').replace(/-/g, '')
    const taxForm = taxMap[o.tax_type] || '과세'
    const items = (o.items && o.items.length) ? o.items : [{}]
    items.forEach((it, idx) => {
      rows.push([
        '01', '01', dd, taxForm,
        s.biz_no || '', '', s.name || '', s.rep || '', s.address || '', s.biz_type || '', s.biz_item || '', '',
        c.biz_no || '', '', c.name || '', c.rep || '', c.address || '', c.biz_type || '', c.biz_item || '', '', '',
        dd, it.name || '', it.spec || '', it.qty || '', it.price || '', it.supply || '', it.tax || '', '',
        idx === 0 ? t.grandTotal : '', '', '', '', idx === 0 ? t.grandTotal : '', '청구', o.memo || '',
      ])
    })
  })
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = HEADER.map((h) => ({ wch: Math.max(10, Math.min(24, h.length + 2)) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '세금계산서대량발행')
  XLSX.writeFile(wb, `세금계산서_대량발행_${new Date().toISOString().split('T')[0]}.xlsx`)
}

// ── 매출내역 엑셀 (종합/상세) ──
export function exportHistoryExcel(orders, { customersMap }) {
  const summaryHeader = ['No', '일자', '거래처', '상태', '품목수', '공급가액', '세액', '합계', '메모']
  const summaryRows = orders.map((o, i) => {
    const c = customersMap[o.customer_id] || {}
    return [i + 1, o.tx_date, c.name || '-', (ORDER_STATUS[o.status]?.label || o.status), (o.items || []).length, o.total_supply, o.total_tax, o.grand_total, o.memo || '']
  })
  const gt = orders.reduce((a, o) => ({ s: a.s + (o.total_supply || 0), t: a.t + (o.total_tax || 0), g: a.g + (o.grand_total || 0), c: a.c + (o.items || []).length }), { s: 0, t: 0, g: 0, c: 0 })
  summaryRows.push(['', '합 계', '', '', gt.c, gt.s, gt.t, gt.g, ''])
  const ws1 = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows])
  ws1['!cols'] = [{ wch: 5 }, { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 20 }]

  const detailHeader = ['일자', '거래처', '코드', '품명', '규격', '수량', '단가', '공급가액', '세액', '합계']
  const detailRows = []
  orders.forEach((o) => {
    const c = customersMap[o.customer_id] || {}
    ;(o.items || []).forEach((it, ii) => {
      detailRows.push([ii === 0 ? o.tx_date : '', ii === 0 ? (c.name || '-') : '', it.code, it.name, it.spec, it.qty, it.price, it.supply, it.tax, it.total])
    })
    detailRows.push(['', '소계', '', '', '', o.total_qty, '', o.total_supply, o.total_tax, o.grand_total])
    detailRows.push([])
  })
  const ws2 = XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows])
  ws2['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 8 }, { wch: 14 }, { wch: 6 }, { wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws1, '거래종합')
  XLSX.utils.book_append_sheet(wb, ws2, '거래상세')
  XLSX.writeFile(wb, `거래내역_${new Date().toISOString().split('T')[0]}.xlsx`)
}
