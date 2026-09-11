#!/usr/bin/env python3
"""
NAS orphan 미디어 스캔 (호스트, 읽기전용 리포트).
Immich(/volume1/docker/immich) + 두 앱 data + 시스템/캐시/앱에셋을 제외한
나머지 위치의 이미지/영상을 디렉토리별 개수·용량으로 집계해 리포트한다.
삭제/이동 없음 — 무엇이 'orphan'인지 파악용. 실제 이관은 결과 검토 후 결정.

사용: python3 scan_orphans.py
"""
import os

ROOT = "/volume1"
MEDIA_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".dng",
             ".raw", ".arw", ".cr2", ".nef", ".mp4", ".mov", ".avi", ".mkv",
             ".m4v", ".3gp", ".hevc", ".bmp", ".tiff", ".tif"}

# 제외 경로(접두사). 가족사진이 아닌 것 + 이미 관리되는 것.
EXCLUDE_PREFIX = [
    "/volume1/@",                              # 시스템/앱데이터/캐시
    "/volume1/docker/immich",                  # Immich (별도 처리)
    "/volume1/docker/peanut/data",             # 땅콩땅콩 앱
    "/volume1/docker/peanut-family/data",      # 땅콩페밀리 앱 (정본)
]
# 앱 에셋(가족사진 아님) — 디렉토리명에 포함되면 제외
EXCLUDE_CONTAINS = ["@eaDir", "/node_modules/", "webtoon", "stock-self", "ai-trainer",
                    "nexus", "/.git/", "/dist/", "/cache/", "thumbnails", "/hls/"]


def excluded(p):
    if any(p.startswith(x) for x in EXCLUDE_PREFIX):
        return True
    if any(x in p for x in EXCLUDE_CONTAINS):
        return True
    return False


def main():
    by_dir = {}  # topdir -> [count, bytes]
    total_c = total_b = 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        # @eaDir 등 가지치기
        dirnames[:] = [d for d in dirnames if not d.startswith("@") and d != "node_modules" and d != ".git"]
        if excluded(dirpath + "/"):
            continue
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in MEDIA_EXT:
                continue
            full = os.path.join(dirpath, fn)
            if excluded(full):
                continue
            try:
                sz = os.path.getsize(full)
            except OSError:
                continue
            # 집계 키: /volume1/<a>/<b> 수준
            parts = full.split("/")
            key = "/".join(parts[:5]) if len(parts) >= 5 else dirpath
            d = by_dir.setdefault(key, [0, 0])
            d[0] += 1; d[1] += sz
            total_c += 1; total_b += sz

    print("=== ORPHAN 미디어 리포트 (Immich/앱data/시스템/앱에셋 제외) ===")
    for k in sorted(by_dir, key=lambda x: -by_dir[x][1]):
        c, b = by_dir[k]
        print(f"  {k}  |  {c}개  |  {b/1e9:.2f} GB")
    print(f"--- 합계: {total_c}개, {total_b/1e9:.2f} GB ---")
    if total_c == 0:
        print("orphan 가족 미디어 없음 — 모든 사진/영상이 이미 앱/Immich 하위에 있음.")


if __name__ == "__main__":
    main()
