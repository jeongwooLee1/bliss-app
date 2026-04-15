# 병렬 개발 워크플로우

## 개요
여러 클로드 세션이 동시에 다른 페이지를 작업할 때 충돌 방지하는 표준 절차.

## 기본 규칙
1. **각 세션은 worktree에서 작업** — main 직접 수정 금지
2. **작업 단위로 feature 브랜치** 생성
3. **배포는 main 브랜치에서만, 한 번에 하나씩**
4. **BLISS_V/version.txt는 배포자만 올림**

## 세션 시작 시
```
EnterWorktree(name="<feature-name>")
```
→ `.claude/worktrees/<name>/` 에 새 워크트리, 새 브랜치 생성
→ 자동으로 그 디렉토리로 전환

## 작업 흐름
1. 워크트리에서 코드 수정 (페이지별로 파일 분리)
2. 로컬 테스트: `npx vite --force` (다른 세션과 포트 충돌 없게 5174 등)
3. commit + push (브랜치)
4. main 브랜치에 merge:
   ```bash
   cd /c/Users/TP005/bliss-app
   git checkout main
   git pull
   git merge <feature-branch>
   git push
   ```
5. 충돌 발생 시: 워크트리에서 `git pull origin main` 후 conflict 해결

## 배포 (main에서만)
```bash
cd /c/Users/TP005/bliss-app
git checkout main && git pull
# BLISS_V + version.txt 동시 업데이트 (한 번만)
# 빌드 + 배포 + CF 퍼지
```

## 안전한 파일 분담 예시
**격리됨 (충돌 위험 낮음):**
- `src/components/Timeline/*.jsx` — 타임라인
- `src/components/Sales/*.jsx` — 매출
- `src/components/Customers/*.jsx` — 고객
- `src/components/Admin/Admin*.jsx` — 관리설정 하위

**공통 (조심):**
- `src/pages/AppShell.jsx` — 라우팅, 데이터 로딩
- `src/lib/db.js`, `src/lib/sb.js` — DB 매핑
- `src/lib/constants.js`, `src/lib/useData.js`
- `src/components/Navigation/*.jsx` — 사이드바

→ 공통 파일 수정 시 다른 세션과 조율 필요

## 충돌 시
1. `git pull origin main` 으로 최신 main 가져옴
2. conflict 표시된 파일 직접 해결
3. `git add . && git commit` 후 다시 push

## 세션 종료 시
- 작업 다 했으면: main으로 merge 후 `ExitWorktree(action="remove")`
- 미완 상태로 둘 거면: `ExitWorktree(action="keep")` (다음 세션이 이어받음)
