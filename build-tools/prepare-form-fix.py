"""Synchronize the full frontend and verify the changed source files."""
from pathlib import Path
import hashlib
import json
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / 'sources/litellm-1.110.1/ui/litellm-dashboard'
BUILDER = 'realai-motor-ui-build'
archive = ROOT / 'build-tools/form-source-1.0.12.tar'
names = ['src', 'public', 'scripts', 'tests', 'package.json', 'package-lock.json',
         'next.config.mjs', 'tsconfig.json', 'tsconfig.production.json', 'vitest.config.ts',
         'postcss.config.js', 'components.json']
with tarfile.open(archive, 'w') as output:
    for name in names:
        output.add(UI / name, arcname=name)
subprocess.run(['docker', 'cp', str(archive), BUILDER + ':/tmp/form-source.tar'], check=True)
subprocess.run(['docker', 'exec', BUILDER, 'tar', '-xf', '/tmp/form-source.tar', '-C', '/work'], check=True)
checks = ['src/lib/privateDeployment.ts', 'src/components/motor/ConnectionForm.tsx',
          'src/components/add_model/AddModelForm.tsx', 'src/components/add_model/add_model_modes.tsx',
          'src/components/provider_info_helpers.tsx', 'src/lib/http/schema.d.ts',
          'src/app/(dashboard)/home/_components/HomePage.tsx']
for name in checks:
    expected = hashlib.sha256((UI / name).read_bytes()).hexdigest()
    actual = subprocess.check_output(['docker', 'exec', BUILDER, 'sha256sum', '/work/' + name], text=True).split()[0]
    assert actual == expected, name
print(json.dumps({'builder': BUILDER, 'verified_source_files': checks}, ensure_ascii=False))
