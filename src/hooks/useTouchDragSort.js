import { useRef, useState } from 'react'
import React from 'react'

export function useTouchDragSort(items, onReorder) {
  const dragIdx = React.useRef(null);
  const dragOverIdx = React.useRef(null);
  const [overIdx, setOverIdx] = React.useState(null);
  const ghostRef = React.useRef(null);

  const doReorder = (from, to) => {
    if (from === null || to === null || from === to) return;
    const arr = [...items];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    onReorder(arr);
  };

  // PC 마우스 핸들러
  const mouseHandlers = (idx) => ({
    draggable: true,
    onDragStart: () => { dragIdx.current = idx; },
    onDragEnter: () => { dragOverIdx.current = idx; setOverIdx(idx); },
    onDragEnd: () => {
      doReorder(dragIdx.current, dragOverIdx.current);
      dragIdx.current = null; dragOverIdx.current = null; setOverIdx(null);
    },
    onDragOver: e => e.preventDefault(),
  });

  // 모바일 터치 핸들러
  const touchHandlers = (idx, getItems) => ({
    onTouchStart: (e) => {
      dragIdx.current = idx;
      const touch = e.touches[0];
      // 고스트 엘리먼트 생성
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const ghost = el.cloneNode(true);
      ghost.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;opacity:0.8;z-index:9999;pointer-events:none;background:white;box-shadow:0 8px 24px rgba(0,0,0,.2);border-radius:12px;transform:scale(1.02)`;
      document.body.appendChild(ghost);
      ghostRef.current = ghost;
      e.currentTarget._touchOffsetY = touch.clientY - rect.top;
    },
    onTouchMove: (e) => {
      e.preventDefault();
      if (dragIdx.current === null) return;
      const touch = e.touches[0];
      if (ghostRef.current) {
        ghostRef.current.style.top = (touch.clientY - (e.currentTarget._touchOffsetY || 30)) + 'px';
      }
      // 현재 손가락 아래 아이템 찾기
      ghostRef.current && (ghostRef.current.style.display = 'none');
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      ghostRef.current && (ghostRef.current.style.display = '');
      const itemEl = el?.closest('[data-drag-idx]');
      if (itemEl) {
        const newIdx = parseInt(itemEl.dataset.dragIdx);
        if (!isNaN(newIdx) && newIdx !== dragOverIdx.current) {
          dragOverIdx.current = newIdx;
          setOverIdx(newIdx);
        }
      }
    },
    onTouchEnd: () => {
      if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null; }
      doReorder(dragIdx.current, dragOverIdx.current);
      dragIdx.current = null; dragOverIdx.current = null; setOverIdx(null);
    },
  });

  return { mouseHandlers, touchHandlers, overIdx };
}

export default useTouchDragSort
