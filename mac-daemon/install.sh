#!/bin/bash
# Bliss KB SMS 폴링 데몬 설치
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PLIST_NAME="com.bliss.kb-sync.plist"
TARGET="$HOME/Library/LaunchAgents/$PLIST_NAME"

echo "==> state 디렉토리 준비"
mkdir -p "$HOME/.bliss-kb-sync"

echo "==> plist 복사: $TARGET"
cp "$SCRIPT_DIR/$PLIST_NAME" "$TARGET"

echo "==> 기존 데몬 unload (있으면)"
launchctl unload "$TARGET" 2>/dev/null || true

echo "==> 데몬 load"
launchctl load "$TARGET"

echo ""
echo "✅ 설치 완료"
echo ""
echo "상태 확인:"
launchctl list | grep com.bliss.kb-sync || echo "  (60초 후 첫 실행)"
echo ""
echo "로그:"
echo "  tail -f $HOME/.bliss-kb-sync/poll.log"
echo "  tail -f $HOME/.bliss-kb-sync/launchd.err.log"
echo ""
echo "수동 실행 테스트:"
echo "  python3 $SCRIPT_DIR/kb_sms_poll.py"
echo ""
echo "Full Disk Access 부여 필요:"
echo "  시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한 → /usr/bin/python3 추가"
