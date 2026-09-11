#!/usr/bin/env python3
"""
Immich -> 땅콩페밀리 이관 [1단계: 호스트] — 파일 복사 + 매니페스트 작성 (DB 쓰기 없음).
- Immich postgres에서 메타 추출
- 원본 파일 해시(SHA256 head4MB+tail4MB+size)를 *소스에서 직접* 계산
- 기존 family media hash 또는 이번 실행 내 중복이면 복사하지 않고 스킵
- 비중복만 data/originals/<uuid><ext> 로 복사(.part->rename)
- 비중복 항목을 data/immich-manifest.json 에 누적 기록 (컨테이너 2단계가 INSERT)
- migration_log(있으면 readonly로 읽어 done/dup 스킵 → idempotent)

사용: python3 migrate_immich.py [LIMIT]
"""
import os, sys, json, uuid, hashlib, struct, shutil, subprocess, sqlite3, time

IMMICH_HOST_LIB = "/volume1/docker/immich/library"
IMMICH_CONTAINER_PREFIX = "/usr/src/app/upload/"
FAMILY_DATA = "/volume1/docker/peanut-family/data"
ORIGINALS = os.path.join(FAMILY_DATA, "originals")
DB_PATH = os.path.join(FAMILY_DATA, "peanut-family.db")
MANIFEST = os.path.join(FAMILY_DATA, "immich-manifest.json")
CHUNK = 4 * 1024 * 1024

EXT_MIME = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
    ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif", ".dng": "image/x-adobe-dng",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo", ".mkv": "video/x-matroska",
    ".m4v": "video/x-m4v", ".3gp": "video/3gpp", ".webm": "video/webm",
}
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else None


def psql(sql):
    out = subprocess.run(
        ["docker", "exec", "immich_postgres", "psql", "-U", "postgres", "-d", "immich", "-t", "-A", "-F", "\t", "-c", sql],
        capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError("psql failed: " + out.stderr)
    return [l for l in out.stdout.split("\n") if l.strip()]


def quick_hash_fp(f, size):
    h = hashlib.sha256()
    if size <= CHUNK:
        h.update(f.read())
    else:
        head = f.read(CHUNK)
        f.seek(size - CHUNK)
        tail = f.read(CHUNK)
        h.update(head); h.update(tail); h.update(struct.pack(">d", float(size)))
    return h.hexdigest()


def host_path(p):
    return os.path.join(IMMICH_HOST_LIB, p[len(IMMICH_CONTAINER_PREFIX):]) if p.startswith(IMMICH_CONTAINER_PREFIX) else None


def main():
    print(f"[migrate] LIMIT={LIMIT or 'ALL'}")
    lim = f" LIMIT {LIMIT}" if LIMIT else ""
    rows = psql(
        'SELECT a.id, a."originalPath", a."originalFileName", a.type, '
        "to_char(a.\"localDateTime\",'YYYY-MM-DD HH24:MI:SS'), "
        'COALESCE(a."livePhotoVideoId"::text,\'\'), '
        'COALESCE(e."exifImageWidth"::text,\'\'), COALESCE(e."exifImageHeight"::text,\'\'), '
        'COALESCE(e.latitude::text,\'\'), COALESCE(e.longitude::text,\'\') '
        'FROM asset a LEFT JOIN asset_exif e ON e."assetId" = a.id '
        f'ORDER BY a."localDateTime" ASC{lim}')
    print(f"[migrate] fetched {len(rows)} assets")

    referenced = set()
    parsed = []
    for line in rows:
        c = line.split("\t")
        if len(c) < 10:
            continue
        if c[5]:
            referenced.add(c[5])
        parsed.append(c[:10])

    # readonly: 기존 hash, 이미 처리된 immichId
    existing = set()
    done_ids = set()
    try:
        con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=30)
        existing = set(r[0] for r in con.execute("SELECT hash FROM media WHERE hash IS NOT NULL"))
        try:
            done_ids = set(r[0] for r in con.execute("SELECT immichId FROM migration_log WHERE status IN ('done','dup')"))
        except sqlite3.OperationalError:
            pass
        con.close()
    except Exception as e:
        print("[migrate] WARN reading DB:", e)
    print(f"[migrate] existing hashes={len(existing)}, already-processed={len(done_ids)}")

    # 기존 매니페스트 이어쓰기 (idempotent)
    manifest = []
    seen_in_manifest = set()
    if os.path.exists(MANIFEST):
        try:
            manifest = json.load(open(MANIFEST))
            for m in manifest:
                seen_in_manifest.add(m["immichId"])
                if m.get("hash"):
                    existing.add(m["hash"])
        except Exception:
            manifest = []

    n_copy = n_dup = n_missing = n_err = n_skip = 0
    t0 = time.time()
    for i, (aid, opath, ofname, atype, ldt, lpv, w, h, lat, lng) in enumerate(parsed):
        if aid in done_ids or aid in seen_in_manifest:
            n_skip += 1
            continue
        try:
            src = host_path(opath)
            if not src or not os.path.exists(src):
                n_missing += 1
                continue
            size = os.path.getsize(src)
            with open(src, "rb") as f:
                hsh = quick_hash_fp(f, size)
            if hsh in existing:
                n_dup += 1
                continue
            ext = os.path.splitext(opath)[1].lower()
            newname = str(uuid.uuid4()) + ext
            dst = os.path.join(ORIGINALS, newname)
            tmp = dst + ".part"
            # btrfs reflink(COW) 복제 — 즉시 + 추가 공간 0. 실패 시 일반 복사 폴백.
            rc = subprocess.run(["cp", "--reflink=always", src, tmp], capture_output=True)
            if rc.returncode != 0:
                shutil.copyfile(src, tmp)
            os.rename(tmp, dst)
            existing.add(hsh)
            group = lpv if lpv else (aid if aid in referenced else None)
            entry = {
                "immichId": aid, "newName": newname, "originalName": ofname,
                "mime": EXT_MIME.get(ext, "application/octet-stream"),
                "type": "video" if atype == "VIDEO" else "image",
                "size": size, "width": int(w) if w else None, "height": int(h) if h else None,
                "takenAt": ldt, "lat": float(lat) if lat else None, "lng": float(lng) if lng else None,
                "livePhotoGroup": group, "hash": hsh,
            }
            manifest.append(entry)
            seen_in_manifest.add(aid)
            n_copy += 1
        except Exception as e:
            n_err += 1
            if n_err <= 10:
                print("[migrate] ERR", aid, str(e)[:160])
        if (i + 1) % 200 == 0:
            json.dump(manifest, open(MANIFEST, "w"))
            print(f"[migrate] {i+1}/{len(parsed)} copy={n_copy} dup={n_dup} miss={n_missing} err={n_err} | {time.time()-t0:.0f}s")

    json.dump(manifest, open(MANIFEST, "w"))
    print(f"[migrate] DONE copy={n_copy} dup={n_dup} missing={n_missing} err={n_err} skip(done)={n_skip} | manifest={len(manifest)} | {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
