#!/usr/bin/env python3
"""bliss_naver.py: 네이버 선결제 자동 저장 (reservations.external_prepaid)"""
import sys, os

SRC = "/home/ubuntu/naver-sync/bliss_naver.py"
BAK = "/home/ubuntu/naver-sync/bliss_naver.py.bak_ext_prepaid"

with open(SRC, "r", encoding="utf-8") as f:
    src = f.read()

if not os.path.exists(BAK):
    with open(BAK, "w", encoding="utf-8") as f:
        f.write(src)

ANCHOR = '            "is_scraping_done":   True,\n        }\n\n        db_upsert(rid, db_data)'

if 'external_prepaid' in src.split(ANCHOR)[0].split('"is_scraping_done":   True')[0][-2000:]:
    print("[skip] already patched")
    sys.exit(0)

NEW = '''            "is_scraping_done":   True,
        }
        # 네이버 선결제 자동 저장 → 예약모달 선결제 필드 자동 표시 + SaleForm 자동 사용
        if raw.get("is_prepaid") and raw.get("total_price"):
            db_data["external_prepaid"] = raw.get("total_price", 0)
            db_data["external_platform"] = "네이버"

        db_upsert(rid, db_data)'''

if ANCHOR not in src:
    print("ERR: anchor not found")
    sys.exit(1)

src = src.replace(ANCHOR, NEW)

with open(SRC, "w", encoding="utf-8") as f:
    f.write(src)

print("[ok] patched")
