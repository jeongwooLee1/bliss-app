// inject-content.mjs
// Vercel 빌드 시 실행: Supabase landing_sections의 published 콘텐츠를
// index.html의 data-cms 요소에 주입한다. 의존성 없음 (Node 18+ fetch 사용).
//
// 사용법:  node inject-content.mjs [html파일경로...]
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { readFileSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const files = process.argv.slice(2).length ? process.argv.slice(2) : ["index.html"];

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.");
  process.exit(1);
}

// 1. published 콘텐츠 가져오기
const res = await fetch(
  `${SUPABASE_URL}/rest/v1/landing_sections?select=id,published`,
  { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
);
if (!res.ok) {
  console.error(`Supabase 조회 실패: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const sections = await res.json();

// "hero.headline" → 값 조회 (배열 인덱스 지원: hero.points.0.title)
function lookup(path) {
  const [sectionId, ...keys] = path.split(".");
  const section = sections.find((s) => s.id === sectionId);
  if (!section) return undefined;
  let cur = section.published;
  for (const k of keys) {
    if (cur == null) return undefined;
    cur = cur[/^\d+$/.test(k) ? Number(k) : k];
  }
  return typeof cur === "string" ? cur : undefined;
}

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 텍스트 내 **굵게** 와 줄바꿈(\n) 지원
const render = (s) =>
  escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");

// 2. data-cms 요소의 내부 콘텐츠 치환
//    <tag ... data-cms="path" ...>기존내용</tag> → 기존내용을 DB 값으로 교체
let totalReplaced = 0;
for (const file of files) {
  let html = readFileSync(file, "utf8");
  let replaced = 0;

  html = html.replace(
    /(<([a-zA-Z][\w-]*)\b[^>]*\bdata-cms="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (match, openTag, tag, path, _inner, closeTag) => {
      const value = lookup(path);
      if (value === undefined) {
        console.warn(`  ⚠ 값 없음, 원본 유지: ${path}`);
        return match;
      }
      replaced++;
      return openTag + render(value) + closeTag;
    }
  );

  writeFileSync(file, html);
  console.log(`${file}: ${replaced}개 요소 치환 완료`);
  totalReplaced += replaced;
}

if (totalReplaced === 0) {
  console.warn("치환된 요소가 없습니다. HTML에 data-cms 속성이 있는지 확인하세요.");
}
