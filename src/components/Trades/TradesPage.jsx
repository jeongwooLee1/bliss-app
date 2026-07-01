// 거래관리 — 지점(구매신청) + 본사(주문접수·입금확인·배송·명세서·세금계산서·거래처/제품/공급자)
import { useEffect, useMemo, useRef, useState } from 'react'
import { sb } from '../../lib/sb'
import { T } from '../../lib/constants'
import { I } from '../common/I'
import { Btn, Modal, Empty } from '../common'
import { callSendSms, normPhone } from '../../lib/smsSend'
import html2canvas from 'html2canvas'
import {
  fmt, genId, calcTotals, lineOf, ORDER_STATUS, STATUS_FLOW,
  buildStatementHTML, buildTaxInvoiceHTML, printHTML, exportHometaxExcel, exportHistoryExcel,
} from './tradeUtils'

const inp = { width: '100%', padding: '8px 10px', border: `1px solid ${T.border}`, borderRadius: T.radius.md, fontSize: T.fs.sm, fontFamily: 'inherit', boxSizing: 'border-box', background: T.bgCard, color: T.text }
const card = { background: T.bgCard, borderRadius: T.radius.lg, boxShadow: T.shadow.sm, padding: 16 }
const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })

function StatusBadge({ status }) {
  const m = ORDER_STATUS[status] || { label: status, color: T.gray600, bg: T.gray200 }
  return <span style={{ display: 'inline-block', fontSize: T.fs.xxs, fontWeight: 700, padding: '3px 9px', borderRadius: T.radius.full, color: m.color, background: m.bg }}>{m.label}</span>
}

export default function TradesPage({ data, userBranches = [], isMaster, role, currentUser, bizId }) {
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [orders, setOrders] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2200) }

  const reload = async (which = 'all') => {
    const jobs = []
    if (which === 'all' || which === 'orders') jobs.push(sb.get('trade_orders', `&business_id=eq.${bizId}&order=requested_at.desc`).then(setOrders))
    if (which === 'all') {
      jobs.push(sb.get('trade_suppliers', `&business_id=eq.${bizId}&order=sort.asc`).then(setSuppliers))
      jobs.push(sb.get('trade_products', `&business_id=eq.${bizId}&order=sort.asc`).then(setProducts))
      jobs.push(sb.get('trade_customers', `&business_id=eq.${bizId}&order=sort.asc`).then(setCustomers))
      jobs.push(sb.get('trade_settings', `&business_id=eq.${bizId}&order=updated_at.asc&limit=1`).then(r => setSettings(r?.[0] || null)))
    }
    await Promise.all(jobs)
  }
  useEffect(() => { if (bizId) { setLoading(true); reload('all').finally(() => setLoading(false)) } }, [bizId])

  const suppliersMap = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s])), [suppliers])
  const customersMap = useMemo(() => Object.fromEntries(customers.map(c => [c.id, c])), [customers])
  const branchNameMap = useMemo(() => Object.fromEntries((data?.branches || []).map(b => [b.id, b.name])), [data])
  const defaultSupplier = useMemo(() => suppliers.find(s => s.id === settings?.default_supplier_id) || suppliers.find(s => s.is_default) || suppliers[0], [suppliers, settings])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: T.textSub }}>불러오는 중…</div>

  // 스코핑(전 지점 vs 자기 지점)은 AdminTrades가 관리자 모드 on/off로 판단
  const common = { bizId, suppliers, products, customers, orders, settings, suppliersMap, customersMap, branchNameMap, defaultSupplier, reload, showToast, currentUser }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <I name="handshake" size={22} color={T.primary} />
        <h2 style={{ fontSize: T.fs.xl, fontWeight: T.fw.black, color: T.text, margin: 0 }}>거래관리</h2>
        <span style={{ fontSize: T.fs.xs, color: T.textMuted }}>도매 주문·명세서·세금계산서</span>
      </div>
      <AdminTrades {...common} role={role} userBranches={userBranches} />
      {toast && <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: T.gray800, color: '#fff', padding: '10px 18px', borderRadius: T.radius.full, fontSize: T.fs.sm, fontWeight: 600, zIndex: 12000, boxShadow: T.shadow.lg }}>{toast}</div>}
    </div>
  )
}

/* ═══════════════ 지점 구매신청 뷰 ═══════════════ */
function BranchOrder({ bizId, products, customers, orders, settings, defaultSupplier, branchNameMap, customersMap, reload, showToast, currentUser, userBranches }) {
  const myBranchId = userBranches[0] || null
  const myCustomer = useMemo(() => customers.find(c => c.branch_id === myBranchId) || null, [customers, myBranchId])
  const [cart, setCart] = useState({}) // code -> qty
  const [search, setSearch] = useState('')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const activeProducts = products.filter(p => p.active !== false)
  const filtered = activeProducts.filter(p => !search || p.name.includes(search) || (p.code || '').includes(search))
  const items = useMemo(() => Object.entries(cart).filter(([, q]) => q > 0).map(([code, q]) => {
    const p = products.find(x => x.code === code); return p ? lineOf(p, q) : null
  }).filter(Boolean), [cart, products])
  const totals = calcTotals(items)
  const myOrders = orders.filter(o => o.branch_id === myBranchId)

  const setQty = (code, q) => setCart(prev => ({ ...prev, [code]: Math.max(0, q) }))

  const submit = async () => {
    if (!items.length) return showToast('제품을 선택하세요')
    setSubmitting(true)
    const id = genId('to')
    const row = {
      id, business_id: bizId, order_no: `S${todayStr().replace(/-/g, '')}-${String(Date.now()).slice(-4)}`,
      supplier_id: defaultSupplier?.id || null, customer_id: myCustomer?.id || null, branch_id: myBranchId,
      tx_date: todayStr(), tax_type: '별도', items,
      total_qty: totals.totalQty, total_supply: totals.totalSupply, total_tax: totals.totalTax, grand_total: totals.grandTotal,
      memo, status: 'requested', requested_by: currentUser?.name || '', requested_at: new Date().toISOString(),
    }
    await sb.insert('trade_orders', row)
    // 담당자 알림 SMS
    try {
      const phone = normPhone(settings?.manager_phone)
      if (settings?.notify_enabled !== false && phone) {
        const bn = branchNameMap[myBranchId] || myCustomer?.name || '지점'
        const msg = `[거래관리] 구매신청\n${bn} / ${currentUser?.name || ''}\n금액: ${fmt(totals.grandTotal)}원 (${items.length}품목)\n블리스 거래관리에서 확인하세요.`
        await callSendSms(myBranchId, msg, [{ phone }])
      }
    } catch (e) { console.warn('[trade] 알림 SMS 실패', e) }
    setCart({}); setMemo(''); setSubmitting(false)
    showToast('구매신청 완료 ✓')
    reload('orders')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 16, alignItems: 'start' }}>
      {/* 제품 카탈로그 */}
      <div style={card}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input style={inp} placeholder="제품 검색" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
          {filtered.map(p => {
            const q = cart[p.code] || 0
            return (
              <div key={p.id} style={{ border: `1px solid ${q > 0 ? T.primary : T.border}`, borderRadius: T.radius.md, padding: 12, background: q > 0 ? T.primaryLt : T.bgCard }}>
                <div style={{ fontSize: T.fs.sm, fontWeight: 700, color: T.text, marginBottom: 2 }}>{p.name}</div>
                <div style={{ fontSize: T.fs.xs, color: T.textSub, marginBottom: 8 }}>{fmt(p.price)}원</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                  <button onClick={() => setQty(p.code, q - 1)} style={qtyBtn}>−</button>
                  <input value={q} onChange={e => setQty(p.code, parseInt(e.target.value) || 0)} style={{ ...inp, width: 44, textAlign: 'center', padding: '4px 2px' }} />
                  <button onClick={() => setQty(p.code, q + 1)} style={qtyBtn}>+</button>
                </div>
              </div>
            )
          })}
          {!filtered.length && <Empty msg="제품이 없습니다" />}
        </div>
      </div>

      {/* 장바구니 + 내 신청내역 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={card}>
          <div style={{ fontSize: T.fs.md, fontWeight: 800, marginBottom: 4 }}>구매신청</div>
          <div style={{ fontSize: T.fs.xs, color: T.textSub, marginBottom: 10 }}>{branchNameMap[myBranchId] || myCustomer?.name || '지점 미지정'}{defaultSupplier ? ` · 공급: ${defaultSupplier.name}` : ''}</div>
          {items.length ? items.map(it => (
            <div key={it.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: T.fs.sm, padding: '4px 0', borderBottom: `1px solid ${T.gray100}` }}>
              <span>{it.name} <span style={{ color: T.textMuted }}>×{it.qty}</span></span>
              <span style={{ fontWeight: 600 }}>{fmt(it.total)}</span>
            </div>
          )) : <div style={{ fontSize: T.fs.xs, color: T.textMuted, padding: '12px 0' }}>제품을 골라주세요</div>}
          {items.length > 0 && <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: T.fs.md, fontWeight: 800, color: T.primary }}><span>합계</span><span>{fmt(totals.grandTotal)}원</span></div>
            <input style={{ ...inp, marginTop: 10 }} placeholder="메모 (선택)" value={memo} onChange={e => setMemo(e.target.value)} />
            <Btn onClick={submit} disabled={submitting} style={{ width: '100%', marginTop: 10 }}>{submitting ? '신청 중…' : '구매신청'}</Btn>
            {defaultSupplier?.bank && <div style={{ fontSize: T.fs.xxs, color: T.textSub, marginTop: 8, textAlign: 'center' }}>입금계좌: {defaultSupplier.bank}</div>}
          </>}
        </div>

        <div style={card}>
          <div style={{ fontSize: T.fs.md, fontWeight: 800, marginBottom: 10 }}>내 신청내역</div>
          {myOrders.length ? myOrders.map(o => (
            <div key={o.id} style={{ padding: '8px 0', borderBottom: `1px solid ${T.gray100}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: T.fs.xs, color: T.textSub }}>{o.tx_date}</span>
                <StatusBadge status={o.status} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                <span style={{ fontSize: T.fs.sm }}>{(o.items || []).map(i => i.name).join(', ').slice(0, 30)}</span>
                <span style={{ fontSize: T.fs.sm, fontWeight: 700 }}>{fmt(o.grand_total)}</span>
              </div>
            </div>
          )) : <Empty msg="신청 내역이 없습니다" />}
        </div>
      </div>
    </div>
  )
}
const qtyBtn = { width: 26, height: 30, border: `1px solid ${T.border}`, borderRadius: T.radius.sm, background: T.bgCard, cursor: 'pointer', fontSize: 16, color: T.gray700, flexShrink: 0 }

/* ═══════════════ 본사 관리 뷰 ═══════════════ */
function AdminTrades(props) {
  const { orders, customers, userBranches, settings } = props
  const [adminMode, setAdminMode] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [pwInput, setPwInput] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [tab, setTab] = useState('orders')
  const adminPw = settings?.admin_password || '8008'

  // 관리자 모드 ON = 전 지점 관리 / OFF = 자기 지점만
  const ub = userBranches || []
  const scopedCustomers = adminMode ? customers : (ub.length ? customers.filter(c => c.branch_id && ub.includes(c.branch_id)) : customers)
  const scopedOrders = adminMode ? orders : (ub.length ? orders.filter(o => ub.includes(o.branch_id)) : orders)
  const scoped = { ...props, customers: scopedCustomers, orders: scopedOrders }

  const pending = scopedOrders.filter(o => o.status === 'requested').length
  const allTabs = [
    { id: 'orders', label: adminMode ? '주문접수' : '주문', icon: 'clipboard', badge: adminMode ? pending : 0 },
    { id: 'history', label: '거래내역', icon: 'chart' },
    { id: 'deposits', label: '입금내역', icon: 'banknote', admin: true },
    { id: 'customers', label: '거래처', icon: 'users', admin: true },
    { id: 'products', label: '제품', icon: 'pkg', admin: true },
    { id: 'suppliers', label: '공급자', icon: 'building', admin: true },
    { id: 'settings', label: '설정', icon: 'settings', admin: true },
  ]
  const tabs = allTabs.filter(t => !t.admin || adminMode)
  useEffect(() => { if (!tabs.find(t => t.id === tab)) setTab('orders') }, [adminMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const clickToggle = () => {
    if (adminMode) { setAdminMode(false); return }        // 끄기는 자유
    setPwInput(''); setPwErr(''); setPwOpen(true)          // 켜기는 비밀번호 확인
  }
  const submitPw = () => {
    if (pwInput === adminPw) { setAdminMode(true); setPwOpen(false); setPwInput('') }
    else setPwErr('비밀번호가 올바르지 않습니다')
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 12, background: adminMode ? T.primaryLt : 'transparent', borderRadius: T.radius.md, padding: adminMode ? '8px 12px' : 0 }}>
        {adminMode && <span style={{ flex: 1, fontSize: T.fs.xs, color: T.primaryDk, fontWeight: 700 }}>본사 관리자 모드 — 전 지점 · 제품·공급자·거래처·입금확인·배송</span>}
        <span style={{ fontSize: T.fs.sm, color: adminMode ? T.primaryDk : T.textSub, fontWeight: 700 }}>관리자 모드</span>
        <button onClick={clickToggle} title="본사 관리 기능 — 비밀번호 필요" style={{ position: 'relative', width: 46, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', background: adminMode ? T.primary : T.gray300, transition: 'background .15s', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: 3, left: adminMode ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
        </button>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: T.radius.full, border: 'none', cursor: 'pointer', fontSize: T.fs.sm, fontWeight: 700, background: tab === t.id ? T.primary : T.gray200, color: tab === t.id ? '#fff' : T.gray700 }}>
            <I name={t.icon} size={14} />{t.label}
            {t.badge > 0 && <span style={{ background: tab === t.id ? '#fff' : T.danger, color: tab === t.id ? T.primary : '#fff', borderRadius: T.radius.full, fontSize: 10, fontWeight: 800, padding: '1px 6px' }}>{t.badge}</span>}
          </button>
        ))}
      </div>
      {tab === 'orders' && <OrdersTab {...scoped} adminMode={adminMode} />}
      {tab === 'history' && <HistoryTab {...scoped} />}
      {tab === 'deposits' && <DepositsTab {...scoped} />}
      {tab === 'customers' && <CustomersTab {...scoped} />}
      {tab === 'products' && <ProductsTab {...scoped} />}
      {tab === 'suppliers' && <SuppliersTab {...scoped} />}
      {tab === 'settings' && <SettingsTab {...scoped} />}
      {pwOpen && (
        <Modal onClose={() => setPwOpen(false)} width={320}>
          <strong style={{ fontSize: T.fs.md }}>관리자 모드 비밀번호</strong>
          <p style={{ fontSize: T.fs.xs, color: T.textSub, margin: '6px 0 12px' }}>본사 관리 기능을 켜려면 비밀번호를 입력하세요.</p>
          <input type="password" autoFocus style={{ ...inp, marginBottom: 6 }} value={pwInput} onChange={e => { setPwInput(e.target.value); setPwErr('') }} onKeyDown={e => { if (e.key === 'Enter') submitPw() }} placeholder="비밀번호" />
          {pwErr && <div style={{ fontSize: T.fs.xs, color: T.danger, marginBottom: 6 }}>{pwErr}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <Btn variant="secondary" onClick={() => setPwOpen(false)}>취소</Btn>
            <Btn onClick={submitPw}>확인</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ── 주문접수 ── */
function OrdersTab({ bizId, orders, customersMap, suppliersMap, branchNameMap, reload, showToast, currentUser, suppliers, products, defaultSupplier, customers, userBranches, settings, adminMode }) {
  const [flt, setFlt] = useState('active') // active|all|requested|paid|shipped|done
  const [docOrder, setDocOrder] = useState(null) // {order, kind:'statement'|'tax'}
  const [formOpen, setFormOpen] = useState(true) // 새 주문 입력 폼 (원장용 — 처음부터 펼침)
  const [sel, setSel] = useState({}) // id->bool for excel

  const shown = orders.filter(o => {
    if (flt === 'all') return true
    if (flt === 'active') return o.status !== 'done' && o.status !== 'cancelled'
    return o.status === flt
  })
  const advance = async (o, next, extra = {}) => {
    await sb.update('trade_orders', o.id, { status: next, ...extra })
    reload('orders'); showToast('처리됨 ✓')
  }
  const setStatus = (o, next) => {
    const now = new Date().toISOString()
    if (next === 'paid') advance(o, 'paid', { paid_at: now, confirmed_by: currentUser?.name || '' })
    else if (next === 'shipped') advance(o, 'shipped', { shipped_at: now, shipped_by: currentUser?.name || '' })
    else if (next === 'done') advance(o, 'done', { done_at: now })
    else if (next === 'cancelled') advance(o, 'cancelled')
  }
  const selected = orders.filter(o => sel[o.id])
  const exportExcel = () => {
    const list = selected.length ? selected : shown
    if (!list.length) return showToast('내보낼 주문이 없습니다')
    exportHometaxExcel(list, { suppliersMap, customersMap })
    // 발행표시
    Promise.all(list.map(o => sb.update('trade_orders', o.id, { invoiced: true }))).then(() => reload('orders'))
    showToast(`홈택스 엑셀 ${list.length}건 생성 ✓`)
  }

  const FILTERS = [['active', '진행중'], ['requested', '신청'], ['paid', '입금확인'], ['shipped', '배송'], ['done', '완료'], ['all', '전체']]
  return (
    <div>
      {/* 새 주문 입력 — 원장용, 처음부터 펼쳐서 바로 입력 */}
      <div style={{ ...card, marginBottom: 14, padding: 14 }}>
        <button onClick={() => setFormOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
          <I name="plus" size={16} color={T.primary} />
          <span style={{ fontSize: T.fs.md, fontWeight: 800, color: T.text }}>{adminMode ? '새 주문 입력' : '구매 주문 신청'}</span>
          <span style={{ fontSize: T.fs.xs, color: T.textMuted }}>{adminMode ? '거래처·제품 선택 후 저장' : '제품 선택 후 신청'}</span>
          <div style={{ flex: 1 }} />
          <I name={formOpen ? 'chevU' : 'chevD'} size={16} color={T.gray600} />
        </button>
        {formOpen && (
          <div style={{ marginTop: 12 }}>
            <OrderForm bizId={bizId} suppliers={suppliers} products={products} customers={customers} defaultSupplier={defaultSupplier} currentUser={currentUser} userBranches={userBranches} settings={settings} branchNameMap={branchNameMap} adminMode={adminMode} showToast={showToast} onSaved={() => { reload('orders'); showToast(adminMode ? '주문 저장됨 ✓' : '구매신청 완료 ✓') }} />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {FILTERS.map(([v, l]) => (
          <button key={v} onClick={() => setFlt(v)} style={{ padding: '5px 12px', borderRadius: T.radius.full, border: `1px solid ${flt === v ? T.primary : T.border}`, background: flt === v ? T.primaryLt : T.bgCard, color: flt === v ? T.primaryDk : T.gray700, fontSize: T.fs.xs, fontWeight: 700, cursor: 'pointer' }}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        {adminMode && <Btn variant="outline" size="sm" onClick={exportExcel}><I name="download" size={13} />홈택스 엑셀{selected.length ? ` (${selected.length})` : ''}</Btn>}
      </div>

      {shown.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(o => (
            <div key={o.id} style={{ ...card, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {adminMode && <input type="checkbox" checked={!!sel[o.id]} onChange={e => setSel(s => ({ ...s, [o.id]: e.target.checked }))} />}
                <StatusBadge status={o.status} />
                <span style={{ fontSize: T.fs.sm, fontWeight: 800 }}>{customersMap[o.customer_id]?.name || branchNameMap[o.branch_id] || '-'}</span>
                <span style={{ fontSize: T.fs.xs, color: T.textSub }}>{o.tx_date} · {o.requested_by || ''}</span>
                {o.confirmed_by === '자동매칭' && <span style={{ fontSize: T.fs.xxs, color: T.info, fontWeight: 700 }}>입금 자동확인</span>}
                {o.invoiced && <span style={{ fontSize: T.fs.xxs, color: T.success, fontWeight: 700 }}>계산서발행</span>}
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: T.fs.md, fontWeight: 800, color: T.primary }}>{fmt(o.grand_total)}원</span>
              </div>
              <div style={{ fontSize: T.fs.xs, color: T.gray700, margin: '8px 0' }}>{(o.items || []).map(i => `${i.name}×${i.qty}`).join(', ')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {adminMode && o.status === 'requested' && <Btn size="sm" onClick={() => setStatus(o, 'paid')}><I name="banknote" size={13} />입금확인</Btn>}
                {adminMode && o.status === 'paid' && <Btn size="sm" onClick={() => setStatus(o, 'shipped')}><I name="pkg" size={13} />배송처리</Btn>}
                {adminMode && o.status === 'shipped' && <Btn size="sm" variant="secondary" onClick={() => setStatus(o, 'done')}><I name="check" size={13} />완료</Btn>}
                <Btn size="sm" variant="ghost" onClick={() => setDocOrder({ order: o, kind: 'statement' })}>거래명세서</Btn>
                {adminMode && <Btn size="sm" variant="ghost" onClick={() => setDocOrder({ order: o, kind: 'tax' })}>세금계산서</Btn>}
                {adminMode && o.status !== 'cancelled' && o.status !== 'done' && <Btn size="sm" variant="ghost" style={{ color: T.danger, marginLeft: 'auto' }} onClick={() => setStatus(o, 'cancelled')}>취소</Btn>}
              </div>
            </div>
          ))}
        </div>
      ) : <Empty msg="해당 주문이 없습니다" />}

      {docOrder && <DocModal {...docOrder} supplier={suppliersMap[docOrder.order.supplier_id]} customer={customersMap[docOrder.order.customer_id]} onClose={() => setDocOrder(null)} showToast={showToast} />}
    </div>
  )
}

/* ── 거래명세서 / 세금계산서 모달 ── */
function DocModal({ order, kind, supplier, customer, onClose, showToast }) {
  const ref = useRef(null)
  const html = kind === 'statement' ? buildStatementHTML({ order, supplier, customer }) : buildTaxInvoiceHTML({ order, supplier, customer })
  const title = kind === 'statement' ? '거래명세서' : '세금계산서'
  const capture = async () => {
    const el = ref.current
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#fff', useCORS: true, logging: false })
    return canvas
  }
  const copyImg = async () => {
    try { const c = await capture(); const blob = await new Promise(r => c.toBlob(r, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); showToast('클립보드 복사됨 ✓ (붙여넣기)') }
    catch (e) { console.error(e); saveJpg() }
  }
  const saveJpg = async () => {
    const c = await capture()
    c.toBlob(b => { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${title}_${customer?.name || ''}_${order.tx_date}.jpg`; a.click(); URL.revokeObjectURL(u) }, 'image/jpeg', 0.95)
    showToast('JPG 저장됨 ✓')
  }
  return (
    <Modal onClose={onClose} width={820}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <strong style={{ fontSize: T.fs.md }}>{title}</strong>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: T.textMuted }}>×</button>
      </div>
      <div ref={ref} style={{ background: '#fff', padding: 24 }} dangerouslySetInnerHTML={{ __html: html }} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <Btn onClick={copyImg}><I name="clipboard" size={14} />복사</Btn>
        <Btn variant="secondary" onClick={saveJpg}><I name="download" size={14} />JPG</Btn>
        <Btn variant="outline" onClick={() => printHTML(html, title)}><I name="printer" size={14} />인쇄</Btn>
      </div>
    </Modal>
  )
}

/* ── 새 주문 입력 폼 (원장 신청 / 관리자 입력 겸용) ── */
function OrderForm({ bizId, suppliers, products, customers, defaultSupplier, currentUser, userBranches, settings, branchNameMap, adminMode, showToast, onSaved }) {
  // 단일 거래처 계정은 자동 선택, 복수면 직접 선택
  const autoCust = customers.length === 1
    ? customers[0].id
    : (() => { const mine = (userBranches || []).length ? customers.filter(c => c.branch_id && userBranches.includes(c.branch_id)) : []; return mine.length === 1 ? mine[0].id : '' })()
  const [supId, setSupId] = useState(defaultSupplier?.id || suppliers[0]?.id || '')
  const [custId, setCustId] = useState(autoCust)
  const [txDate, setTxDate] = useState(todayStr())
  const [taxType, setTaxType] = useState('별도')
  const [memo, setMemo] = useState('')
  const [cart, setCart] = useState({})
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const items = Object.entries(cart).filter(([, q]) => q > 0).map(([code, q]) => { const p = products.find(x => x.code === code); return p ? lineOf(p, q) : null }).filter(Boolean)
  const totals = calcTotals(items)
  const save = async () => {
    if (!custId) return showToast('거래처를 선택하세요')
    if (!items.length) return showToast('제품을 선택하세요')
    setSaving(true)
    const cust = customers.find(c => c.id === custId)
    const row = {
      id: genId('to'), business_id: bizId, order_no: `S${txDate.replace(/-/g, '')}-${String(Date.now()).slice(-4)}`,
      supplier_id: supId, customer_id: custId, branch_id: cust?.branch_id || null,
      tx_date: txDate, tax_type: taxType, items,
      total_qty: totals.totalQty, total_supply: totals.totalSupply, total_tax: totals.totalTax, grand_total: totals.grandTotal,
      memo,
      // 관리자 모드(본사) = 입금확인(paid)으로 바로 기록 / 원장 모드 = 구매신청(requested)
      ...(adminMode
        ? { status: 'paid', requested_by: currentUser?.name || '(본사)', confirmed_by: currentUser?.name || '', paid_at: new Date().toISOString() }
        : { status: 'requested', requested_by: currentUser?.name || '', requested_at: new Date().toISOString() }),
    }
    await sb.insert('trade_orders', row)
    // 원장 구매신청 → 본사 담당자에게 SMS 알림
    if (!adminMode) {
      try {
        const phone = normPhone(settings?.manager_phone)
        if (settings?.notify_enabled !== false && phone) {
          const bn = (branchNameMap && cust?.branch_id && branchNameMap[cust.branch_id]) || cust?.name || '지점'
          const msg = `[거래관리] 구매신청\n${bn} / ${currentUser?.name || ''}\n금액: ${fmt(totals.grandTotal)}원 (${items.length}품목)\n블리스 거래관리에서 확인하세요.`
          await callSendSms(cust?.branch_id || null, msg, [{ phone }])
        }
      } catch (e) { console.warn('[trade] 알림 SMS 실패', e) }
    }
    setCart({}); setMemo(''); setCustId(autoCust); setSearch('')
    setSaving(false)
    onSaved()
  }
  const filtered = products.filter(p => p.active !== false && (!search || p.name.includes(search)))
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: T.fs.xxs, color: T.textSub, fontWeight: 700 }}>공급자<select style={{ ...inp, marginTop: 3 }} value={supId} onChange={e => setSupId(e.target.value)}>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label style={{ fontSize: T.fs.xxs, color: custId ? T.textSub : T.danger, fontWeight: 700 }}>거래처 *<select style={{ ...inp, marginTop: 3, borderColor: custId ? T.border : T.danger }} value={custId} onChange={e => setCustId(e.target.value)}><option value="">거래처를 선택하세요</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label style={{ fontSize: T.fs.xxs, color: T.textSub, fontWeight: 700 }}>거래일자<input type="date" style={{ ...inp, marginTop: 3 }} value={txDate} onChange={e => setTxDate(e.target.value)} /></label>
        <label style={{ fontSize: T.fs.xxs, color: T.textSub, fontWeight: 700 }}>과세<select style={{ ...inp, marginTop: 3 }} value={taxType} onChange={e => setTaxType(e.target.value)}><option>별도</option><option>포함</option><option>영세</option><option>면세</option></select></label>
      </div>
      <input style={{ ...inp, marginBottom: 8 }} placeholder="제품 검색" value={search} onChange={e => setSearch(e.target.value)} />
      <div style={{ maxHeight: 240, overflowY: 'auto', border: `1px solid ${T.border}`, borderRadius: T.radius.md, padding: 8, marginBottom: 8 }}>
        {filtered.map(p => {
          const q = cart[p.code] || 0
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 4px', background: q > 0 ? T.primaryLt : 'transparent', borderRadius: T.radius.sm }}>
              <span style={{ fontSize: T.fs.sm }}>{p.name} <span style={{ color: T.textMuted }}>{fmt(p.price)}원</span></span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => setCart(c => ({ ...c, [p.code]: Math.max(0, (c[p.code] || 0) - 1) }))} style={qtyBtn}>−</button>
                <input value={q} onChange={e => setCart(c => ({ ...c, [p.code]: Math.max(0, parseInt(e.target.value) || 0) }))} style={{ ...inp, width: 44, textAlign: 'center', padding: '4px 2px' }} />
                <button onClick={() => setCart(c => ({ ...c, [p.code]: (c[p.code] || 0) + 1 }))} style={qtyBtn}>+</button>
              </div>
            </div>
          )
        })}
        {!filtered.length && <div style={{ fontSize: T.fs.xs, color: T.textMuted, textAlign: 'center', padding: 12 }}>제품이 없습니다</div>}
      </div>
      <input style={{ ...inp, marginBottom: 8 }} placeholder="메모 (선택)" value={memo} onChange={e => setMemo(e.target.value)} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: T.fs.sm, color: T.textSub }}>공급가액 <b style={{ color: T.text }}>{fmt(totals.totalSupply)}</b></span>
          <span style={{ fontSize: T.fs.sm, color: T.textSub }}>부가세 <b style={{ color: T.text }}>{fmt(totals.totalTax)}</b></span>
          <span style={{ fontSize: T.fs.lg, fontWeight: 800, color: T.primary }}>합계 {fmt(totals.grandTotal)}원</span>
        </div>
        <Btn onClick={save} disabled={saving} size="lg">{saving ? '저장 중…' : '주문 저장'}</Btn>
      </div>
    </>
  )
}

/* ── 입금내역 (도매 입금 — 네추럴룩/테라포트 계좌) ── */
function DepositsTab({ bizId, orders, customersMap, showToast, reload, currentUser }) {
  const [deps, setDeps] = useState(null)
  const [flt, setFlt] = useState('all')
  const [matchFor, setMatchFor] = useState(null)
  const load = () => sb.get('bank_deposits', `&business_id=eq.${bizId}&bid=is.null&order=sms_sent_at.desc&limit=200`).then(setDeps)
  useEffect(() => { load() }, [bizId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (deps === null) return <div style={{ padding: 30, textAlign: 'center', color: T.textSub }}>불러오는 중…</div>
  const shown = deps.filter(d => flt === 'all' ? (d.status !== 'ignored' && d.status !== 'card') : d.status === flt)
  const orderById = Object.fromEntries(orders.map(o => [o.id, o]))
  const reqOrders = orders.filter(o => o.status === 'requested')
  const doMatch = async (d, o) => {
    await sb.update('trade_orders', o.id, { status: 'paid', paid_at: new Date().toISOString(), confirmed_by: currentUser?.name || '수동매칭', matched_deposit_id: d.id })
    await sb.update('bank_deposits', d.id, { status: 'matched', deposit_kind: 'trade', matched_trade_order_id: o.id, matched_at: new Date().toISOString(), matched_by: currentUser?.name || '수동' })
    setMatchFor(null); load(); reload('orders'); showToast('매칭 완료 ✓')
  }
  const unmatch = async (d) => {
    if (d.matched_trade_order_id) await sb.update('trade_orders', d.matched_trade_order_id, { status: 'requested', paid_at: null, confirmed_by: '', matched_deposit_id: null })
    await sb.update('bank_deposits', d.id, { status: 'pending', deposit_kind: null, matched_trade_order_id: null })
    load(); reload('orders'); showToast('매칭 해제됨')
  }
  const ignore = async (d) => { await sb.update('bank_deposits', d.id, { status: 'ignored' }); load(); showToast('무시됨') }
  const badge = (s) => ({ pending: ['미매칭', T.warning, T.warningLt], matched: ['매칭됨', T.successDk, T.successLt], ignored: ['무시', T.gray500, T.gray200] }[s] || [s, T.gray600, T.gray200])
  const FILTERS = [['all', '전체'], ['pending', '미매칭'], ['matched', '매칭됨'], ['ignored', '무시']]
  return (
    <div>
      <div style={{ fontSize: T.fs.xs, color: T.textSub, marginBottom: 10 }}>네추럴룩·테라포트 계좌 입금(도매). 입금자+금액이 맞으면 신청 주문이 자동 입금확인됩니다.</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {FILTERS.map(([v, l]) => <button key={v} onClick={() => setFlt(v)} style={{ padding: '5px 12px', borderRadius: T.radius.full, border: `1px solid ${flt === v ? T.primary : T.border}`, background: flt === v ? T.primaryLt : T.bgCard, color: flt === v ? T.primaryDk : T.gray700, fontSize: T.fs.xs, fontWeight: 700, cursor: 'pointer' }}>{l}</button>)}
      </div>
      {shown.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(d => {
            const b = badge(d.status); const mo = d.matched_trade_order_id && orderById[d.matched_trade_order_id]
            return (
              <div key={d.id} style={{ ...card, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: T.fs.xxs, fontWeight: 700, padding: '3px 9px', borderRadius: T.radius.full, color: b[1], background: b[2] }}>{b[0]}</span>
                  <span style={{ fontSize: T.fs.sm, fontWeight: 800 }}>{d.transferer_name || '-'}</span>
                  <span style={{ fontSize: T.fs.xs, color: T.textSub }}>{(d.sms_sent_at || '').slice(0, 10)} · {d.source === 'hana_sms' ? '하나' : d.source === 'sh_sms' ? '수협' : d.source === 'woori_sms' ? '우리' : 'KB'}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: T.fs.md, fontWeight: 800, color: T.primary }}>{fmt(d.amount)}원</span>
                </div>
                {mo && <div style={{ fontSize: T.fs.xs, color: T.successDk, marginTop: 6 }}>→ {customersMap[mo.customer_id]?.name || '-'} 주문({fmt(mo.grand_total)}원) 매칭{d.matched_by === 'trade_auto' ? ' (자동)' : ''}</div>}
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {d.status === 'pending' && <Btn size="sm" onClick={() => setMatchFor(d)}><I name="handshake" size={13} />주문 매칭</Btn>}
                  {d.status === 'pending' && <Btn size="sm" variant="ghost" style={{ color: T.danger }} onClick={() => ignore(d)}>무시</Btn>}
                  {d.status === 'matched' && <Btn size="sm" variant="ghost" onClick={() => unmatch(d)}>매칭 해제</Btn>}
                  {d.status === 'ignored' && <Btn size="sm" variant="ghost" onClick={() => sb.update('bank_deposits', d.id, { status: 'pending' }).then(load)}>되돌리기</Btn>}
                </div>
              </div>
            )
          })}
        </div>
      ) : <Empty msg="입금 내역이 없습니다" />}
      {matchFor && (
        <Modal onClose={() => setMatchFor(null)} width={460}>
          <strong style={{ fontSize: T.fs.md }}>주문에 매칭</strong>
          <div style={{ fontSize: T.fs.xs, color: T.textSub, margin: '6px 0 12px' }}>{matchFor.transferer_name} · {fmt(matchFor.amount)}원 입금을 신청 주문에 연결</div>
          <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {reqOrders.length ? reqOrders.map(o => (
              <button key={o.id} onClick={() => doMatch(matchFor, o)} style={{ textAlign: 'left', border: `1px solid ${o.grand_total === matchFor.amount ? T.primary : T.border}`, background: o.grand_total === matchFor.amount ? T.primaryLt : T.bgCard, borderRadius: T.radius.md, padding: '8px 10px', cursor: 'pointer' }}>
                <div style={{ fontSize: T.fs.sm, fontWeight: 700 }}>{customersMap[o.customer_id]?.name || '-'} · {fmt(o.grand_total)}원{o.grand_total === matchFor.amount ? ' (금액일치)' : ''}</div>
                <div style={{ fontSize: T.fs.xxs, color: T.textSub }}>{o.tx_date} · {o.requested_by || ''}</div>
              </button>
            )) : <Empty msg="신청 대기 주문이 없습니다" />}
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ── 거래내역 ── */
function HistoryTab({ orders, customersMap, suppliersMap, showToast }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [cust, setCust] = useState('')
  const custNames = [...new Set(orders.map(o => customersMap[o.customer_id]?.name).filter(Boolean))]
  const list = orders.filter(o => {
    if (from && o.tx_date < from) return false
    if (to && o.tx_date > to) return false
    if (cust && customersMap[o.customer_id]?.name !== cust) return false
    return true
  })
  const g = list.reduce((a, o) => ({ s: a.s + (o.total_supply || 0), t: a.t + (o.total_tax || 0), gg: a.gg + (o.grand_total || 0) }), { s: 0, t: 0, gg: 0 })
  return (
    <div>
      <div style={{ ...card, padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="date" style={{ ...inp, width: 150 }} value={from} onChange={e => setFrom(e.target.value)} />
        <span style={{ color: T.textMuted }}>~</span>
        <input type="date" style={{ ...inp, width: 150 }} value={to} onChange={e => setTo(e.target.value)} />
        <select style={{ ...inp, width: 160 }} value={cust} onChange={e => setCust(e.target.value)}><option value="">전체 거래처</option>{custNames.map(n => <option key={n}>{n}</option>)}</select>
        <div style={{ flex: 1 }} />
        <Btn variant="outline" size="sm" onClick={() => { if (!list.length) return showToast('내역 없음'); exportHistoryExcel(list, { customersMap }) }}><I name="download" size={13} />엑셀</Btn>
      </div>
      <div style={{ fontSize: T.fs.sm, color: T.gray700, marginBottom: 8 }}>{list.length}건 · 공급 {fmt(g.s)} · 세액 {fmt(g.t)} · <strong style={{ color: T.primary }}>합계 {fmt(g.gg)}</strong></div>
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: T.fs.sm }}>
          <thead><tr style={{ background: T.gray100 }}>{['일자', '거래처', '상태', '품목', '공급가액', '세액', '합계'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: h === '일자' || h === '거래처' || h === '상태' ? 'left' : 'right', fontSize: T.fs.xs, color: T.gray700 }}>{h}</th>)}</tr></thead>
          <tbody>
            {list.map(o => (
              <tr key={o.id} style={{ borderTop: `1px solid ${T.gray100}` }}>
                <td style={{ padding: '8px 10px' }}>{o.tx_date}</td>
                <td style={{ padding: '8px 10px' }}>{customersMap[o.customer_id]?.name || '-'}</td>
                <td style={{ padding: '8px 10px' }}><StatusBadge status={o.status} /></td>
                <td style={{ padding: '8px 10px' }}>{(o.items || []).length}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmt(o.total_supply)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: T.textSub }}>{fmt(o.total_tax)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>{fmt(o.grand_total)}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} style={{ padding: 30, textAlign: 'center', color: T.textMuted }}>내역 없음</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── 거래처 ── */
function CustomersTab({ bizId, customers, branchNameMap, data, reload, showToast }) {
  const [edit, setEdit] = useState(null)
  const blank = { business_id: bizId, name: '', rep: '', biz_no: '', phone: '', mobile: '', fax: '', address: '', biz_type: '', biz_item: '', type: '매출처', branch_id: '', open_date: '' }
  const save = async () => {
    if (!edit.name?.trim()) return alert('거래처명을 입력하세요')
    const row = { ...edit }
    if (!row.id) { row.id = genId('tc'); await sb.insert('trade_customers', row) }
    else await sb.update('trade_customers', row.id, row)
    setEdit(null); reload(); showToast('저장됨 ✓')
  }
  const del = async (c) => { if (!confirm(`"${c.name}" 삭제?`)) return; await sb.del('trade_customers', c.id); reload(); showToast('삭제됨') }
  const branches = data?.branches || []
  return (
    <div>
      <Btn size="sm" onClick={() => setEdit({ ...blank })} style={{ marginBottom: 12 }}><I name="plus" size={13} />거래처 추가</Btn>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10 }}>
        {customers.map(c => (
          <div key={c.id} style={{ ...card, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div>
                <div style={{ fontSize: T.fs.sm, fontWeight: 800 }}>{c.name}</div>
                <div style={{ fontSize: T.fs.xs, color: T.textSub }}>{c.rep} · {c.biz_no || '사업자번호 없음'}</div>
              </div>
              <span style={{ fontSize: T.fs.xxs, fontWeight: 700, color: c.type === '매입처' ? T.orange : T.info }}>{c.type}</span>
            </div>
            {c.branch_id && <div style={{ fontSize: T.fs.xxs, color: T.primary, marginTop: 4 }}>지점연동: {branchNameMap[c.branch_id] || c.branch_id}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <Btn size="sm" variant="ghost" onClick={() => setEdit({ ...c })}>수정</Btn>
              <Btn size="sm" variant="ghost" style={{ color: T.danger }} onClick={() => del(c)}>삭제</Btn>
            </div>
          </div>
        ))}
      </div>
      {edit && (
        <Modal onClose={() => setEdit(null)} width={560}>
          <strong style={{ fontSize: T.fs.md }}>{edit.id ? '거래처 수정' : '거래처 추가'}</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '12px 0' }}>
            {[['name', '거래처명 *'], ['rep', '대표자'], ['biz_no', '사업자등록번호'], ['phone', '전화'], ['mobile', '휴대폰'], ['fax', '팩스'], ['biz_type', '업태'], ['biz_item', '종목']].map(([k, ph]) => (
              <input key={k} style={inp} placeholder={ph} value={edit[k] || ''} onChange={e => setEdit(s => ({ ...s, [k]: e.target.value }))} />
            ))}
            <input style={{ ...inp, gridColumn: '1/3' }} placeholder="주소" value={edit.address || ''} onChange={e => setEdit(s => ({ ...s, address: e.target.value }))} />
            <select style={inp} value={edit.type} onChange={e => setEdit(s => ({ ...s, type: e.target.value }))}><option>매출처</option><option>매입처</option></select>
            <select style={inp} value={edit.branch_id || ''} onChange={e => setEdit(s => ({ ...s, branch_id: e.target.value }))}><option value="">지점 연동 안함</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><Btn variant="secondary" onClick={() => setEdit(null)}>취소</Btn><Btn onClick={save}>저장</Btn></div>
        </Modal>
      )}
    </div>
  )
}

/* ── 제품 ── */
function ProductsTab({ bizId, products, reload, showToast }) {
  const [edit, setEdit] = useState(null)
  const nextCode = () => { const nums = products.map(p => parseInt((p.code || '').replace('P', ''))).filter(n => !isNaN(n)); return 'P' + String(Math.max(0, ...nums) + 1).padStart(3, '0') }
  const save = async () => {
    if (!edit.name?.trim()) return alert('품명을 입력하세요')
    const row = { ...edit, price: parseInt(edit.price) || 0, spec: edit.spec || '1', unit: edit.unit || '1' }
    if (!row.id) { row.id = genId('tp'); row.code = row.code || nextCode(); row.business_id = bizId; row.sort = products.length; await sb.insert('trade_products', row) }
    else await sb.update('trade_products', row.id, row)
    setEdit(null); reload(); showToast('저장됨 ✓')
  }
  const del = async (p) => { if (!confirm(`"${p.name}" 삭제?`)) return; await sb.del('trade_products', p.id); reload(); showToast('삭제됨') }
  return (
    <div>
      <Btn size="sm" onClick={() => setEdit({ name: '', spec: '1', unit: '1', price: '', active: true })} style={{ marginBottom: 12 }}><I name="plus" size={13} />제품 추가</Btn>
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: T.fs.sm }}>
          <thead><tr style={{ background: T.gray100 }}>{['코드', '품명', '규격', '단가', ''].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: h === '단가' ? 'right' : 'left', fontSize: T.fs.xs, color: T.gray700 }}>{h}</th>)}</tr></thead>
          <tbody>
            {products.map(p => (
              <tr key={p.id} style={{ borderTop: `1px solid ${T.gray100}` }}>
                <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: T.textSub }}>{p.code}</td>
                <td style={{ padding: '8px 10px', fontWeight: 600 }}>{p.name}{p.active === false && <span style={{ fontSize: T.fs.xxs, color: T.textMuted }}> (숨김)</span>}</td>
                <td style={{ padding: '8px 10px' }}>{p.spec}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmt(p.price)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Btn size="sm" variant="ghost" onClick={() => setEdit({ ...p })}>수정</Btn>
                  <Btn size="sm" variant="ghost" style={{ color: T.danger }} onClick={() => del(p)}>삭제</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal onClose={() => setEdit(null)} width={420}>
          <strong style={{ fontSize: T.fs.md }}>{edit.id ? '제품 수정' : '제품 추가'}</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '12px 0' }}>
            <input style={{ ...inp, gridColumn: '1/3' }} placeholder="품명 *" value={edit.name || ''} onChange={e => setEdit(s => ({ ...s, name: e.target.value }))} />
            <input style={inp} type="number" placeholder="단가 *" value={edit.price} onChange={e => setEdit(s => ({ ...s, price: e.target.value }))} />
            <input style={inp} placeholder="규격 (기본 1)" value={edit.spec || ''} onChange={e => setEdit(s => ({ ...s, spec: e.target.value }))} />
            <label style={{ gridColumn: '1/3', display: 'flex', alignItems: 'center', gap: 6, fontSize: T.fs.sm, color: T.gray700 }}><input type="checkbox" checked={edit.active !== false} onChange={e => setEdit(s => ({ ...s, active: e.target.checked }))} />지점 신청 목록에 표시</label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><Btn variant="secondary" onClick={() => setEdit(null)}>취소</Btn><Btn onClick={save}>저장</Btn></div>
        </Modal>
      )}
    </div>
  )
}

/* ── 공급자 ── */
function SuppliersTab({ suppliers, reload, showToast, settings, bizId }) {
  const [edit, setEdit] = useState(null)
  const save = async () => {
    if (!edit.name?.trim()) return alert('공급자명을 입력하세요')
    if (!edit.id) { edit.id = genId('ts'); edit.business_id = bizId; await sb.insert('trade_suppliers', edit) }
    else await sb.update('trade_suppliers', edit.id, edit)
    setEdit(null); reload(); showToast('저장됨 ✓')
  }
  return (
    <div>
      <Btn size="sm" onClick={() => setEdit({ name: '', rep: '', biz_no: '', address: '', biz_type: '', biz_item: '', bank: '' })} style={{ marginBottom: 12 }}><I name="plus" size={13} />공급자 추가</Btn>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 10 }}>
        {suppliers.map(s => (
          <div key={s.id} style={{ ...card }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: T.fs.md, fontWeight: 800 }}>{s.name}{settings?.default_supplier_id === s.id && <span style={{ fontSize: T.fs.xxs, color: T.primary, marginLeft: 6 }}>기본</span>}</div>
              <Btn size="sm" variant="ghost" onClick={() => setEdit({ ...s })}>수정</Btn>
            </div>
            <div style={{ fontSize: T.fs.xs, color: T.textSub, marginTop: 6, lineHeight: 1.7 }}>
              대표 {s.rep || '-'} · {s.biz_no || '사업자번호 미입력'}<br />{s.address || '주소 미입력'}<br />계좌: {s.bank || '미입력'}
            </div>
          </div>
        ))}
      </div>
      {edit && (
        <Modal onClose={() => setEdit(null)} width={520}>
          <strong style={{ fontSize: T.fs.md }}>{edit.id ? '공급자 수정' : '공급자 추가'}</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '12px 0' }}>
            <input style={inp} placeholder="공급자명 *" value={edit.name || ''} onChange={e => setEdit(s => ({ ...s, name: e.target.value }))} />
            <input style={inp} placeholder="대표자" value={edit.rep || ''} onChange={e => setEdit(s => ({ ...s, rep: e.target.value }))} />
            <input style={inp} placeholder="사업자등록번호" value={edit.biz_no || ''} onChange={e => setEdit(s => ({ ...s, biz_no: e.target.value }))} />
            <input style={inp} placeholder="업태" value={edit.biz_type || ''} onChange={e => setEdit(s => ({ ...s, biz_type: e.target.value }))} />
            <input style={inp} placeholder="종목" value={edit.biz_item || ''} onChange={e => setEdit(s => ({ ...s, biz_item: e.target.value }))} />
            <input style={inp} placeholder="입금계좌" value={edit.bank || ''} onChange={e => setEdit(s => ({ ...s, bank: e.target.value }))} />
            <input style={{ ...inp, gridColumn: '1/3' }} placeholder="사업장 주소" value={edit.address || ''} onChange={e => setEdit(s => ({ ...s, address: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><Btn variant="secondary" onClick={() => setEdit(null)}>취소</Btn><Btn onClick={save}>저장</Btn></div>
        </Modal>
      )}
    </div>
  )
}

/* ── 설정 ── */
function SettingsTab({ bizId, settings, suppliers, reload, showToast }) {
  const [form, setForm] = useState(settings || { business_id: bizId, manager_name: '', manager_phone: '', notify_enabled: true, default_supplier_id: '' })
  const save = async () => {
    const row = { ...form, business_id: bizId, updated_at: new Date().toISOString() }
    await sb.upsert('trade_settings', [row])
    reload(); showToast('저장됨 ✓')
  }
  return (
    <div style={{ maxWidth: 520 }}>
      <div style={card}>
        <div style={{ fontSize: T.fs.md, fontWeight: 800, marginBottom: 12 }}>구매신청 알림</div>
        <label style={lbl}>담당자 이름</label>
        <input style={{ ...inp, marginBottom: 10 }} value={form.manager_name || ''} onChange={e => setForm(s => ({ ...s, manager_name: e.target.value }))} placeholder="예: 권신영" />
        <label style={lbl}>담당자 휴대폰 (신청 시 SMS 수신)</label>
        <input style={{ ...inp, marginBottom: 10 }} value={form.manager_phone || ''} onChange={e => setForm(s => ({ ...s, manager_phone: e.target.value }))} placeholder="01000000000" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: T.fs.sm, color: T.gray700, marginBottom: 14 }}>
          <input type="checkbox" checked={form.notify_enabled !== false} onChange={e => setForm(s => ({ ...s, notify_enabled: e.target.checked }))} />구매신청 시 담당자에게 문자 발송
        </label>
        <label style={lbl}>기본 공급자</label>
        <select style={{ ...inp, marginBottom: 14 }} value={form.default_supplier_id || ''} onChange={e => setForm(s => ({ ...s, default_supplier_id: e.target.value }))}>
          <option value="">선택</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Btn onClick={save}>저장</Btn>
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <div style={{ fontSize: T.fs.md, fontWeight: 800, marginBottom: 4 }}>관리자 모드 비밀번호</div>
        <div style={{ fontSize: T.fs.xs, color: T.textSub, marginBottom: 12 }}>관리자 모드를 켤 때 묻는 비밀번호입니다. (초기값 8008)</div>
        <label style={lbl}>비밀번호</label>
        <input style={{ ...inp, marginBottom: 14 }} value={form.admin_password || ''} onChange={e => setForm(s => ({ ...s, admin_password: e.target.value }))} placeholder="8008" />
        <Btn onClick={save}>저장</Btn>
      </div>
    </div>
  )
}
const lbl = { display: 'block', fontSize: T.fs.xs, fontWeight: 700, color: T.textSub, marginBottom: 4 }
