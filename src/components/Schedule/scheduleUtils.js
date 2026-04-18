import { STATUS, isSupport, addDays, getDow0Mon } from './scheduleConstants'

export function validateSch(schData, empList, days, ruleConfig, empSettings) {
  const v = []
  const getV = (id, ds) => schData[id]?.[ds] ?? ''
  const isWorkV = (id, ds) => {
    const s = getV(id, ds)
    return s === STATUS.WORK || (s && s.startsWith('지원')) || s === STATUS.SHARE
  }

  // 이월(isNext) 날짜는 검증 제외
  ;(days || []).filter(d => !d.isNext).forEach(day => {
    const assigned = empList.filter(e => getV(e.id, day.ds) !== '')
    if (assigned.length === 0) return

    const c = empList.filter(e => {
      if (e.isMale) return false
      if (e.isFreelancer) return false
      const s = getV(e.id, day.ds)
      return s === STATUS.WORK || isSupport(s) || s === STATUS.SHARE
    }).length
    if (c > 0 && c < ruleConfig.minWork) v.push(`${day.d}일 근무${c}명(최소${ruleConfig.minWork})`)
    if (c > ruleConfig.maxWork) v.push(`${day.d}일 근무${c}명(최대${ruleConfig.maxWork}초과)`)

    const offC = empList.filter(e =>
      !e.isMale && !(e.isFreelancer || empSettings[e.id]?.isFreelancer) &&
      ['휴무','휴무(꼭)','무급'].includes(getV(e.id, day.ds))
    ).length
    if (offC > ruleConfig.maxDailyOff) v.push(`${day.d}일 휴무${offC}명(최대${ruleConfig.maxDailyOff}초과)`)

    if (day.dow === 6) {
      const mw = empList.filter(e => e.isMale && getV(e.id, day.ds) === STATUS.WORK).length
      if (mw > 1) v.push(`${day.d}일(일) 남자직원 ${mw}명 동시근무`)
    }
  })

  empList.filter(e => !e.isOwner && !(e.isFreelancer || empSettings[e.id]?.isFreelancer)).forEach(emp => {
    let streak = 0, streakStart = null
    days.forEach(day => {
      if (isWorkV(emp.id, day.ds)) {
        if (streak === 0) streakStart = day.d
        streak++
        if (streak === ruleConfig.maxConsecWork + 1)
          v.push(`${emp.name} ${streakStart}일~ 연속근무${streak}일 초과`)
      } else { streak = 0 }
    })
  })

  if (ruleConfig.biweeklyConsecOff) {
    const realDays = (days || []).filter(d => !d.isNext)
    const activeWks = []
    let wk = []
    realDays.forEach(day => {
      wk.push(day)
      if (day.dow === 6) { activeWks.push(wk); wk = [] }
    })
    if (wk.length) activeWks.push(wk)
    const validWks = activeWks.filter(w => w.filter(d => !d.isNext).length >= 2)
    for (let i = 0; i < validWks.length; i += 2) {
      const block = validWks.slice(i, Math.min(i+2, validWks.length))
      const blockDays = block.flatMap(w => w)
      empList.filter(e => !e.isMale && !e.isOwner).forEach(emp => {
        const hasConsec = blockDays.some((d, idx) => {
          if (idx === 0) return false
          const prev = blockDays[idx-1]
          const isOff = (ds) => ['휴무','휴무(꼭)','무급'].includes(getV(emp.id, ds))
          return addDays(prev.ds, 1) === d.ds && isOff(prev.ds) && isOff(d.ds)
        })
        if (!hasConsec) v.push(`${emp.name} ${blockDays[0].d}일~${blockDays[blockDays.length-1].d}일 2주연속휴무없음`)
      })
    }
  }
  return v
}

export function exportCSV(allEmployees, days, getS, year, month, BRANCHES_SCH, DNAMES) {
  const header = ['직원','지점',...days.map(d => `${d.d}(${DNAMES[d.dow]})`)]
  const rows = allEmployees.map(e => [
    e.name,
    BRANCHES_SCH.find(b => b.id === e.branch)?.name || '',
    ...days.map(d => getS(e.id, d.ds) || '근무')
  ])
  const csv = [header,...rows].map(r => r.join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' }))
  a.download = `근무표_${year}년${month+1}월.csv`
  a.click()
}
