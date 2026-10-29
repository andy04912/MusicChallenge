import importlib.util
import io
import json
import pathlib
import unittest

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


if __name__ == '__main__':
    unittest.main()
