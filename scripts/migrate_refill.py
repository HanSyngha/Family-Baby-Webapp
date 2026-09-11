#!/usr/bin/env python3
"""
이관 보충(refill): 매니페스트엔 있으나 originals에 실제 파일이 없는 항목을
Immich 소스에서 reflink로 재복사한다 (cleanupOrphanFiles가 삭제한 것 복구).
매니페스트의 newName을 그대로 재사용하므로, 이후 INSERT가 정상 동작.

사용: python3 migrate_refill.py
"""
import json, os, subprocess

IMMICH_HOST_LIB = "/volume1/docker/immich/library"
IMMICH_CONTAINER_PREFIX = "/usr/src/app/upload/"
FAMILY_DATA = "/volume1/docker/peanut-family/data"
ORIGINALS = os.path.join(FAMILY_DATA, "originals")
MANIFEST = os.path.join(FAMILY_DATA, "immich-manifest.json")


def host_path(p):
    return os.path.join(IMMICH_HOST_LIB, p[len(IMMICH_CONTAINER_PREFIX):]) if p.startswith(IMMICH_CONTAINER_PREFIX) else None


def main():
    manifest = json.load(open(MANIFEST))
    missing = [e for e in manifest if not os.path.exists(os.path.join(ORIGINALS, e["newName"]))]
    print(f"[refill] manifest={len(manifest)}, 파일없음={len(missing)}")
    if not missing:
        print("[refill] 보충할 것 없음")
        return

    # Immich 전체 id->originalPath 매핑 (한 번에)
    out = subprocess.run(
        ["docker", "exec", "immich_postgres", "psql", "-U", "postgres", "-d", "immich",
         "-t", "-A", "-F", "\t", "-c", 'SELECT id, "originalPath" FROM asset'],
        capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError("psql failed: " + out.stderr)
    id2path = {}
    for line in out.stdout.split("\n"):
        if "\t" in line:
            i, p = line.split("\t", 1)
            id2path[i] = p

    n_ok = n_err = 0
    for e in missing:
        src = host_path(id2path.get(e["immichId"], ""))
        dst = os.path.join(ORIGINALS, e["newName"])
        tmp = dst + ".part"
        try:
            if not src or not os.path.exists(src):
                n_err += 1; continue
            rc = subprocess.run(["cp", "--reflink=always", src, tmp], capture_output=True)
            if rc.returncode != 0:
                import shutil
                shutil.copyfile(src, tmp)
            os.rename(tmp, dst)
            n_ok += 1
        except Exception as ex:
            n_err += 1
            if n_err <= 10:
                print("[refill] ERR", e["immichId"], str(ex)[:120])
        if (n_ok + n_err) % 500 == 0:
            print(f"[refill] {n_ok+n_err}/{len(missing)} ok={n_ok} err={n_err}")

    print(f"[refill] DONE ok={n_ok} err={n_err}")
    still = sum(1 for e in manifest if not os.path.exists(os.path.join(ORIGINALS, e["newName"])))
    print(f"[refill] 남은 파일없음: {still}")


if __name__ == "__main__":
    main()
