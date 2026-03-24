# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요
Bliss 하우스왁싱 예약관리 앱.

## 레포지토리
- **bliss-app** (이 폴더): Vite+React 신규 앱
- **bliss**: jeongwooLee1/bliss — 기존 운영 앱

## 서버
- Oracle Cloud: 158.179.174.30
- Supabase biz_id: `biz_khvurgshb`

## 로컬 개발
- `npx vite --force` → localhost:5173

## 작업 완료 알림
모든 작업 완료 시 텔레그램 알림 전송 (.env에서 토큰 로드):
```
source .env && curl -s "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" -d "chat_id=${TG_CHAT}" --data-urlencode "text=작업 완료"
```

## 절대 금지
- memo 필드에 네이버 데이터 쓰기
- API 키 코드에 노출
