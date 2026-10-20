#!/usr/bin/python3
"""Installed root-owned as /usr/local/bin/markshare-deploy on the VPS.

The CI SSH key is restricted to this command. No interactive shell, forwarding,
or arbitrary deployment commands are allowed. Configuration contains resource
IDs only; every deployment creates and revokes its own short-lived API token.
"""
import datetime
import argparse
import fcntl
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request


GLOBAL_LOCK = pathlib.Path('/home/ubuntu/.codex/deployments/markshare-deploy.lock')

# Credentials travel over SSH stdin. Keep the previous Docker configuration in
# this root child's memory and restore it when stdin closes, even if the caller
# exits unexpectedly. Coolify mounts this file into its pull helper read-only.
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


class RegistryAuth:
    def __init__(self, credentials):
        self.credentials = credentials
        self.process = None

    def __enter__(self):
        self.process = subprocess.Popen(
            ['/usr/bin/sudo', '-n', '/usr/bin/python3', '-c', REGISTRY_AUTH_HELPER],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True,
        )
        try:
            self.process.stdin.write(json.dumps(self.credentials) + '\n')
            self.process.stdin.flush()
            if self.process.stdout.readline().strip() != 'READY':
                raise RuntimeError('無法設定短效 GHCR 登入；原始輸出已隱藏')
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
                raise RuntimeError('短效 GHCR 登入清理失敗，請檢查 VPS Docker 登入設定')


def deployment_input(command, stream):
    match = re.fullmatch(r'deploy ([0-9a-f]{40}) (sha256:[0-9a-f]{64}) (sha256:[0-9a-f]{64})', command)
    if not match:
        raise RuntimeError('僅接受 commit 與前後端固定 SHA256 digest 的部署指令')
    raw = stream.read(4097)
    try:
        credentials = json.loads(raw)
    except (ValueError, TypeError):
        raise RuntimeError('部署登入資料格式不正確') from None
    if (len(raw) > 4096 or not isinstance(credentials, dict)
            or set(credentials) != {'username', 'token'}
            or not isinstance(credentials['username'], str)
            or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}', credentials['username'])
            or not isinstance(credentials['token'], str)
            or not 20 <= len(credentials['token']) <= 2048):
        raise RuntimeError('部署登入資料格式不正確')
    return match.group(1), dict(zip(('backend', 'frontend'), match.groups()[1:])), credentials


def verify_image(image, repository, sha, environment):
    subprocess.run(docker('pull', image), check=True, stdout=subprocess.DEVNULL)
    result = subprocess.run(docker('image', 'inspect', image, '--format', '{{json .Config.Labels}}'),
                            capture_output=True, text=True, check=True)
    labels = json.loads(result.stdout) or {}
    expected = {'org.opencontainers.image.source': 'https://github.com/' + repository,
                'org.opencontainers.image.revision': sha,
                'org.opencontainers.image.version': environment + '-' + sha}
    if any(labels.get(key) != value for key, value in expected.items()):
        raise RuntimeError('映像的儲存庫、commit 或目標環境與本次部署不符')


def configure_image(client, app_uuid, image_name, digest, branch, sha):
    # Coolify 4.4 represents a digest as a sha256-<hex> image tag internally.
    client.request('PATCH', '/applications/' + app_uuid, {
        'build_pack': 'dockerimage', 'dockerfile': None,
        'docker_registry_image_name': image_name,
        'docker_registry_image_tag': digest.replace(':', '-', 1),
        'git_branch': branch, 'git_commit_sha': sha,
        'use_build_server': False, 'is_auto_deploy_enabled': False,
    })


class TemporaryCoolifyError(RuntimeError):
    """A status query can be retried without starting another deployment."""


def docker(*arguments):
    return ['/usr/bin/sudo', '-n', '/usr/bin/docker', *arguments]


def php(code):
    result = subprocess.run(
        docker('exec', 'coolify', 'php', 'artisan', 'tinker', '--execute', code),
        capture_output=True, text=True, check=True,
    )
    # Do not include stdout in failures: token creation returns credentials.
    try:
        return json.loads(result.stdout.strip())
    except json.JSONDecodeError:
        raise RuntimeError('Coolify 管理指令未回傳預期結果；輸出已隱藏') from None


class Coolify:
    def __init__(self, config, sha):
        self.config = config
        self.sha = sha
        self.credential = None

    def __enter__(self):
        team = int(self.config['team_id'])
        user = int(self.config['user_id'])
        self.credential = php(
            f"session(['currentTeam'=>App\\Models\\Team::findOrFail({team})]);"
            f"$t=App\\Models\\User::findOrFail({user})->createToken("
            f"'markshare-cd-{self.sha[:12]}', ['read','write','deploy'], now()->addMinutes(90));"
            "echo json_encode(['token'=>$t->plainTextToken,'id'=>$t->accessToken->id,"
            "'api_was_enabled'=>instanceSettings()->is_api_enabled]);"
        )
        try:
            self.request('POST', '/enable')
        except Exception:
            self.__exit__(None, None, None)
            raise
        return self

    def __exit__(self, *_):
        if not self.credential:
            return
        try:
            if not self.credential['api_was_enabled']:
                self.request('POST', '/disable')
        finally:
            token_id = int(self.credential['id'])
            php(f"echo json_encode(App\\Models\\PersonalAccessToken::whereKey({token_id})->delete());")

    def request(self, method, path, body=None, _retried=False):
        headers = {'Authorization': 'Bearer ' + self.credential['token'], 'Accept': 'application/json'}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(
            'http://127.0.0.1:8000/api/v1' + path,
            data=data, headers=headers, method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if method == 'GET' and error.code in (429, 500, 502, 503, 504):
                raise TemporaryCoolifyError('Coolify 狀態查詢暫時無法使用') from None
            # Another local maintenance process may restore the shared API flag.
            # Restore our deployment context once; never retry authorization errors.
            if error.code == 403 and not _retried and path not in ('/enable', '/disable'):
                try:
                    disabled = json.load(error).get('message') == 'API is disabled.'
                except (ValueError, AttributeError):
                    disabled = False
                if disabled:
                    self.request('POST', '/enable')
                    return self.request(method, path, body, _retried=True)
            raise RuntimeError(f'Coolify {method} {path}：HTTP {error.code}') from None

    def deploy(self, app_uuid):
        result = self.request('POST', '/deploy', {'uuid': app_uuid})
        deployment = result['deployments'][0]['deployment_uuid']
        print(f'等待 Coolify 部署：{deployment}', flush=True)
        previous = None
        deadline = time.monotonic() + 1200
        while time.monotonic() < deadline:
            try:
                state = self.request('GET', '/deployments/' + deployment)['status']
            except (TimeoutError, urllib.error.URLError, ConnectionError, TemporaryCoolifyError, json.JSONDecodeError):
                print('Coolify 狀態查詢暫時失敗，10 秒後重試；部署仍在進行', flush=True)
                time.sleep(10)
                continue
            if state != previous:
                print(f'部署狀態：{state}', flush=True)
                previous = state
            if state == 'finished':
                return deployment
            if state in ('failed', 'cancelled'):
                raise RuntimeError('部署未成功，請至 Coolify 查看記錄')
            time.sleep(10)
        raise RuntimeError('等待部署超過 20 分鐘')


def github(config, path):
    result = subprocess.run(
        ['/usr/bin/gh', 'api', 'repos/' + config['repository'] + path],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


def verify_https(url, expect_json=False):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'})
            with urllib.request.urlopen(request, timeout=10) as response:
                if response.status == 200 and (not expect_json or json.load(response).get('ok') is True):
                    return
        except (OSError, ValueError):
            pass
        time.sleep(5)
    raise RuntimeError('HTTPS 驗證失敗：' + url)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', choices=('markshare', 'musicchallenge'), default='markshare')
    parser.add_argument('--environment', choices=('production', 'develop'), default='production')
    args = parser.parse_args()
    environment = args.environment
    if args.project == 'musicchallenge' and environment != 'production':
        raise RuntimeError('MusicChallenge 僅提供正式環境')
    branch = 'main' if environment == 'production' else 'develop'
    label = '正式環境' if environment == 'production' else 'develop 環境'
    command = os.environ.get('SSH_ORIGINAL_COMMAND', '')
    sha, digests, credentials = deployment_input(command, sys.stdin)
    suffix = '-develop' if environment == 'develop' else ''
    config_path = f'/etc/{args.project}-deploy{suffix}.json'
    config = json.loads(pathlib.Path(config_path).read_text())
    state_directory = pathlib.Path(config['state_directory'])
    state_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Both environments share the VPS, build capacity and Coolify API flag.
    global_lock_fd = os.open(GLOBAL_LOCK, os.O_WRONLY | os.O_CREAT, 0o600)
    with os.fdopen(global_lock_fd, 'w') as global_lock, (state_directory / 'deploy.lock').open('w') as lock:
        fcntl.flock(global_lock, fcntl.LOCK_EX)
        fcntl.flock(lock, fcntl.LOCK_EX)
        if github(config, '/commits/' + branch)['sha'] != sha:
            raise RuntimeError(f'此 commit 已不是 {branch} 最新版本，略過過期部署')
        checks = github(config, '/commits/' + sha + '/check-runs?per_page=100')['check_runs']
        for required in config['required_checks']:
            matching = [check for check in checks
                        if check['name'] == required and check.get('app', {}).get('slug') == 'github-actions']
            latest = max(matching, key=lambda check: check['id']) if matching else None
            if not latest or latest.get('conclusion') != 'success':
                raise RuntimeError('必要 CI 尚未通過：' + required)
        image_prefix = 'ghcr.io/' + config['repository'].lower()
        images = {kind: image_prefix + '-' + kind + '@' + digest for kind, digest in digests.items()}
        with RegistryAuth(credentials), Coolify(config, sha) as client:
            for image in images.values():
                verify_image(image, config['repository'], sha, environment)
            backup = backup_database(config, state_directory, sha)
            # Save only fields touched by the conversion; never save env values.
            fields = ('build_pack', 'dockerfile', 'docker_registry_image_name',
                      'docker_registry_image_tag', 'git_branch', 'git_commit_sha')
            previous = {}
            for kind in ('backend', 'frontend'):
                app_uuid = config[kind + '_uuid']
                current = client.request('GET', '/applications/' + app_uuid)
                previous[app_uuid] = {key: current.get(key) for key in fields}
            previous_path = state_directory / 'previous-image-config.json'
            previous_path.write_text(json.dumps(previous, indent=2))
            previous_path.chmod(0o600)
            for kind in ('backend', 'frontend'):
                configure_image(client, config[kind + '_uuid'], image_prefix + '-' + kind,
                                digests[kind], branch, sha)
            backend_deployment = client.deploy(config['backend_uuid'])
            verify_https(config.get('api_health_url', 'https://api.markshare.net/health'), expect_json=True)
            frontend_deployment = client.deploy(config['frontend_uuid'])
            verify_https(config.get('frontend_url', 'https://markshare.net'))
            verify_https(config.get('api_health_url', 'https://api.markshare.net/health'), expect_json=True)
        receipt = {'environment': environment, 'branch': branch, 'commit': sha, 'images': images,
                   'backup': str(backup), 'backend_deployment': backend_deployment,
                   'frontend_deployment': frontend_deployment,
                   'completed_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        receipt_path = state_directory / 'last-cd-deployment.json'
        receipt_path.write_text(json.dumps(receipt, indent=2))
        receipt_path.chmod(0o600)
        prune_backups(config, state_directory)
        print(f'{args.project} {label}部署與 HTTPS 驗證完成：' + sha, flush=True)


def backup_database(config, state_directory, sha):
    if config.get('database_kind') == 'sqlite':
        result = subprocess.run(['/usr/bin/sudo', '-n', '/usr/local/sbin/musicchallenge-backup',
                                 '--kind', 'predeploy', '--commit', sha],
                                capture_output=True, text=True, check=True)
        backup = pathlib.Path(json.loads(result.stdout)['backup'])
    else:
        backup_directory = state_directory / 'backups'
        backup_directory.mkdir(mode=0o700, exist_ok=True)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup = backup_directory / f'predeploy-{stamp}-{sha[:12]}.dmp'
        fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as output:
            subprocess.run(docker('exec', config['database_uuid'], 'pg_dump', '-U', config.get('database_user', 'markshare'), '-d', config.get('database_name', 'markshare'), '-Fc'), stdout=output, check=True)
    print('已完成部署前資料庫備份', flush=True)
    return backup


def prune_backups(config, state_directory):
    cutoff = time.time() - config.get('backup_retention_days', 7) * 24 * 60 * 60
    snapshots = sorted((state_directory / 'backups').glob('predeploy-*.dmp'), key=lambda path: path.stat().st_mtime, reverse=True)
    for index, snapshot in enumerate(snapshots):
        if re.fullmatch(r'predeploy-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}\.dmp', snapshot.name):
            if index >= config.get('backup_retention_count', 14) or snapshot.stat().st_mtime < cutoff:
                snapshot.unlink()


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise RuntimeError('部署連線中斷，正在清理臨時 API 憑證')
    for termination_signal in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(termination_signal, interrupted)
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError) as error:
        print('部署失敗：' + str(error), file=sys.stderr, flush=True)
        sys.exit(1)
