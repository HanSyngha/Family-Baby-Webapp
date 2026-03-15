#!/usr/bin/env python3
"""
땅콩페밀리 NAS 배포 스크립트
tar로 묶어서 단일 전송 후 docker compose 재빌드
"""
import paramiko
import os
import sys
import time
import tarfile
import io

NAS_HOST = 'syngha.synology.me'
NAS_PORT = 7348
NAS_USER = 'syngha_han'
NAS_PASS = 'Test1234!'
REMOTE_DIR = '/volume1/docker/peanut-family'
LOCAL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EXCLUDE_DIRS = {
    'node_modules', 'dist', 'data', '.git',
    '.playwright-mcp', '__pycache__', '.claude',
}

EXCLUDE_FILES = {
    '.env',
    'Gemini_Generated_Image_l51drfl51drfl51d.png',
}

def should_skip(rel_path: str) -> bool:
    parts = rel_path.split(os.sep)
    for part in parts:
        if part in EXCLUDE_DIRS:
            return True
    if os.path.basename(rel_path) in EXCLUDE_FILES:
        return True
    return False

def connect():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(NAS_HOST, port=NAS_PORT, username=NAS_USER, password=NAS_PASS,
                timeout=15, look_for_keys=False, allow_agent=False)
    return ssh

def create_tarball() -> bytes:
    """Create in-memory tarball of project files."""
    buf = io.BytesIO()
    count = 0
    with tarfile.open(fileobj=buf, mode='w:gz') as tar:
        for root, dirs, filenames in os.walk(LOCAL_DIR):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            for f in filenames:
                local_path = os.path.join(root, f)
                rel_path = os.path.relpath(local_path, LOCAL_DIR)
                if should_skip(rel_path):
                    continue
                tar.add(local_path, arcname=rel_path)
                count += 1
    print(f'[Deploy] Tarball: {count} files, {buf.tell() // 1024}KB')
    return buf.getvalue()

def upload_via_shell(ssh: paramiko.SSHClient, tarball: bytes):
    """Upload tarball via a single interactive shell session using stdin pipe."""
    import base64

    # Split base64 into chunks and write via shell
    encoded = base64.b64encode(tarball).decode('ascii')
    CHUNK = 60000  # characters per echo command

    # Use a single exec_command to receive piped data
    cmd = f'cat > /tmp/deploy.tar.gz'
    chan = ssh.get_transport().open_session()
    chan.exec_command(cmd)

    # Send raw bytes directly to stdin
    sent = 0
    SEND_CHUNK = 32768
    while sent < len(tarball):
        chunk = tarball[sent:sent+SEND_CHUNK]
        chan.sendall(chunk)
        sent += len(chunk)
    chan.shutdown_write()
    chan.recv_exit_status()
    chan.close()

    print(f'[Deploy] Tarball uploaded ({sent // 1024}KB)')

    # Extract on NAS
    _, stdout, stderr = ssh.exec_command(
        f'cd {REMOTE_DIR} && tar xzf /tmp/deploy.tar.gz && rm /tmp/deploy.tar.gz && echo "EXTRACT_OK"',
        timeout=60
    )
    out = stdout.read().decode()
    err = stderr.read().decode()
    if 'EXTRACT_OK' in out:
        print('[Deploy] Extracted successfully!')
    else:
        print(f'[Deploy] Extract output: {out}')
        if err:
            print(f'[Deploy] Extract stderr: {err}')

def run_command(ssh: paramiko.SSHClient, cmd: str, timeout: int = 300) -> tuple[str, str]:
    print(f'  $ {cmd[:120]}...' if len(cmd) > 120 else f'  $ {cmd}')
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        for line in out.strip().split('\n')[:30]:
            print(f'  {line}')
    if err.strip():
        for line in err.strip().split('\n')[:30]:
            print(f'  [stderr] {line}')
    if exit_code != 0:
        print(f'  [exit code: {exit_code}]')
    return out, err

def main():
    build_only = '--build-only' in sys.argv
    upload_only = '--upload-only' in sys.argv

    print(f'[Deploy] Connecting to {NAS_HOST}:{NAS_PORT}...')
    ssh = connect()
    print('[Deploy] Connected!')

    if not build_only:
        print('[Deploy] Creating tarball...')
        tarball = create_tarball()

        print('[Deploy] Uploading...')
        upload_via_shell(ssh, tarball)

    if not upload_only:
        # Reconnect for build (long-running command)
        try:
            ssh.exec_command('echo ok', timeout=5)
        except Exception:
            print('[Deploy] Reconnecting for build...')
            time.sleep(2)
            ssh = connect()

        print('[Deploy] Building and restarting...')
        build_cmd = (
            f'cd {REMOTE_DIR} && '
            'export PATH=/usr/local/bin:$PATH && '
            'docker compose build 2>&1 && '
            'docker compose down 2>&1 && '
            'docker compose up -d 2>&1'
        )
        run_command(ssh, build_cmd, timeout=600)

        print('[Deploy] Checking container status...')
        run_command(ssh, 'export PATH=/usr/local/bin:$PATH && docker ps | grep peanut')

        print('[Deploy] Waiting 5s for container startup...')
        time.sleep(5)

        print('[Deploy] Recent logs...')
        run_command(ssh, f'export PATH=/usr/local/bin:$PATH && docker logs --tail 30 peanut-family-peanut-family-1 2>&1')

    ssh.close()
    print('[Deploy] Done!')

if __name__ == '__main__':
    main()
