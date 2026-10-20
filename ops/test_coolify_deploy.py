"""Regression tests for polling failures observed on the VPS."""
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import urllib.error

spec = importlib.util.spec_from_file_location('coolify_deploy', Path(__file__).with_name('coolify-deploy.py'))
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


class DeploymentPollingTests(unittest.TestCase):
    def client(self):
        return deployment.Coolify({}, 'a' * 40)

    def test_timeout_recovers_without_creating_a_second_deployment(self):
        client = self.client()
        client.request = Mock(side_effect=[
            {'deployments': [{'deployment_uuid': 'existing-deployment'}]},
            TimeoutError(),
            deployment.TemporaryCoolifyError(),
            {'status': 'finished'},
        ])
        with patch.object(deployment.time, 'monotonic', return_value=0), patch.object(deployment.time, 'sleep'):
            self.assertEqual(client.deploy('app'), 'existing-deployment')
        self.assertEqual(sum(call.args[0] == 'POST' for call in client.request.call_args_list), 1)
        self.assertTrue(all(call.args[1] == '/deployments/existing-deployment' for call in client.request.call_args_list[1:]))

    def test_deployment_creation_timeout_is_not_retried(self):
        client = self.client()
        client.request = Mock(side_effect=TimeoutError())
        with self.assertRaises(TimeoutError):
            client.deploy('app')
        client.request.assert_called_once_with('POST', '/deploy', {'uuid': 'app'})

    def test_failed_deployment_stops_instead_of_retrying(self):
        client = self.client()
        client.request = Mock(side_effect=[
            {'deployments': [{'deployment_uuid': 'failed-deployment'}]},
            {'status': 'failed'},
        ])
        with patch.object(deployment.time, 'monotonic', return_value=0), self.assertRaises(RuntimeError):
            client.deploy('app')

    def test_polling_deadline_still_applies_after_timeouts(self):
        client = self.client()
        client.request = Mock(side_effect=[
            {'deployments': [{'deployment_uuid': 'slow-deployment'}]},
            TimeoutError(),
        ])
        with patch.object(deployment.time, 'monotonic', side_effect=[0, 0, 1201]), patch.object(deployment.time, 'sleep'), self.assertRaisesRegex(RuntimeError, '20 分鐘'):
            client.deploy('app')

    def test_only_temporary_get_errors_are_retryable(self):
        for method, status, expected in [('GET', 503, deployment.TemporaryCoolifyError), ('GET', 401, RuntimeError), ('POST', 503, RuntimeError)]:
            with self.subTest(method=method, status=status):
                client = self.client()
                client.credential = {'token': 'test-only'}
                error = urllib.error.HTTPError('http://127.0.0.1/status', status, 'test', {}, io.BytesIO(b'{}'))
                with patch.object(deployment.urllib.request, 'urlopen', side_effect=error) as opened, self.assertRaises(expected) as caught:
                    client.request(method, '/status')
                if expected is RuntimeError:
                    self.assertNotIsInstance(caught.exception, deployment.TemporaryCoolifyError)
                self.assertEqual(opened.call_count, 1)


if __name__ == '__main__':
    unittest.main()
