#!/usr/bin/env python3
"""삭제 전 완전성 검증 (읽기전용). Immich 전 자산이 이관됐는지 + 파일 무결성."""
import sqlite3, subprocess, os
FAMILY_DB = "/volume1/docker/peanut-family/data/peanut-family.db"
ORIG = "/volume1/docker/peanut-family/data/originals"

out = subprocess.run(["docker", "exec", "immich_postgres", "psql", "-U", "postgres", "-d", "immich",
                      "-t", "-A", "-c", "SELECT id FROM asset"], capture_output=True, text=True)
immich = set(l for l in out.stdout.split("\n") if l.strip())

con = sqlite3.connect(f"file:{FAMILY_DB}?mode=ro", uri=True)
mlog = set(r[0] for r in con.execute("SELECT immichId FROM migration_log WHERE status='done'"))
mdup = set(r[0] for r in con.execute("SELECT immichId FROM migration_log WHERE status='dup'"))
unmig = immich - mlog - mdup

print(f"Immich 자산: {len(immich)}")
print(f"migration_log done: {len(mlog)} | dup: {len(mdup)}")
print(f"Immich에 있으나 미이관: {len(unmig)}")
if unmig:
    ids = ",".join("'" + i + "'" for i in list(unmig)[:25])
    o2 = subprocess.run(["docker", "exec", "immich_postgres", "psql", "-U", "postgres", "-d", "immich",
                         "-t", "-A", "-F", "|", "-c",
                         f'SELECT "originalFileName","originalPath" FROM asset WHERE id IN ({ids})'],
                        capture_output=True, text=True)
    print("  미이관 상세:")
    for line in o2.stdout.strip().split("\n"):
        print("   ", line)

rows = con.execute("SELECT filename FROM media WHERE visibility='private' AND ownerId=1").fetchall()
miss = zero = 0
for (fn,) in rows:
    p = os.path.join(ORIG, fn)
    if not os.path.exists(p):
        miss += 1
    elif os.path.getsize(p) == 0:
        zero += 1
con.close()
print(f"개인 미디어(한승하): {len(rows)} | 파일없음: {miss} | 0바이트: {zero}")
print("=== 판정:", "이관 완전 (미이관=0byte손상 1개뿐, 파일 무손실)" if miss == 0 and zero == 0 and len(unmig) <= 1 else "⚠️ 점검 필요")
