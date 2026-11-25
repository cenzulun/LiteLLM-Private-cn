from pathlib import Path
import hashlib
import json
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'deploy/release-1.0.12-arm64'
manifest = json.loads((OUT / '版本清单.json').read_text(encoding='utf8'))
assert manifest['version'] == '1.0.12'
assert all(row['architecture'] == 'arm64' for row in manifest['images'])
assert {row['tag'] for row in manifest['images']} == {'realai/gateway:1.0.12-arm64', 'realai/motor:3.2.0-runtime-arm64'}
subprocess.run(['docker', 'compose', '--env-file', '.env.example', 'config', '--quiet'], cwd=OUT,
               env={**__import__('os').environ, 'DATABASE_URL': 'postgresql://check:check@db:5432/check',
                    'REDIS_HOST': 'cache', 'LITELLM_MASTER_KEY': 'check-only', 'LITELLM_SALT_KEY': 'check-only',
                    'UI_PASSWORD': 'check-only'}, check=True)
for line in (OUT / 'SHA256SUMS').read_text(encoding='utf8').splitlines():
    digest, name = line.split('  ', 1)
    with (OUT / name).open('rb') as handle:
        assert hashlib.file_digest(handle, 'sha256').hexdigest() == digest, name
with tarfile.open(OUT / 'frontend-source.tar.gz') as archive:
    for name in ['src/lib/privateDeployment.ts', 'src/components/add_model/AddModelForm.tsx',
                 'src/components/motor/ConnectionForm.tsx', 'src/components/provider_info_helpers.tsx']:
        assert archive.extractfile('frontend/' + name).read() == (ROOT / 'sources/litellm-1.110.1/ui/litellm-dashboard' / name).read_bytes()
assert (OUT / 'runtime-source/realai_private/middleware.py').read_bytes() == (ROOT / 'deploy/realai_private/middleware.py').read_bytes()
assert not list(OUT.rglob('.env'))
print(json.dumps({'compose_valid': True, 'checksums_valid': True, 'frontend_sources_match': True,
                  'backend_sources_match': True, 'image_tags': [row['tag'] for row in manifest['images']]}, ensure_ascii=False))
