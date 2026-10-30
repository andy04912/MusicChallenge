import importlib.util
import contextlib
import copy
import http.server
import io
import json
import pathlib
import tempfile
import threading
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('compose_deploy', pathlib.Path(__file__).with_name('compose_deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

SHA = 'a' * 40
OLD = {'backend': 'sha256:' + '1' * 64, 'frontend': 'sha256:' + '2' * 64}
NEW = {'backend': 'sha256:' + '3' * 64, 'frontend': 'sha256:' + '4' * 64}
PREFIX = 'ghcr.io/andy04912/markshare'
COMPOSE = f"""services:
  postgres:
    image: postgres:16-alpine
  backend:
    image: '{PREFIX}-backend@{OLD['backend']}'
    environment:
      JWT_SECRET: ${{JWT_SECRET:?}}
  frontend:
    image: {PREFIX}-frontend@{OLD['frontend']}
"""


class ParseCommandTests(unittest.TestCase):
    def test_accepts_exact_command(self):
        sha, digests = deploy.parse_command(f"deploy {SHA} {NEW['backend']} {NEW['frontend']}")
        self.assertEqual((sha, digests), (SHA, NEW))

    def test_rejects_anything_else(self):
        bad = ['', None, 'deploy', f"deploy {SHA[:39]} {NEW['backend']} {NEW['frontend']}",
               f"deploy {SHA.upper()} {NEW['backend']} {NEW['frontend']}",
               f"deploy {SHA} {NEW['backend']}", f"deploy {SHA} {NEW['backend']} {NEW['frontend']} extra",
               f"deploy {SHA} {NEW['backend']} {NEW['frontend']}; rm -rf /",
               f"deploy {SHA} sha256:{'g' * 64} {NEW['frontend']}", f"deploy {SHA} latest latest",
               f"shell {SHA} {NEW['backend']} {NEW['frontend']}"]
        for command in bad:
            with self.subTest(command=command), self.assertRaises(deploy.DeployError):
                deploy.parse_command(command)


class CredentialsTests(unittest.TestCase):
    def read(self, payload):
        return deploy.read_credentials(io.StringIO(payload if isinstance(payload, str) else json.dumps(payload)))

    def test_accepts_username_and_token_only(self):
        value = {'username': 'andy04912', 'token': 'x' * 40}
        self.assertEqual(self.read(value), value)

    def test_rejects_malformed_input(self):
        bad = ['', 'not json', '[]', {'username': 'andy04912'}, {'username': 'andy04912', 'token': 'short'},
               {'username': 'andy04912', 'token': 'x' * 40, 'extra': 1}, {'username': '-bad', 'token': 'x' * 40},
               {'username': 'a b', 'token': 'x' * 40}, {'username': 'andy04912', 'token': 'x' * 5000}]
        for payload in bad:
            with self.subTest(payload=str(payload)[:40]), self.assertRaises(deploy.DeployError):
                self.read(payload)


class ComposeDigestTests(unittest.TestCase):
    def test_replaces_both_images_and_nothing_else(self):
        result = deploy.set_image_digests(COMPOSE, PREFIX, NEW)
        self.assertIn(f"image: '{PREFIX}-backend@{NEW['backend']}'", result)
        self.assertIn(f"image: {PREFIX}-frontend@{NEW['frontend']}", result)
        self.assertNotIn(OLD['backend'], result)
        self.assertNotIn(OLD['frontend'], result)
        self.assertEqual(result.replace(NEW['backend'], OLD['backend']).replace(NEW['frontend'], OLD['frontend']), COMPOSE)

    def test_is_idempotent(self):
        once = deploy.set_image_digests(COMPOSE, PREFIX, NEW)
        self.assertEqual(deploy.set_image_digests(once, PREFIX, NEW), once)

    def test_refuses_missing_image(self):
        broken = COMPOSE.replace(f'{PREFIX}-frontend@{OLD["frontend"]}', f'{PREFIX}-frontend:latest')
        with self.assertRaises(deploy.DeployError):
            deploy.set_image_digests(broken, PREFIX, NEW)

    def test_refuses_duplicate_image(self):
        with self.assertRaises(deploy.DeployError):
            deploy.set_image_digests(COMPOSE + f"  other:\n    image: {PREFIX}-backend@{OLD['backend']}\n", PREFIX, NEW)

    def test_does_not_touch_other_repositories(self):
        other = COMPOSE.replace(PREFIX + '-backend', 'ghcr.io/someone/else-backend')
        with self.assertRaises(deploy.DeployError):
            deploy.set_image_digests(other, PREFIX, NEW)

    def test_current_digests(self):
        self.assertEqual(deploy.current_digests(COMPOSE, PREFIX), OLD)
        self.assertEqual(deploy.current_digests('services: {}', PREFIX), {'backend': None, 'frontend': None})


class VerifyHttpsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                code, body = {'/ok': (200, b'{"ok": true}'), '/notok': (200, b'{"ok": false}'),
                              '/login': (401, b'{"error": "login"}')}.get(self.path, (404, b'{}'))
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass

        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def check(self, path, **kwargs):
        return deploy.verify_https(self.base + path, timeout=1, interval=0.1, **kwargs)

    def test_accepts_expected_status_and_json(self):
        self.check('/ok')
        self.check('/ok', expect_json=True)

    def test_accepts_non_200_when_it_is_the_expected_answer(self):
        self.check('/login', status=401)

    def test_rejects_unexpected_status(self):
        for path, kwargs in (('/login', {}), ('/missing', {}), ('/ok', {'status': 401})):
            with self.subTest(path=path), self.assertRaises(deploy.DeployError):
                self.check(path, **kwargs)

    def test_rejects_json_without_ok_true(self):
        with self.assertRaises(deploy.DeployError):
            self.check('/notok', expect_json=True)

    def test_rejects_unreachable_host(self):
        with self.assertRaises(deploy.DeployError):
            deploy.verify_https('http://127.0.0.1:1/', timeout=1, interval=0.1)


UUID = 'abcdefghij1234567890'
CONFIG = {
    'repository': 'andy04912/MarkShare', 'service_uuid': UUID, 'branch': 'main',
    'required_checks': ['後端測試與建置', '建置與發布 GHCR 映像'],
    'coolify_token_file': '/home/ubuntu/.config/coolify/token', 'state_directory': '/home/ubuntu/backups/markshare',
    'containers': {'backend': 'backend-' + UUID, 'frontend': 'frontend-' + UUID},
    'support_containers': ['postgres-' + UUID],
    'database': {'kind': 'postgres', 'container': 'postgres-' + UUID, 'user': 'markshare', 'name': 'markshare'},
    'health_checks': [{'url': 'https://markshare.net/'},
                      {'url': 'https://markshare.net/api/auth/me', 'status': 401, 'user_agent': 'Check/1.0'}],
}


class ValidateConfigTests(unittest.TestCase):
    def test_accepts_a_complete_config(self):
        self.assertIs(deploy.validate_config(CONFIG), CONFIG)

    def test_accepts_sqlite_database(self):
        config = copy.deepcopy(CONFIG)
        config['database'] = {'kind': 'sqlite', 'volume': UUID + '_songs-data', 'filename': 'songs.sqlite'}
        deploy.validate_config(config)

    def test_rejects_each_kind_of_mistake(self):
        def mutate(change):
            config = copy.deepcopy(CONFIG)
            change(config)
            return config
        bad = {
            'not an object': [],
            'missing repository': mutate(lambda c: c.pop('repository')),
            'repository without owner': mutate(lambda c: c.update(repository='MarkShare')),
            'short service uuid': mutate(lambda c: c.update(service_uuid='abc')),
            'relative state dir': mutate(lambda c: c.update(state_directory='backups')),
            'empty required checks': mutate(lambda c: c.update(required_checks=[])),
            'missing frontend container': mutate(lambda c: c['containers'].pop('frontend')),
            'unknown database kind': mutate(lambda c: c['database'].update(kind='mysql')),
            'postgres without user': mutate(lambda c: c['database'].pop('user')),
            'no health checks': mutate(lambda c: c.update(health_checks=[])),
            'http health check': mutate(lambda c: c['health_checks'][0].update(url='http://markshare.net/')),
            'bad status': mutate(lambda c: c['health_checks'][0].update(status='401')),
            'status out of range': mutate(lambda c: c['health_checks'][0].update(status=99)),
        }
        for name, config in bad.items():
            with self.subTest(name), self.assertRaises(deploy.DeployError):
                deploy.validate_config(config)


class FakeCoolify:
    """Records the Compose texts that would be sent to Coolify."""
    def __init__(self, compose):
        self.compose, self.applied = compose, []

    def compose_for(self, _uuid):
        return self.compose

    def apply(self, _uuid, compose):
        self.applied.append(compose)


class DeployFlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        quiet = contextlib.ExitStack()
        quiet.enter_context(contextlib.redirect_stdout(io.StringIO()))
        quiet.enter_context(contextlib.redirect_stderr(io.StringIO()))
        self.addCleanup(quiet.close)
        root = pathlib.Path(self.tmp.name)
        self.config = copy.deepcopy(CONFIG)
        self.config['state_directory'] = str(root / 'state')
        self.coolify = FakeCoolify(COMPOSE)
        self.coolify.compose = COMPOSE
        self.coolify_class = mock.Mock(return_value=mock.Mock(
            compose=self.coolify.compose_for, apply=self.coolify.apply))
        self.calls = mock.Mock()
        self.calls.wait.side_effect = None
        self.calls.https.side_effect = None
        runs = {'sha': SHA, 'check_runs': [{'name': name, 'id': 1, 'conclusion': 'success',
                                            'app': {'slug': 'github-actions'}} for name in self.config['required_checks']]}
        self.github = lambda _config, path: {'sha': runs['sha']} if path.startswith('/commits/main') else runs
        self.patches = [
            mock.patch.object(deploy, 'LOCK_PATH', root / 'lock' / 'deploy.lock'),
            mock.patch.object(deploy, 'github', self.github),
            mock.patch.object(deploy, 'Coolify', self.coolify_class),
            mock.patch.object(deploy, 'RegistryAuth', mock.MagicMock()),
            mock.patch.object(deploy, 'verify_image', self.calls.verify_image),
            mock.patch.object(deploy, 'backup_database', self.calls.backup),
            mock.patch.object(deploy, 'wait_for_containers', self.calls.wait),
            mock.patch.object(deploy, 'verify_https', self.calls.https),
        ]
        for patch in self.patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.calls.backup.return_value = root / 'state' / 'backups' / 'predeploy.dump'
        self.state = root / 'state'

    def run_deploy(self, **kwargs):
        return deploy.deploy(self.config, 'markshare', SHA, NEW, {'username': 'u', 'token': 't' * 30}, **kwargs)

    def test_success_applies_new_digests_once_and_writes_receipt(self):
        self.run_deploy()
        self.assertEqual(self.coolify.applied, [deploy.set_image_digests(COMPOSE, PREFIX, NEW)])
        self.calls.wait.assert_called_once_with(self.config, NEW)
        self.assertEqual([c.args[0] for c in self.calls.https.call_args_list],
                         ['https://markshare.net/', 'https://markshare.net/api/auth/me'])
        self.assertEqual(self.calls.https.call_args_list[1].kwargs['status'], 401)
        receipt = json.loads((self.state / 'last-cd-deployment.json').read_text())
        self.assertEqual((receipt['commit'], receipt['images']), (SHA, NEW))
        self.assertEqual((self.state / 'previous-compose.yaml').read_text(), COMPOSE)

    def assert_rolled_back(self):
        self.assertEqual(self.coolify.applied, [deploy.set_image_digests(COMPOSE, PREFIX, NEW), COMPOSE])
        self.assertEqual(self.calls.wait.call_args_list[-1].args[1], OLD)
        self.assertFalse((self.state / 'last-cd-deployment.json').exists())

    def test_failed_health_check_restores_previous_compose(self):
        self.calls.https.side_effect = deploy.DeployError('HTTPS 驗證失敗')
        with self.assertRaises(deploy.DeployError):
            self.run_deploy()
        self.assert_rolled_back()

    def test_containers_that_never_become_healthy_restore_previous_compose(self):
        self.calls.wait.side_effect = [deploy.DeployError('容器未在時限內就緒'), None]
        with self.assertRaises(deploy.DeployError):
            self.run_deploy()
        self.assert_rolled_back()

    def test_rollback_that_cannot_recover_still_reports_the_original_failure(self):
        self.calls.https.side_effect = deploy.DeployError('HTTPS 驗證失敗')
        self.calls.wait.side_effect = [None, deploy.DeployError('回復後仍未就緒')]
        with self.assertRaisesRegex(deploy.DeployError, 'HTTPS 驗證失敗'):
            self.run_deploy()
        self.assertEqual(len(self.coolify.applied), 2)

    def test_dry_run_changes_nothing(self):
        self.run_deploy(dry_run=True)
        self.assertEqual(self.coolify.applied, [])
        self.calls.backup.assert_not_called()
        self.calls.wait.assert_not_called()
        self.assertFalse((self.state / 'last-cd-deployment.json').exists())

    def test_stale_commit_is_rejected_before_touching_anything(self):
        self.github = lambda _config, path: {'sha': 'b' * 40}
        deploy.github = self.github
        with self.assertRaisesRegex(deploy.DeployError, '最新版本'):
            self.run_deploy()
        self.coolify_class.assert_not_called()
        self.calls.backup.assert_not_called()

    def test_unfinished_ci_is_rejected(self):
        original = self.github

        def failing(config, path):
            result = original(config, path)
            if 'check_runs' in result:
                result = {'check_runs': [dict(run, conclusion='failure') for run in result['check_runs']]}
            return result
        deploy.github = failing
        with self.assertRaisesRegex(deploy.DeployError, '必要 CI'):
            self.run_deploy()
        self.assertEqual(self.coolify.applied, [])

    def test_image_verification_failure_stops_before_backup_and_apply(self):
        self.calls.verify_image.side_effect = deploy.DeployError('映像標籤不符')
        with self.assertRaises(deploy.DeployError):
            self.run_deploy()
        self.calls.backup.assert_not_called()
        self.assertEqual(self.coolify.applied, [])

    def test_backup_failure_stops_before_apply(self):
        self.calls.backup.side_effect = deploy.DeployError('PostgreSQL 備份失敗')
        with self.assertRaises(deploy.DeployError):
            self.run_deploy()
        self.assertEqual(self.coolify.applied, [])


if __name__ == '__main__':
    unittest.main()
