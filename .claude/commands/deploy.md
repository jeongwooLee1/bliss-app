---
description: 블리스 앱 빌드 → 서버 배포 → Cloudflare 캐시 퍼지
allowed-tools: Bash
---

블리스 앱을 빌드하고 서버에 배포합니다:

1. `rm -rf dist && npx vite build` 로 빌드
2. `ssh bliss-server "sudo rm -rf /var/www/html/bliss-app/assets /var/www/html/bliss-app/index.html /tmp/bliss-app/*"` 로 서버 정리
3. `scp -r dist/* bliss-server:/tmp/bliss-app/` 로 파일 전송
4. `ssh bliss-server "sudo cp -r /tmp/bliss-app/* /var/www/html/bliss-app/ && sudo chown -R www-data:www-data /var/www/html/bliss-app"` 로 배포
5. schedule.html이 삭제되었으면 `scp /c/Users/TP005/bliss/schedule.html bliss-server:/tmp/schedule.html && ssh bliss-server "sudo cp /tmp/schedule.html /var/www/html/bliss-app/schedule.html && sudo chown www-data:www-data /var/www/html/bliss-app/schedule.html"` 로 복구
6. 배포된 JS 파일 확인: `ssh bliss-server "ls /var/www/html/bliss-app/assets/index-*.js"`
7. Cloudflare 캐시 자동 퍼지: `source .env && curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache" -H "Authorization: Bearer ${CF_TOKEN}" -H "Content-Type: application/json" -d '{"purge_everything":true}'`
8. 퍼지 결과 확인 (success:true 여부)
