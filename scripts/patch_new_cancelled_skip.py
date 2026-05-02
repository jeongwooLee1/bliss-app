"""_process_one action='new'에서 raw.status='naver_cancelled'면 INSERT 스킵.
5분 폴링(naver_future_cancel_sync_thread)과 동일 규칙: DB에 없는 cancelled는 가져오지 않음.
사용자가 Bliss에서 수동 삭제한 cancelled 예약이 list 폴링으로 부활하는 것 차단."""
p = '/home/ubuntu/naver-sync/bliss_naver.py'
src = open(p).read()

old = """        # 상태 결정
        # 접수(new) 액션이면 기본적으로 pending으로 강제 (API가 reserved 반환해도, 무한루프 방지)
        # 단, raw.status='naver_cancelled'면 그것을 존중 (list 폴링이 cancelled rid를 'new'로 큐잉한 케이스)
        # rescrape/change/None은 API raw.status 그대로
        if action == "new":
            raw_status = raw.get("status", "")
            if raw_status == "naver_cancelled":
                status = "naver_cancelled"
            else:
                status = "pending"
        elif action == "cancel":
            status = "naver_cancelled"
        else:
            status = raw.get("status", "reserved")"""

new = """        # 상태 결정
        # 접수(new) 액션이면 기본적으로 pending으로 강제 (API가 reserved 반환해도, 무한루프 방지)
        # 단, raw.status='naver_cancelled'면 INSERT 자체를 스킵 (5분 폴링과 동일 규칙)
        # → list 폴링은 DB에 없는 rid만 'new'로 큐잉하므로, action='new' + cancelled = "DB에 없는 cancelled".
        #   유저가 Bliss에서 수동 삭제한 후 cancelled 부활을 차단.
        # rescrape/change/None은 API raw.status 그대로
        if action == "new":
            raw_status = raw.get("status", "")
            if raw_status == "naver_cancelled":
                log.info(f"  ⏭  #{rid} naver_cancelled + DB 없음 → INSERT 스킵 (수동 삭제 존중)")
                return  # finally → task_done()
            status = "pending"
        elif action == "cancel":
            status = "naver_cancelled"
        else:
            status = raw.get("status", "reserved")"""

if old not in src:
    print('PATTERN_NOT_FOUND'); raise SystemExit(1)
src = src.replace(old, new)
open(p, 'w').write(src)
print('PATCHED OK')
