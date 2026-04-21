import React from 'react'

// Pointer(mouse/touch) 기반 커스텀 드래그 정렬 — HTML5 DnD API 대신 사용
// scope: 같은 페이지에 여러 드래그 그룹(카테고리·시술 등)이 있을 때 충돌 방지용 식별자
export function useTouchDragSort(items, onReorder, scope) {
  const [overIdx, setOverIdx] = React.useState(null);
  const stateRef = React.useRef({ from: null, to: null, dragging: false, ghost: null, startX: 0, startY: 0 });
  const scopeRef = React.useRef(scope || 'default');
  scopeRef.current = scope || 'default';

  const doReorder = (from, to) => {
    if (from === null || to === null || from === to) return;
    const arr = [...items];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    onReorder(arr);
  };

  const THRESHOLD = 6;

  const startPointerDrag = (e, idx, el) => {
    const isTouch = e.type === 'touchstart';
    const point = isTouch ? e.touches[0] : e;
    const mySelector = `[data-drag-idx][data-drag-scope="${scopeRef.current}"]`;
    stateRef.current = { from: idx, to: null, dragging: false, ghost: null, startX: point.clientX, startY: point.clientY };

    const createGhost = () => {
      const rect = el.getBoundingClientRect();
      const ghost = el.cloneNode(true);
      ghost.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;opacity:0.85;z-index:9999;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.25);transform:scale(1.05);transition:none`;
      document.body.appendChild(ghost);
      stateRef.current.ghost = ghost;
      stateRef.current.offsetX = point.clientX - rect.left;
      stateRef.current.offsetY = point.clientY - rect.top;
    };

    const onMove = (ev) => {
      ev.preventDefault();
      const p = isTouch ? ev.touches[0] : ev;
      const dx = p.clientX - stateRef.current.startX;
      const dy = p.clientY - stateRef.current.startY;
      if (!stateRef.current.dragging) {
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
        stateRef.current.dragging = true;
        createGhost();
      }
      if (stateRef.current.ghost) {
        stateRef.current.ghost.style.left = (p.clientX - (stateRef.current.offsetX||0)) + 'px';
        stateRef.current.ghost.style.top = (p.clientY - (stateRef.current.offsetY||0)) + 'px';
        stateRef.current.ghost.style.display = 'none';
      }
      const targetEl = document.elementFromPoint(p.clientX, p.clientY);
      if (stateRef.current.ghost) stateRef.current.ghost.style.display = '';
      const itemEl = targetEl?.closest(mySelector);
      if (itemEl) {
        const newIdx = parseInt(itemEl.dataset.dragIdx);
        if (!isNaN(newIdx) && newIdx !== stateRef.current.to) {
          stateRef.current.to = newIdx;
          setOverIdx(newIdx);
        }
      }
    };

    const cleanup = () => {
      if (stateRef.current.ghost) stateRef.current.ghost.remove();
      const wasDragging = stateRef.current.dragging;
      const from = stateRef.current.from, to = stateRef.current.to;
      stateRef.current = { from: null, to: null, dragging: false, ghost: null, startX: 0, startY: 0 };
      setOverIdx(null);
      if (isTouch) {
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', cleanup);
        document.removeEventListener('touchcancel', cleanup);
      } else {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', cleanup);
      }
      if (wasDragging) doReorder(from, to);
    };

    if (isTouch) {
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', cleanup);
      document.addEventListener('touchcancel', cleanup);
    } else {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', cleanup);
    }
  };

  const mouseHandlers = (idx) => ({
    'data-drag-scope': scopeRef.current,
    onMouseDown: (e) => {
      if (e.button !== 0) return;
      startPointerDrag(e, idx, e.currentTarget);
    },
    onClickCapture: (e) => {
      if (stateRef.current.dragging) { e.preventDefault(); e.stopPropagation(); }
    },
    onDragStart: (e) => { e.preventDefault(); }, // 혹시 남아있는 draggable 속성 억제
  });

  const touchHandlers = (idx) => ({
    'data-drag-scope': scopeRef.current,
    onTouchStart: (e) => startPointerDrag(e, idx, e.currentTarget),
  });

  return { mouseHandlers, touchHandlers, overIdx };
}

export default useTouchDragSort;
