"""Ensure immutable images, environment isolation and short-lived auth survive changes."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch

spec = importlib.util.spec_from_file_location('ghcr_deploy', Path(__file__).with_name('coolify-deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
SHA = 'a' * 40
DIGEST = 'sha256:' + 'b' * 64


class GHCRTests(unittest.TestCase):
    def test_command_requires_both_immutable_digests(self):
        credentials = {'username': 'andy04912', 'token': 'test-only-' + 'x' * 30}
        result = deploy.deployment_input(f'deploy {SHA} {DIGEST} {DIGEST}', io.StringIO(json.dumps(credentials)))
        self.assertEqual(result, (SHA, {'backend': DIGEST, 'frontend': DIGEST}, credentials))
        for command in (f'deploy {SHA}', f'deploy {SHA} latest latest', f'deploy {SHA} {DIGEST} {DIGEST}; id'):
            with self.subTest(command=command), self.assertRaises(RuntimeError):
                deploy.deployment_input(command, io.StringIO(json.dumps(credentials)))

    def test_bad_credentials_are_rejected_without_echoing_secrets(self):
        for raw in ('invalid', '[]', '{"username":"a","token":"secret"}', 'x' * 5000):
            with self.subTest(raw_length=len(raw)), self.assertRaises(RuntimeError) as caught:
                deploy.deployment_input(f'deploy {SHA} {DIGEST} {DIGEST}', io.StringIO(raw))
            self.assertNotIn('secret', str(caught.exception))

    def test_image_from_other_environment_or_commit_is_rejected(self):
        for revision, environment in ((SHA, 'production'), ('c' * 40, 'develop')):
            labels = {'org.opencontainers.image.source': 'https://github.com/andy04912/MarkShare',
                      'org.opencontainers.image.revision': revision,
                      'org.opencontainers.image.version': environment + '-' + revision}
            with patch.object(deploy.subprocess, 'run', side_effect=[Mock(), Mock(stdout=json.dumps(labels))]), self.assertRaises(RuntimeError):
                deploy.verify_image('image@' + DIGEST, 'andy04912/MarkShare', SHA, 'develop')

    def test_coolify_uses_digest_and_cannot_build_from_source(self):
        client = Mock()
        with patch.object(deploy, 'php', return_value=True) as converted:
            deploy.configure_image(client, 'app', 'ghcr.io/andy04912/markshare-backend', DIGEST, 'develop', SHA)
        body = client.request.call_args.args[2]
        self.assertIn("'build_pack'=>'dockerimage'", converted.call_args.args[0])
        self.assertIn("'dockerfile'=>null", converted.call_args.args[0])
        self.assertNotIn('build_pack', body)
        self.assertNotIn('dockerfile', body)
        self.assertEqual(body['docker_registry_image_tag'], 'sha256-' + 'b' * 64)
        self.assertFalse(body['is_auto_deploy_enabled'])

    def test_auth_is_removed_when_deployment_raises(self):
        process = Mock()
        process.stdout.readline.return_value = 'READY\n'
        process.wait.return_value = 0
        credentials = {'username': 'andy04912', 'token': 'test-only-' + 'x' * 30}
        with patch.object(deploy.subprocess, 'Popen', return_value=process) as opened:
            with self.assertRaisesRegex(RuntimeError, 'deployment failed'):
                with deploy.RegistryAuth(credentials):
                    raise RuntimeError('deployment failed')
        self.assertNotIn(credentials['token'], str(opened.call_args))
        process.stdin.close.assert_called_once()
        process.wait.assert_called_once_with(timeout=30)

    def test_sqlite_deployment_requests_separate_predeploy_snapshot(self):
        with patch.object(deploy.subprocess, 'run', return_value=Mock(stdout='{"backup":"/backup/predeploy.sqlite.gz"}')) as run:
            path = deploy.backup_database({'database_kind': 'sqlite'}, Path('/unused'), SHA)
        self.assertEqual(str(path), '/backup/predeploy.sqlite.gz')
        self.assertIn('--kind', run.call_args.args[0])
        self.assertIn('predeploy', run.call_args.args[0])

    def test_https_check_identifies_itself_to_cloudflare(self):
        response = Mock(status=200)
        response.read.return_value = b'{"ok":true}'
        opened = MagicMock()
        opened.__enter__.return_value = response
        with patch.object(deploy.urllib.request, 'urlopen', return_value=opened) as urlopen:
            deploy.verify_https('https://music-challenge.damove.app/api/health', expect_json=True)
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header('User-agent'), 'MusicChallenge-Deployment-Healthcheck/1.0')
        self.assertEqual(request.get_header('Cache-control'), 'no-cache')

    def run_deployment(self, directory, backup_error=None):
        events = []
        config = {'state_directory': directory, 'repository': 'andy04912/MarkShare',
                  'backend_uuid': 'backend', 'frontend_uuid': 'frontend',
                  'required_checks': ['tests', 'images']}
        checks = [{'id': index, 'name': name, 'app': {'slug': 'github-actions'},
                   'conclusion': 'success'} for index, name in enumerate(config['required_checks'])]
        client = MagicMock()
        client.__enter__.return_value = client
        client.request.return_value = {'build_pack': 'dockerfile'}
        client.deploy.side_effect = lambda app: events.append('deploy-' + app) or app
        def backup(*_):
            events.append('backup')
            if backup_error:
                raise backup_error
            return Path(directory) / 'backup.dmp'
        with (patch.object(deploy.sys, 'argv', ['deploy', '--environment', 'develop']),
              patch.object(deploy, 'GLOBAL_LOCK', Path(directory) / 'global.lock'),
              patch.object(deploy.pathlib.Path, 'read_text', return_value=json.dumps(config)),
              patch.object(deploy.os, 'environ', {'SSH_ORIGINAL_COMMAND': f'deploy {SHA} {DIGEST} {DIGEST}'}),
              patch.object(deploy.sys, 'stdin', io.StringIO(json.dumps({'username': 'andy04912', 'token': 'x' * 40}))),
              patch.object(deploy, 'github', side_effect=[{'sha': SHA}, {'check_runs': checks}]),
              patch.object(deploy, 'RegistryAuth', return_value=MagicMock()),
              patch.object(deploy, 'Coolify', return_value=client),
              patch.object(deploy, 'verify_image', side_effect=lambda *_: events.append('image')),
              patch.object(deploy, 'backup_database', side_effect=backup),
              patch.object(deploy, 'configure_image', side_effect=lambda *_: events.append('configure')),
              patch.object(deploy, 'verify_https', side_effect=lambda *_, **__: events.append('health'))):
            if backup_error:
                with self.assertRaisesRegex(RuntimeError, 'backup failed'):
                    deploy.main()
            else:
                deploy.main()
        return events

    def test_backup_precedes_changes_and_health_gates_frontend(self):
        with tempfile.TemporaryDirectory() as directory:
            events = self.run_deployment(directory)
            receipt = json.loads((Path(directory) / 'last-cd-deployment.json').read_text())
        self.assertEqual(events, ['image', 'image', 'backup', 'configure', 'configure',
                                  'deploy-backend', 'health', 'deploy-frontend', 'health', 'health'])
        self.assertEqual(receipt['environment'], 'develop')
        self.assertTrue(all('@sha256:' in image for image in receipt['images'].values()))

    def test_backup_failure_never_changes_or_deploys_application(self):
        with tempfile.TemporaryDirectory() as directory:
            events = self.run_deployment(directory, RuntimeError('backup failed'))
        self.assertEqual(events, ['image', 'image', 'backup'])


if __name__ == '__main__':
    unittest.main()
