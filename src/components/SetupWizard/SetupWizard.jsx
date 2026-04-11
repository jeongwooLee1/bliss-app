import { useState, useEffect, useRef } from 'react'
import { T } from '../../lib/constants'
import { STEPS, VISION_PROMPT, getSourceColor } from './wizardSteps'

const uid = () => Math.random().toString(36).slice(2, 13);

export default function SetupWizard({ bizId, bizName, geminiKey: propKey, sb, data, setData, onComplete, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [progress, setProgress] = useState({ completedSteps: [], skippedSteps: [], data: {} });
  const [geminiKey, setGeminiKey] = useState(propKey || '');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [parsedData, setParsedData] = useState(null);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const dragCounter = useRef(0);

  useEffect(() => {
    addBot(STEPS[0].greeting);
  }, []); // eslint-disable-line

  useEffect(() => {
    if (scrollRef.current) setTimeout(() => { scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, 50);
  }, [messages]);

  const addBot = (text) => setMessages(p => [...p, { role: 'bot', text, ts: Date.now() }]);
  const addUser = (text, images) => setMessages(p => [...p, { role: 'user', text, images, ts: Date.now() }]);

  // ── 파일 처리 (이미지 / 텍스트 / 엑셀) ──
  const isImageFile = (f) => f.type?.startsWith('image/');
  const isTextFile = (f) => f.type?.startsWith('text/') || /\.(txt|csv|tsv|md)$/i.test(f.name);
  const isExcelFile = (f) => /\.(xlsx?|xls)$/i.test(f.name) || f.type?.includes('spreadsheet') || f.type?.includes('excel');

  const readFileAsText = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(file, 'UTF-8');
  });

  const readExcelAsText = async (file) => {
    // XLSX CDN 동적 로드
    if (!window.XLSX) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const data = await file.arrayBuffer();
    const wb = window.XLSX.read(data, { type: 'array' });
    const lines = [];
    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      const csv = window.XLSX.utils.sheet_to_csv(ws);
      lines.push(`[시트: ${name}]\n${csv}`);
    });
    return lines.join('\n\n');
  };

  const fileToBase64 = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(file);
  });

  const processFile = async (file) => {
    const name = file.name;
    if (isImageFile(file)) {
      const base64 = await fileToBase64(file);
      return { base64, mimeType: file.type || 'image/jpeg', preview: URL.createObjectURL(file), name, type: 'image' };
    }
    if (isExcelFile(file)) {
      try {
        const textContent = await readExcelAsText(file);
        return { name, type: 'excel', textContent, preview: null, icon: '📊' };
      } catch (e) {
        console.error('[wizard] excel parse:', e);
        return { name, type: 'excel', textContent: `[엑셀 읽기 실패: ${name}]`, preview: null, icon: '📊' };
      }
    }
    // 텍스트/CSV
    const textContent = await readFileAsText(file);
    return { name, type: 'text', textContent, preview: null, icon: '📄' };
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const processed = await Promise.all(files.map(processFile));
    setPendingFiles(prev => [...prev, ...processed]);
    e.target.value = '';
  };

  const removePendingFile = (idx) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
  };

  // ── 드래그 & 드롭 ──
  const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; setDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current--; if (dragCounter.current <= 0) { setDragging(false); dragCounter.current = 0; } };
  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = async (e) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false); dragCounter.current = 0;
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    const processed = await Promise.all(files.map(processFile));
    setPendingFiles(prev => [...prev, ...processed]);
  };

  // ── 이미지 리사이즈 (Gemini 전송용, 최대 1280px) ──
  const resizeImage = (base64, mimeType, maxSize = 1280) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width: w, height: h } = img;
      if (w <= maxSize && h <= maxSize) { resolve(base64); return; }
      const scale = Math.min(maxSize / w, maxSize / h);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL(mimeType || 'image/jpeg', 0.85).split(',')[1]);
    };
    img.src = `data:${mimeType};base64,${base64}`;
  });

  // ── Gemini Vision API (이미지 + 텍스트/엑셀 파일 통합) ──
  const callVision = async (files) => {
    const key = geminiKey || propKey;
    if (!key) return null;

    const images = files.filter(f => f.type === 'image');
    const textFiles = files.filter(f => f.type === 'text' || f.type === 'excel');

    // 텍스트 파일 내용을 프롬프트에 추가
    let extraText = '';
    if (textFiles.length > 0) {
      extraText = '\n\n아래는 첨부된 텍스트/엑셀 파일 내용입니다. 이 데이터에서도 정보를 추출하세요:\n\n';
      textFiles.forEach(f => { extraText += `--- ${f.name} ---\n${f.textContent}\n\n`; });
    }

    // 이미지 리사이즈 (대용량 방지)
    const resizedImages = await Promise.all(
      images.map(async img => ({
        mimeType: img.mimeType,
        data: await resizeImage(img.base64, img.mimeType)
      }))
    );

    const parts = [
      { text: VISION_PROMPT + extraText },
      ...resizedImages.map(img => ({ inlineData: img }))
    ];

    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0 } })
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        console.error(`[wizard] Vision API ${r.status}:`, errText);
        throw new Error(`Vision API ${r.status}`);
      }
      const d = await r.json();
      const txt = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return JSON.parse(txt.replace(/```json|```/g, '').trim());
    } catch (e) {
      console.error('[wizard] Vision error:', e);
      return null;
    }
  };

  // ── 텍스트 전용 Gemini ──
  const callGemini = async (stepId, userText) => {
    const step = STEPS.find(s => s.id === stepId);
    if (!step?.systemPrompt) return null;
    const key = geminiKey || propKey;
    if (!key) return localParse(step, userText);

    const prompt = `${step.systemPrompt}\n\n사용자 입력: "${userText}"\n사업장명: "${bizName}"\n이전 데이터: ${JSON.stringify(progress.data)}\n\n마크다운 없이 순수 JSON만 출력하세요.`;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0 } })
      });
      if (!r.ok) throw new Error(`API ${r.status}`);
      const d = await r.json();
      const txt = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return JSON.parse(txt.replace(/```json|```/g, '').trim());
    } catch (e) {
      console.error('[wizard] Gemini error:', e);
      return localParse(step, userText);
    }
  };

  const localParse = (step, text) => {
    const skip = /건너|나중|패스|스킵|skip|없어/i.test(text);
    switch (step.id) {
      case 'staff': {
        const names = text.replace(/[,，]/g, ' ').split(/\s+/).filter(n => n.length >= 1 && !/혼자|1인|저만/.test(n));
        return { message: '직원을 등록했어요.', data: { staff: names.length > 0 ? names : [bizName || '원장님'] }, done: true };
      }
      case 'sources':
        if (skip) return { message: '나중에 설정할 수 있어요.', data: { sources: [], skipped: true }, done: true };
        return { message: '예약경로를 추가했어요.', data: { sources: text.split(/[,，\s]+/).filter(Boolean) }, done: true };
      case 'ai_setup':
        return { message: 'AI는 시스템에서 제공됩니다.', data: { skipped: true }, done: true };
      default:
        return { message: '알겠어요!', data: {}, done: true };
    }
  };

  // ── 파싱 결과 → 리뷰 메시지 생성 ──
  const formatReview = (d) => {
    const lines = ['사진에서 다음 정보를 찾았어요:\n'];
    if (d.bizType) lines.push(`업종: ${d.bizType}`);
    if (d.bizName) lines.push(`상호명: ${d.bizName}`);
    if (d.address) lines.push(`주소: ${d.address}`);
    if (d.phone) lines.push(`전화: ${d.phone}`);
    if (d.openTime && d.closeTime) lines.push(`영업시간: ${d.openTime} ~ ${d.closeTime}`);
    if (d.categories?.length) lines.push(`\n카테고리: ${d.categories.join(', ')}`);
    if (d.services?.length) {
      lines.push(`\n시술 상품 (${d.services.length}개):`);
      d.services.forEach((s, i) => {
        const price = s.priceF ? (s.priceM && s.priceM !== s.priceF ? `여 ${(s.priceF/10000).toFixed(0)}만 / 남 ${(s.priceM/10000).toFixed(0)}만` : `${(s.priceF/10000).toFixed(0)}만원`) : '가격미정';
        lines.push(`  ${i+1}. ${s.name} ${s.dur||30}분 ${price}`);
      });
    }
    if (d.staffNames?.length) lines.push(`\n직원: ${d.staffNames.join(', ')}`);
    lines.push('\n수정할 부분이 있으면 말씀해주세요.\n"확인" 또는 "좋아요"를 입력하면 등록을 진행합니다.');
    return lines.join('\n');
  };

  // ── DB 저장 ──
  const saveAllData = async (d) => {
    try {
      // 1. businesses settings
      const bizRows = await sb.get('businesses', `&id=eq.${bizId}`);
      const cur = JSON.parse(bizRows?.[0]?.settings || '{}');
      if (d.bizType) cur.bizType = d.bizType;
      if (d.openTime) cur.openTime = d.openTime;
      if (d.closeTime) cur.closeTime = d.closeTime;
      await sb.update('businesses', bizId, { settings: JSON.stringify(cur) });

      // 2. branches 업데이트 (주소, 전화)
      if (d.address || d.phone) {
        const branches = await sb.get('branches', `&business_id=eq.${bizId}`);
        if (branches?.[0]) {
          const upd = {};
          if (d.address) upd.address = d.address;
          if (d.phone) upd.phone = d.phone;
          await sb.update('branches', branches[0].id, upd);
        }
      }

      // 3. 카테고리
      const catMap = {};
      for (let i = 0; i < (d.categories || []).length; i++) {
        const catId = 'cat_' + uid();
        catMap[d.categories[i]] = catId;
        await sb.insert('service_categories', { id: catId, business_id: bizId, name: d.categories[i], sort: i });
      }

      // 4. 시술 상품
      const existCats = await sb.get('service_categories', `&business_id=eq.${bizId}`);
      for (let i = 0; i < (d.services || []).length; i++) {
        const s = d.services[i];
        let catId = catMap[s.cat] || existCats?.[0]?.id || '';
        if (s.cat && !catMap[s.cat]) {
          const found = existCats.find(c => c.name === s.cat);
          if (found) catId = found.id;
        }
        await sb.insert('services', {
          id: uid(), business_id: bizId, cat: catId,
          name: s.name, dur: s.dur || 30,
          price_f: s.priceF || 0, price_m: s.priceM || 0,
          sort: i, is_package: false, pkg_count: 0, pkg_price_f: 0, pkg_price_m: 0
        });
      }

      // 5. 직원
      if (d.staffNames?.length) {
        const rows = await sb.get('schedule_data', `&key=eq.employees_v1`);
        const existing = rows?.[0]?.value ? (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value) : [];
        const newEmps = d.staffNames.filter(n => !existing.some(e => e.name === n)).map(n => ({ id: uid(), name: n }));
        const merged = [...existing, ...newEmps];
        if (rows?.[0]) await sb.update('schedule_data', rows[0].id, { value: JSON.stringify(merged) });
        else await sb.insert('schedule_data', { id: 'employees_v1', key: 'employees_v1', value: JSON.stringify(merged) });
      }
    } catch (e) {
      console.error('[wizard] save error:', e);
    }
  };

  const saveStepData = async (stepId, stepData) => {
    try {
      if (stepId === 'sources' && !stepData.skipped) {
        for (const name of (stepData.sources || [])) {
          if (/네이버|naver/i.test(name)) continue;
          await sb.insert('reservation_sources', {
            id: 'src_' + uid(), business_id: bizId,
            name, color: getSourceColor(name), use_yn: true, sort: 10
          }).catch(() => {});
        }
      }
      if (stepId === 'ai_setup' && stepData.geminiKey) {
        const bizRows = await sb.get('businesses', `&id=eq.${bizId}`);
        const cur = JSON.parse(bizRows?.[0]?.settings || '{}');
        cur.gemini_key = stepData.geminiKey;
        await sb.update('businesses', bizId, { settings: JSON.stringify(cur) });
        setGeminiKey(stepData.geminiKey);
      }
      if (stepId === 'staff') {
        const rows = await sb.get('schedule_data', `&key=eq.employees_v1`);
        const existing = rows?.[0]?.value ? (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value) : [];
        const newEmps = (stepData.staff || []).filter(n => !existing.some(e => e.name === n)).map(n => ({ id: uid(), name: n }));
        const merged = [...existing, ...newEmps];
        if (rows?.[0]) await sb.update('schedule_data', rows[0].id, { value: JSON.stringify(merged) });
        else await sb.insert('schedule_data', { id: 'employees_v1', key: 'employees_v1', value: JSON.stringify(merged) });
      }
    } catch (e) { console.error('[wizard] save step:', e); }
  };

  // ── 전송 핸들러 ──
  const handleSend = async () => {
    const text = input.trim();
    const images = [...pendingFiles];
    if (!text && !images.length) return;
    if (loading) return;

    setInput('');
    setPendingFiles([]);
    addUser(text || `사진 ${images.length}장`, images.length ? images : undefined);
    setLoading(true);

    try {
      const step = STEPS[stepIdx];

      // ── photo_upload 스텝: Vision 또는 텍스트 없으면 수동 모드 ──
      if (step.id === 'photo_upload') {
        if (/없어|없습|텍스트|직접|수동/i.test(text) && !images.length) {
          addBot('알겠어요! 직접 입력으로 진행할게요.\n\n먼저, 어떤 업종이세요? (왁싱, 네일, 헤어 등)');
          // 수동 모드: 기존 텍스트 스텝으로 전환
          setStepIdx(2); // staff 스텝 (fill_gaps 역할)
          setParsedData({ _manual: true });
          const newProg = { ...progress, completedSteps: ['photo_upload', 'review'] };
          setProgress(newProg);
          return;
        }

        if (images.length > 0) {
          addBot('사진을 분석하고 있어요... 잠시만 기다려주세요.');
          const key = geminiKey || propKey;
          if (!key) {
            addBot('Gemini API 키가 없어서 사진 분석이 안 돼요.\n\n관리설정 > AI 설정에서 키를 등록하거나,\n"없어요"를 입력해서 직접 입력으로 진행해주세요.\n\nAPI 키 발급: https://aistudio.google.com');
            return;
          }
          const result = await callVision(images);
          if (result) {
            // 기존 parsedData와 병합
            const merged = parsedData ? mergeResults(parsedData, result) : result;
            setParsedData(merged);
            addBot(formatReview(merged));
            addBot('더 보낼 사진이 있으면 추가로 보내주세요.\n"확인"을 입력하면 등록을 진행합니다.');
          } else {
            addBot('사진 분석에 실패했어요. 다른 사진을 보내거나, "없어요"로 직접 입력할 수 있어요.');
          }
        } else if (text) {
          // 텍스트 + 이미 파싱된 데이터가 있으면 review로 이동
          if (parsedData && /확인|좋아|넘어|ok|ㅇㅋ|네|응|그래/i.test(text)) {
            await saveAllData(parsedData);
            addBot('등록 완료했어요!');
            const hasStaff = parsedData.staffNames?.length > 0;
            const newProg = { ...progress, completedSteps: ['photo_upload', 'review'], data: { photo: parsedData } };
            setProgress(newProg);
            // 직원이 사진에서 파싱됐으면 스킵
            const nextIdx = hasStaff ? 3 : 2; // sources or staff
            if (hasStaff) newProg.completedSteps.push('staff');
            setStepIdx(nextIdx);
            setTimeout(() => addBot(STEPS[nextIdx].greeting), 500);
          } else if (parsedData) {
            // 수정 요청
            const result = await callGemini('review', text);
            if (result?.data && Object.keys(result.data).length > 0) {
              const merged = { ...parsedData };
              if (result.data.services) {
                // 개별 서비스 수정
                result.data.services.forEach(mod => {
                  const idx = merged.services?.findIndex(s => s.name === mod.name);
                  if (idx >= 0) Object.assign(merged.services[idx], mod);
                });
              }
              Object.keys(result.data).forEach(k => {
                if (k !== 'services' && result.data[k]) merged[k] = result.data[k];
              });
              setParsedData(merged);
              addBot(result.message || '수정했어요!');
              addBot(formatReview(merged));
            } else {
              addBot(result?.message || '수정할 내용을 다시 말씀해주세요.');
            }
          }
        }
        return;
      }

      // ── 일반 스텝 ──
      if (step.id === 'complete') {
        addBot('감사합니다! 왼쪽 메뉴에서 원하는 페이지로 이동해주세요.');
        return;
      }

      const result = await callGemini(step.id, text);
      if (!result) { addBot('다시 말씀해주세요.'); return; }

      addBot(result.message);
      if (result.done) {
        await saveStepData(step.id, result.data || {});
        const newProg = { ...progress };
        if (result.data?.skipped) newProg.skippedSteps.push(step.id);
        else newProg.completedSteps.push(step.id);
        newProg.data[step.id] = result.data;
        setProgress(newProg);

        const nextIdx = findNextStep(stepIdx + 1, newProg);
        setStepIdx(nextIdx);
        if (STEPS[nextIdx]) setTimeout(() => addBot(STEPS[nextIdx].greeting), 500);
        if (STEPS[nextIdx]?.id === 'complete') {
          const bizRows = await sb.get('businesses', `&id=eq.${bizId}`);
          const cur = JSON.parse(bizRows?.[0]?.settings || '{}');
          cur.wizard_progress = { ...newProg, completed: true };
          await sb.update('businesses', bizId, { settings: JSON.stringify(cur) });
          if (onComplete) onComplete();
        }
      }
    } catch (e) {
      addBot('오류가 발생했어요. 다시 시도해주세요.');
      console.error('[wizard]', e);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const findNextStep = (fromIdx, prog) => {
    for (let i = fromIdx; i < STEPS.length; i++) {
      const s = STEPS[i];
      if (s.id === 'complete') return i;
      if (!prog.completedSteps.includes(s.id) && !prog.skippedSteps.includes(s.id)) return i;
    }
    return STEPS.length - 1;
  };

  const mergeResults = (a, b) => ({
    bizType: b.bizType || a.bizType || '',
    bizName: b.bizName || a.bizName || '',
    address: b.address || a.address || '',
    phone: b.phone || a.phone || '',
    openTime: b.openTime || a.openTime || '',
    closeTime: b.closeTime || a.closeTime || '',
    categories: [...new Set([...(a.categories||[]), ...(b.categories||[])])],
    services: [...(a.services||[]), ...(b.services||[])],
    staffNames: [...new Set([...(a.staffNames||[]), ...(b.staffNames||[])])],
  });

  const handleSkip = () => {
    const step = STEPS[stepIdx];
    if (!step || step.required) return;
    addBot(`"${step.label}"은 나중에 관리설정에서 할 수 있어요.`);
    const newProg = { ...progress, skippedSteps: [...progress.skippedSteps, step.id] };
    setProgress(newProg);
    const nextIdx = findNextStep(stepIdx + 1, newProg);
    setStepIdx(nextIdx);
    if (STEPS[nextIdx]) setTimeout(() => addBot(STEPS[nextIdx].greeting), 400);
  };

  const currentStep = STEPS[stepIdx];
  const isComplete = currentStep?.id === 'complete';
  const completedCount = progress.completedSteps.length + progress.skippedSteps.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: T.bg, position: 'relative' }}
      onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
      {/* 드롭 오버레이 */}
      {dragging && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 100,
          background: 'rgba(124,124,200,0.12)', border: `3px dashed ${T.primary}`, borderRadius: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'
        }}>
          <div style={{ background: T.bgCard, padding: '20px 32px', borderRadius: T.radius.xl, boxShadow: T.shadow.lg, textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📎</div>
            <div style={{ fontSize: T.fs.md, fontWeight: T.fw.bolder, color: T.primary }}>여기에 파일을 놓으세요</div>
            <div style={{ fontSize: T.fs.xs, color: T.textMuted, marginTop: 4 }}>사진, 엑셀, 텍스트 파일</div>
          </div>
        </div>
      )}
      {/* 헤더 */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.border}`, background: T.bgCard, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#7c7cc8,#9b9be0)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18 }}>
          ✨
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: T.fs.md, fontWeight: T.fw.bolder }}>설정 마법사</div>
          <div style={{ fontSize: T.fs.xxs, color: T.textMuted }}>
            {isComplete ? '설정 완료!' : `${completedCount}/${STEPS.length - 1} 단계`}
          </div>
        </div>
        {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: T.gray500 }}>✕</button>}
      </div>

      {/* 진행 바 */}
      <div style={{ padding: '8px 16px', borderBottom: `1px solid ${T.border}`, background: T.bgCard, display: 'flex', gap: 3 }}>
        {STEPS.filter(s => s.id !== 'complete').map((s) => {
          const done = progress.completedSteps.includes(s.id);
          const skipped = progress.skippedSteps.includes(s.id);
          const active = STEPS[stepIdx]?.id === s.id;
          return <div key={s.id} style={{ flex: 1, height: 4, borderRadius: 2, background: done ? T.primary : skipped ? T.gray300 : active ? T.primaryLt : T.gray200, transition: 'background .3s' }} title={s.label} />;
        })}
      </div>

      {/* 메시지 */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '85%', padding: '10px 14px', borderRadius: 14,
              background: m.role === 'user' ? T.primary : T.bgCard,
              color: m.role === 'user' ? '#fff' : T.text,
              fontSize: T.fs.sm, lineHeight: 1.6, whiteSpace: 'pre-wrap',
              boxShadow: m.role === 'bot' ? T.shadow.sm : 'none',
              border: m.role === 'bot' ? `1px solid ${T.border}` : 'none',
            }}>
              {m.images?.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
                  {m.images.map((f, j) => f.type === 'image' ? (
                    <img key={j} src={f.preview} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8 }} />
                  ) : (
                    <div key={j} style={{ width: 60, height: 60, borderRadius: 8, background: 'rgba(255,255,255,.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 18 }}>{f.icon || '📄'}</span>
                      <span style={{ fontSize: 8, opacity: .8 }}>{f.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ padding: '10px 14px', borderRadius: 14, background: T.bgCard, border: `1px solid ${T.border}`, fontSize: T.fs.sm, color: T.textMuted }}>
              {pendingFiles.length > 0 || messages[messages.length-1]?.images ? '사진 분석 중...' : '생각하는 중...'}
            </div>
          </div>
        )}
      </div>

      {/* 이미지 미리보기 */}
      {pendingFiles.length > 0 && (
        <div style={{ padding: '8px 16px', borderTop: `1px solid ${T.border}`, background: '#fafafa', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {pendingFiles.map((f, i) => (
            <div key={i} style={{ position: 'relative' }}>
              {f.type === 'image' ? (
                <img src={f.preview} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: `1px solid ${T.border}` }} />
              ) : (
                <div style={{ width: 56, height: 56, borderRadius: 8, border: `1px solid ${T.border}`, background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                  <span style={{ fontSize: 20 }}>{f.icon || '📄'}</span>
                  <span style={{ fontSize: 8, color: T.textMuted, maxWidth: 50, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                </div>
              )}
              <button onClick={() => removePendingFile(i)} style={{
                position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%',
                background: T.danger, color: '#fff', border: 'none', fontSize: 10, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* 입력 */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.border}`, background: T.bgCard }}>
        {!isComplete && currentStep && !currentStep.required && (
          <button onClick={handleSkip} style={{
            background: 'none', border: `1px solid ${T.border}`, borderRadius: T.radius.lg,
            padding: '6px 14px', fontSize: T.fs.xs, color: T.textMuted, cursor: 'pointer',
            marginBottom: 8, fontFamily: 'inherit'
          }}>이 단계 건너뛰기 →</button>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <input type="file" ref={fileRef} accept="image/*,.txt,.csv,.tsv,.xlsx,.xls,.md" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
          {(currentStep?.acceptsImage || stepIdx === 0) && (
            <button onClick={() => fileRef.current?.click()} disabled={loading} style={{
              width: 40, height: 40, borderRadius: T.radius.lg, border: `1px solid ${T.border}`,
              background: '#fff', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: T.gray600, flexShrink: 0
            }}>📎</button>
          )}
          <input
            ref={inputRef} value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && handleSend()}
            placeholder={isComplete ? '추가 질문을 입력하세요' : '답변을 입력하세요...'}
            disabled={loading}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: T.radius.lg,
              border: `1px solid ${T.border}`, fontSize: T.fs.md, fontFamily: 'inherit',
              outline: 'none', color: T.text, background: '#fff'
            }}
          />
          <button onClick={handleSend} disabled={loading || (!input.trim() && !pendingFiles.length)} style={{
            padding: '10px 18px', borderRadius: T.radius.lg, border: 'none',
            background: (loading || (!input.trim() && !pendingFiles.length)) ? T.gray200 : T.primary,
            color: (loading || (!input.trim() && !pendingFiles.length)) ? T.gray400 : '#fff',
            fontSize: T.fs.sm, fontWeight: T.fw.bolder, cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0
          }}>{loading ? '...' : '전송'}</button>
        </div>
        {isComplete && (
          <button onClick={onClose} style={{
            width: '100%', marginTop: 10, padding: 12, borderRadius: T.radius.lg,
            border: 'none', background: 'linear-gradient(135deg,#7c7cc8,#9b9be0)', color: '#fff',
            fontSize: T.fs.md, fontWeight: T.fw.bolder, cursor: 'pointer', fontFamily: 'inherit'
          }}>설정 완료 — 앱 시작하기</button>
        )}
      </div>
    </div>
  );
}
