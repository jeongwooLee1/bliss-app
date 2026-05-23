import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

// ─── 색 변환 유틸 ───────────────────────────────────────────────
function normHex(v) {
  if (!v || typeof v !== "string") return "#7c7cc8";
  let s = v.trim();
  if (s[0] !== "#") s = "#" + s;
  // #abc → #aabbcc
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  }
  // #rrggbbaa → #rrggbb (알파 제거)
  if (/^#[0-9a-fA-F]{8}$/.test(s)) s = s.slice(0, 7);
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  return "#7c7cc8";
}
function hexToRgb(hex) {
  const h = normHex(hex);
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}
function rgbToHex(r, g, b) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

const PRESETS = [
  "#7c7cc8", "#5b21b6", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
  "#f59e0b", "#ffd700", "#10b981", "#14b8a6", "#3b82f6", "#6366f1",
  "#111827", "#64748b", "#9ca3af", "#ffffff",
];

export default function ColorField({ value, onChange, swatchStyle, title = "색상 선택" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btnRef = useRef(null);
  const svRef = useRef(null);
  const hueDrag = useRef(false);
  const svDrag = useRef(false);

  const hex = normHex(value);
  const { r, g, b } = hexToRgb(hex);
  const hsv = rgbToHsv(r, g, b);
  const [hexText, setHexText] = useState(hex);
  useEffect(() => { setHexText(hex); }, [hex, open]);

  const emit = useCallback((newHex) => { onChange && onChange(newHex); }, [onChange]);

  const openPopover = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const W = 248, H = 360, M = 8;
      let left = Math.min(rect.left, window.innerWidth - W - M);
      left = Math.max(M, left);
      let top = rect.bottom + 6;
      if (top + H > window.innerHeight - M) top = Math.max(M, rect.top - H - 6);
      setPos({ left, top });
    }
    setOpen(true);
  };

  // SV 박스 포인터 처리
  const handleSV = (clientX, clientY) => {
    const el = svRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    const c = hsvToRgb(hsv.h, s, v);
    emit(rgbToHex(c.r, c.g, c.b));
  };
  const handleHue = (clientX, el) => {
    const rect = el.getBoundingClientRect();
    const h = Math.max(0, Math.min(360, ((clientX - rect.left) / rect.width) * 360));
    const c = hsvToRgb(h, hsv.s || 1, hsv.v || 1);
    emit(rgbToHex(c.r, c.g, c.b));
  };

  useEffect(() => {
    if (!open) return;
    const move = (e) => {
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      if (svDrag.current) { e.preventDefault(); handleSV(cx, cy); }
      else if (hueDrag.current && hueDrag.current.el) { e.preventDefault(); handleHue(cx, hueDrag.current.el); }
    };
    const up = () => { svDrag.current = false; hueDrag.current = false; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, [open, hsv.h, hsv.s, hsv.v]);

  const hueColor = (() => { const c = hsvToRgb(hsv.h, 1, 1); return rgbToHex(c.r, c.g, c.b); })();

  const popover = open && createPortal(
    <>
      <div onClick={() => setOpen(false)}
        style={{ position: "fixed", inset: 0, zIndex: 99998, background: "transparent" }} />
      <div style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 99999, width: 248,
        background: "#fff", borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,.28)",
        padding: 12, boxSizing: "border-box", fontFamily: "inherit" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#222" }}>{title}</span>
          <button onClick={() => setOpen(false)} style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer", color: "#888", lineHeight: 1 }}>✕</button>
        </div>
        {/* 현재 색 미리보기 + hex 입력 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 8, background: hex, border: "1px solid #00000022", flexShrink: 0 }} />
          <input value={hexText}
            onChange={(e) => {
              let t = e.target.value; if (t && t[0] !== "#") t = "#" + t;
              setHexText(t);
              if (/^#[0-9a-fA-F]{6}$/.test(t) || /^#[0-9a-fA-F]{3}$/.test(t)) emit(normHex(t));
            }}
            onBlur={() => setHexText(hex)}
            spellCheck={false}
            style={{ flex: 1, minWidth: 0, height: 34, border: "1px solid #ddd", borderRadius: 8, padding: "0 10px",
              fontSize: 15, fontFamily: "inherit", textTransform: "uppercase", outline: "none", color: "#222" }} />
        </div>
        {/* 채도/명도 박스 */}
        <div ref={svRef}
          onMouseDown={(e) => { svDrag.current = true; handleSV(e.clientX, e.clientY); }}
          onTouchStart={(e) => { svDrag.current = true; const t = e.touches[0]; handleSV(t.clientX, t.clientY); }}
          style={{ position: "relative", width: "100%", height: 130, borderRadius: 8, cursor: "crosshair",
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
            touchAction: "none", marginBottom: 10 }}>
          <div style={{ position: "absolute", left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`,
            width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: "50%",
            border: "2px solid #fff", boxShadow: "0 0 0 1px #00000055", background: hex, pointerEvents: "none" }} />
        </div>
        {/* 색조 슬라이더 */}
        <div onMouseDown={(e) => { hueDrag.current = { el: e.currentTarget }; handleHue(e.clientX, e.currentTarget); }}
          onTouchStart={(e) => { hueDrag.current = { el: e.currentTarget }; handleHue(e.touches[0].clientX, e.currentTarget); }}
          style={{ position: "relative", width: "100%", height: 16, borderRadius: 8, cursor: "pointer", touchAction: "none",
            marginBottom: 12, background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }}>
          <div style={{ position: "absolute", left: `${(hsv.h / 360) * 100}%`, top: "50%",
            width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: "50%",
            border: "2px solid #fff", boxShadow: "0 0 0 1px #00000055", background: hueColor, pointerEvents: "none" }} />
        </div>
        {/* 프리셋 팔레트 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 5 }}>
          {PRESETS.map((p) => (
            <button key={p} onClick={() => emit(p)} title={p}
              style={{ width: "100%", paddingBottom: "100%", position: "relative", borderRadius: 6,
                background: p, border: hex === p.toLowerCase() ? "2px solid #222" : "1px solid #00000022",
                cursor: "pointer", padding: 0 }} />
          ))}
        </div>
      </div>
    </>, document.body);

  return (
    <>
      <button ref={btnRef} type="button" onClick={openPopover}
        style={{ width: 32, height: 26, borderRadius: 6, border: "1px solid #ddd", background: hex,
          cursor: "pointer", padding: 0, flexShrink: 0, ...swatchStyle }} />
      {popover}
    </>
  );
}
