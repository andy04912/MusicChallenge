#!/usr/bin/python3
"""Deploy a release to a Coolify Docker Compose service by pinned image digest.

Installed root-owned on the VPS as /usr/local/bin/<project>-deploy and reached
only through a restricted SSH key (forced command). The only accepted request is
`deploy <commit> <backend digest> <frontend digest>`; GHCR credentials arrive on
stdin as JSON and exist only while the deployment runs. Per-project settings
live in /etc/<project>-deploy.json (resource IDs and URLs, never secrets).
"""
import argparse
import base64
import datetime
import fcntl
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

LOCK_PATH = pathlib.Path('/home/ubuntu/.local/state/compose-deploy/deploy.lock')
COOLIFY_API = 'http://127.0.0.1:8000/api/v1'
DIGEST = r'sha256:[0-9a-f]{64}'
KINDS = ('backend', 'frontend')
KEEP_BACKUPS = 14

# Credentials travel over SSH stdin. Keep the previous Docker configuration in
# this root child's memory and restore it when stdin closes, even if the caller
# exits unexpectedly. Coolify's `docker compose pull` reads this file.
REGISTRY_AUTH_HELPER = r'''
import base64,json,os,pathlib,sys,tempfile
path=pathlib.Path('/root/.docker/config.json')
path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
previous=path.read_bytes() if path.exists() else None
def write(data):
    fd,name=tempfile.mkstemp(prefix='.ghcr-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as stream: stream.write(data)
        os.replace(name,path)
    finally:
        if os.path.exists(name): os.unlink(name)
credentials=json.loads(sys.stdin.readline())
config=json.loads(previous) if previous else {}
auth=base64.b64encode((credentials['username']+':'+credentials['token']).encode()).decode()
config.setdefault('auths',{})['ghcr.io']={'auth':auth}
try:
    write(json.dumps(config).encode())
    print('READY',flush=True)
    sys.stdin.read()
finally:
    if previous is None: path.unlink(missing_ok=True)
    else: write(previous)
'''

# Consistent SQLite snapshot of a Docker volume (never copies live WAL files).
SQLITE_BACKUP_HELPER = r'''
import gzip,hashlib,json,os,pathlib,sqlite3,subprocess,sys,tempfile,urllib.parse
volume,filename,target=sys.argv[1:4]
mount=subprocess.check_output(['/usr/bin/docker','volume','inspect',volume,'--format','{{.Mountpoint}}'],text=True).strip()
source=pathlib.Path(mount)/filename
if not source.is_file(): raise SystemExit('資料庫檔案不存在，未建立備份')
target=pathlib.Path(target)
os.umask(0o077)
with tempfile.TemporaryDirectory(prefix='.backup-',dir=target.parent) as tmp:
    raw=pathlib.Path(tmp)/'db.sqlite'
    with sqlite3.connect('file:'+urllib.parse.quote(str(source))+'?mode=ro',uri=True,timeout=30) as src, sqlite3.connect(raw) as dst:
        src.backup(dst,pages=256,sleep=.05)
        if dst.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise SystemExit('備份完整性檢查失敗')
        tables=[(n,dst.execute('SELECT count(*) FROM "'+n.replace('"','""')+'"').fetchone()[0]) for n, in dst.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    data=raw.read_bytes()
target.write_bytes(gzip.compress(data,compresslevel=6))
os.chown(target,1000,1000)
print(json.dumps({'file':str(target),'sha256':hashlib.sha256(data).hexdigest(),'tables':dict(tables)}))
'''


class DeployError(RuntimeError):
    """A failure whose message is safe to show in the GitHub Actions log."""


def docker(*arguments):
    return ['/usr/bin/sudo', '-n', '/usr/bin/docker', *arguments]


def parse_command(command):
    match = re.fullmatch(rf'deploy ([0-9a-f]{{40}}) ({DIGEST}) ({DIGEST})', command or '')
    if not match:
        raise DeployError('僅接受 commit 與前後端固定 SHA256 digest 的部署指令')
    return match.group(1), dict(zip(KINDS, match.groups()[1:]))


def read_credentials(stream):
    raw = stream.read(4097)
    try:
        credentials = json.loads(raw)
    except (ValueError, TypeError):
        raise DeployError('部署登入資料格式不正確') from None
    if (len(raw) > 4096 or not isinstance(credentials, dict)
            or set(credentials) != {'username', 'token'}
            or not isinstance(credentials['username'], str)
            or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}', credentials['username'])
            or not isinstance(credentials['token'], str)
            or not 20 <= len(credentials['token']) <= 2048):
        raise DeployError('部署登入資料格式不正確')
    return credentials


def set_image_digests(compose, image_prefix, digests):
    """Return `compose` with each service image pinned to the new digest.

    Exactly one `image: <prefix>-<kind>@sha256:...` line must exist per kind, so
    a hand-edited Compose file can never be half-updated.
    """
    result = compose
    for kind in KINDS:
        pattern = re.compile(
            r'(?m)^(\s*image:\s*[\'"]?' + re.escape(image_prefix + '-' + kind) + r'@)' + DIGEST + r'([\'"]?\s*)$')
        result, count = pattern.subn(lambda m, d=digests[kind]: m.group(1) + d + m.group(2), result)
        if count != 1:
            raise DeployError(f'Coolify 的 Compose 內找不到唯一的 {kind} 映像設定')
    return result


def current_digests(compose, image_prefix):
    found = {}
    for kind in KINDS:
        match = re.search(re.escape(image_prefix + '-' + kind) + '@(' + DIGEST + ')', compose)
        found[kind] = match.group(1) if match else None
    return found


class RegistryAuth:
    def __init__(self, credentials):
        self.credentials = credentials
        self.process = None

    def __enter__(self):
        self.process = subprocess.Popen(
            ['/usr/bin/sudo', '-n', '/usr/bin/python3', '-c', REGISTRY_AUTH_HELPER],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        try:
            self.process.stdin.write(json.dumps(self.credentials) + '\n')
            self.process.stdin.flush()
            if self.process.stdout.readline().strip() != 'READY':
                raise DeployError('無法設定短效 GHCR 登入；原始輸出已隱藏')
        except BaseException:
            self.__exit__(None, None, None)
            raise
        return self

    def __exit__(self, *_):
        if self.process:
            self.process.stdin.close()
            result = self.process.wait(timeout=30)
            self.process.stdout.close()
            if result:
                raise DeployError('短效 GHCR 登入清理失敗，請檢查 VPS Docker 登入設定')


class Coolify:
    def __init__(self, token_file):
        self.token = pathlib.Path(token_file).read_text().strip()

    def request(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(COOLIFY_API + path, data=data, method=method, headers={
            'Authorization': 'Bearer ' + self.token, 'Accept': 'application/json',
            'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise DeployError(f'Coolify API {method} {path} 失敗：HTTP {error.code}') from None
        except (OSError, ValueError) as error:
            raise DeployError(f'Coolify API {method} {path} 無法連線：{type(error).__name__}') from None

    def compose(self, uuid):
        return self.request('GET', '/services/' + uuid)['docker_compose_raw']

    def apply(self, uuid, compose):
        self.request('PATCH', '/services/' + uuid,
                     {'docker_compose_raw': base64.b64encode(compose.encode()).decode()})
        self.request('POST', '/services/' + uuid + '/restart')


def github(config, path):
    result = subprocess.run(['/usr/bin/gh', 'api', 'repos/' + config['repository'] + path],
                            capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def verify_image(image, repository, sha):
    subprocess.run(docker('pull', '-q', image), check=True, stdout=subprocess.DEVNULL)
    result = subprocess.run(docker('image', 'inspect', image, '--format', '{{json .Config.Labels}}'),
                            capture_output=True, text=True, check=True)
    labels = json.loads(result.stdout) or {}
    expected = {'org.opencontainers.image.source': 'https://github.com/' + repository,
                'org.opencontainers.image.revision': sha,
                'org.opencontainers.image.version': 'production-' + sha}
    if any(labels.get(key) != value for key, value in expected.items()):
        raise DeployError('映像的儲存庫、commit 或目標環境與本次部署不符')


def container_state(name):
    result = subprocess.run(docker('inspect', name, '--format',
                                   '{{.Config.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}'),
                            capture_output=True, text=True)
    if result.returncode:
        return None
    image, status, health = result.stdout.strip().split('|')
    return image, status, health


def wait_for_containers(config, digests, timeout=420):
    """Wait until every container runs the requested image and is healthy."""
    deadline = time.monotonic() + timeout
    expected = {config['containers'][kind]: digests[kind] for kind in KINDS if digests.get(kind)}
    pending = {}
    while time.monotonic() < deadline:
        pending = {}
        for name, digest in expected.items():
            state = container_state(name)
            ok = state and state[0].endswith(digest) and state[1] == 'running' and state[2] in ('', 'healthy')
            if not ok:
                pending[name] = state
        for name in config.get('support_containers', []):
            state = container_state(name)
            if not state or state[1] != 'running' or state[2] not in ('', 'healthy'):
                pending[name] = state
        if not pending:
            return
        time.sleep(5)
    raise DeployError('容器未在時限內就緒：' + ', '.join(sorted(pending)))


def verify_https(url, expect_json=False, user_agent=None, timeout=120):
    deadline = time.monotonic() + timeout
    headers = {'Cache-Control': 'no-cache'}
    if user_agent:
        headers['User-Agent'] = user_agent
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=10) as response:
                if response.status == 200 and (not expect_json or json.load(response).get('ok') is True):
                    return
        except (OSError, ValueError):
            pass
        time.sleep(5)
    raise DeployError('HTTPS 驗證失敗：' + url)


def backup_database(config, state_directory, sha):
    backups = state_directory / 'backups'
    backups.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    kind = config['database']['kind']
    if kind == 'sqlite':
        target = backups / f'predeploy-{stamp}-{sha[:12]}.sqlite.gz'
        result = subprocess.run(['/usr/bin/sudo', '-n', '/usr/bin/python3', '-I', '-c', SQLITE_BACKUP_HELPER,
                                 config['database']['volume'], config['database']['filename'], str(target)],
                                capture_output=True, text=True)
        if result.returncode:
            raise DeployError('SQLite 備份失敗：' + (result.stderr.strip().splitlines() or ['未知錯誤'])[-1])
    elif kind == 'postgres':
        target = backups / f'predeploy-{stamp}-{sha[:12]}.dump'
        container, user, name = (config['database'][key] for key in ('container', 'user', 'name'))
        with target.open('wb') as out:
            dump = subprocess.run(docker('exec', container, 'pg_dump', '-U', user, '-Fc', name), stdout=out)
        if dump.returncode:
            target.unlink(missing_ok=True)
            raise DeployError('PostgreSQL 備份失敗')
        with target.open('rb') as source:
            listing = subprocess.run(docker('exec', '-i', container, 'pg_restore', '--list'),
                                     stdin=source, capture_output=True)
        if listing.returncode or not listing.stdout.strip():
            raise DeployError('PostgreSQL 備份驗證失敗')
        target.chmod(0o600)
    else:
        raise DeployError('不支援的資料庫類型')
    for old in sorted(backups.glob('predeploy-*'), reverse=True)[KEEP_BACKUPS:]:
        old.unlink()
    return target


def deploy(config, project, sha, digests, credentials, dry_run=False):
    state_directory = pathlib.Path(config['state_directory'])
    state_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    LOCK_PATH.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    branch = config.get('branch', 'main')
    image_prefix = 'ghcr.io/' + config['repository'].lower()
    uuid = config['service_uuid']
    if not re.fullmatch(r'[A-Za-z0-9]{10,40}', uuid):
        raise DeployError('Coolify 資源識別碼格式不正確')
    with LOCK_PATH.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if github(config, '/commits/' + branch)['sha'] != sha:
            raise DeployError(f'此 commit 已不是 {branch} 最新版本，略過過期部署')
        checks = github(config, '/commits/' + sha + '/check-runs?per_page=100')['check_runs']
        for required in config['required_checks']:
            matching = [c for c in checks
                        if c['name'] == required and c.get('app', {}).get('slug') == 'github-actions']
            latest = max(matching, key=lambda c: c['id']) if matching else None
            if not latest or latest.get('conclusion') != 'success':
                raise DeployError('必要 CI 尚未通過：' + required)
        print('CI 檢查與最新 commit 驗證通過', flush=True)
        client = Coolify(config['coolify_token_file'])
        previous = client.compose(uuid)
        previous_digests = current_digests(previous, image_prefix)
        updated = set_image_digests(previous, image_prefix, digests)
        with RegistryAuth(credentials):
            for kind in KINDS:
                verify_image(f'{image_prefix}-{kind}@{digests[kind]}', config['repository'], sha)
            print('映像來源、commit 與環境標籤驗證通過', flush=True)
            if dry_run:
                for kind in KINDS:
                    mark = '（相同，無變更）' if previous_digests[kind] == digests[kind] else ''
                    print(f'[dry-run] {kind}: {(previous_digests[kind] or "未知")[:19]} -> {digests[kind][:19]}{mark}', flush=True)
                print('[dry-run] 未備份、未修改 Coolify、未重啟服務', flush=True)
                return
            backup = backup_database(config, state_directory, sha)
            print('部署前資料庫備份完成：' + backup.name, flush=True)
            previous_path = state_directory / 'previous-compose.yaml'
            previous_path.write_text(previous)
            previous_path.chmod(0o600)
            try:
                client.apply(uuid, updated)
                wait_for_containers(config, digests)
                for check in config['health_checks']:
                    verify_https(check['url'], check.get('json', False), check.get('user_agent'))
            except BaseException as failure:
                print(f'部署失敗，回復到前一版：{failure}', file=sys.stderr, flush=True)
                client.apply(uuid, previous)
                try:
                    wait_for_containers(config, previous_digests)
                    print('已回復到前一版並通過容器檢查', file=sys.stderr, flush=True)
                except DeployError as rollback_failure:
                    print(f'警告：回復後仍未就緒：{rollback_failure}', file=sys.stderr, flush=True)
                raise
        receipt = {'project': project, 'commit': sha, 'images': digests, 'backup': str(backup),
                   'completed_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        receipt_path = state_directory / 'last-cd-deployment.json'
        receipt_path.write_text(json.dumps(receipt, indent=2))
        receipt_path.chmod(0o600)
        print(f'{project} 部署與 HTTPS 驗證完成：' + sha, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', choices=('markshare', 'musicchallenge'), default='markshare')
    parser.add_argument('--environment', choices=('production',), default='production')
    # Local admin use only: a forced-command SSH key can never pass flags.
    parser.add_argument('--dry-run', action='store_true', help='run every check but change nothing')
    args = parser.parse_args()
    try:
        sha, digests = parse_command(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
        credentials = read_credentials(sys.stdin)
        config = json.loads(pathlib.Path(f'/etc/{args.project}-deploy.json').read_text())
        deploy(config, args.project, sha, digests, credentials, args.dry_run)
    except DeployError as error:
        print(f'部署失敗：{error}', file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as error:
        print(f'部署失敗：指令 {os.path.basename(error.cmd[0])} 回傳 {error.returncode}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
