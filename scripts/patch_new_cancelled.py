"""_process_one action='new' 분기에서 raw.status='naver_cancelled'면 그것을 존중.
list 폴링이 cancelled rid를 'new'로 큐잉했을 때, pending으로 덮어쓰지 않도록 수정."""
p = '/home/ubuntu/naver-sync/bliss_naver.py'
src = open(p).read()

old = """        # 상태 결정
        # 접수(new) 액션이면 pending으로 강제 (API가 reserved 반환해도)
        # rescrape/change/None은 API raw.status 그대로 (이미 확정된 건이 pending으로 되돌아가는 무한루프 방지)
        if action == "new":
            status = "pending"
        elif action == "cancel":
            status = "naver_cancelled"
        else:
            status = raw.get("status", "reserved")"""

new = """        # 상태 결정
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

if old not in src:
    print('PATTERN_NOT_FOUND'); raise SystemExit(1)
src = src.replace(old, new)
open(p, 'w').write(src)
print('PATCHED OK')
