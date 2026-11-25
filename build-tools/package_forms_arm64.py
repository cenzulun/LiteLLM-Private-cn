"""Export fresh runtime sources and both ARM64 images without site credentials."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '1.0.12'
OUT = ROOT / f'deploy/release-{VERSION}-arm64'
CONTEXT = ROOT / f'build-tools/form-runtime-context-{VERSION}'
OUT.mkdir(exist_ok=True)
TAGS = [f'realai/gateway:{VERSION}-arm64', 'realai/motor:3.2.0-runtime-arm64']

def copy(source, target):
    if source.is_dir():
        shutil.copytree(source, target, dirs_exist_ok=True, ignore=shutil.ignore_patterns('.env', '__pycache__', '*.pyc'))
    else:
        shutil.copy2(source, target)

for name in ['config.yaml', 'monitor-queries.json', 'monitoring', 'LICENSE.litellm.txt', 'LICENSE.enterprise.txt']:
    copy(ROOT / 'deploy' / name, OUT / name)
copy(CONTEXT, OUT / 'runtime-source')
copy(ROOT / 'deploy/motor/upstream/LICENSE.md', OUT / 'LICENSE.motor.txt')
copy(ROOT / 'deploy/motor/upstream/motor/kv_conductor/THIRD_PARTY_NOTICES.md', OUT / 'Motor第三方许可说明.md')
copy(ROOT / 'deploy/motor/upstream/motor/kv_conductor/licenses', OUT / 'motor-licenses')
motor = OUT / 'motor-source'
motor.mkdir(exist_ok=True)
for name in ['Dockerfile.arm64', 'Dockerfile.native-arm64', 'Dockerfile.native-arm64.dockerignore',
             'initialize.py', 'supervisor.py', 'healthcheck.py', 'requirements.amd64.lock',
             'kv-conductor.Cargo.lock', 'workload-shm.Cargo.lock', '.dockerignore']:
    copy(ROOT / 'deploy/motor' / name, motor / name)
with tarfile.open(motor / 'source.tar.gz', 'w:gz') as archive:
    for name in ['motor', 'scripts', 'build.sh', 'setup.py', 'MANIFEST.in', 'requirements.txt', 'LICENSE.md']:
        item = ROOT / 'deploy/motor/upstream' / name
        if item.exists():
            archive.add(item, arcname='upstream/' + name,
                        filter=lambda i: None if '/target/' in i.name or '__pycache__' in i.name else i)

compose = (ROOT / 'deploy/docker-compose.yml').read_text(encoding='utf8')
compose = compose.replace('name: realai-gateway', 'name: ai-gateway-suite', 1)
compose = compose.replace('${PLATFORM:-linux/arm64}', 'linux/arm64').split('\n  database:')[0]
compose = compose.replace('      STORE_MODEL_IN_DB:', '''      LITELLM_PRISMA_MIGRATE_DEPLOY_TIMEOUT: ${LITELLM_PRISMA_MIGRATE_DEPLOY_TIMEOUT:-1800}
      LITELLM_PRISMA_COMMAND_TIMEOUT: ${LITELLM_PRISMA_COMMAND_TIMEOUT:-120}
      LITELLM_PRISMA_BOOTSTRAP_TIMEOUT: ${LITELLM_PRISMA_BOOTSTRAP_TIMEOUT:-600}
      LITELLM_MIGRATION_LOCK_TIMEOUT: ${LITELLM_MIGRATION_LOCK_TIMEOUT:-1800}
      STORE_MODEL_IN_DB:''', 1)
compose += '\nvolumes:\n  motor_module_state:\n  motor_config:\n  motor_logs:\n'
(OUT / 'docker-compose.yml').write_text(compose, encoding='utf8', newline='\n')
init = (ROOT / 'deploy/init_env.py').read_text(encoding='utf8').replace('realai/gateway:1.0.10-', f'realai/gateway:{VERSION}-')
init = init.replace('architecture = args.platform.split("/")[1]',
    'architecture = args.platform.split("/")[1]\n    if architecture != "arm64" or args.local_dependencies:\n        raise SystemExit("此包仅支持 ARM64 与已有外部数据库、缓存")')
init = init.replace('"GATEWAY_IMAGE":', '''"LITELLM_PRISMA_MIGRATE_DEPLOY_TIMEOUT": "1800",
        "LITELLM_PRISMA_COMMAND_TIMEOUT": "120",
        "LITELLM_PRISMA_BOOTSTRAP_TIMEOUT": "600",
        "LITELLM_MIGRATION_LOCK_TIMEOUT": "1800",
        "START_TIMEOUT_SECONDS": "1800",
        "GATEWAY_IMAGE":''')
for line in ['        "POSTGRES_IMAGE": "postgres:16-alpine",\n', '        "REDIS_IMAGE": "redis:7-alpine",\n', '        "POSTGRES_PASSWORD": postgres_password,\n']:
    init = init.replace(line, '')
(OUT / 'init_env.py').write_text(init, encoding='utf8', newline='\n')
env = (ROOT / 'deploy/.env.example').read_text(encoding='utf8').replace('realai/gateway:1.0.10-', f'realai/gateway:{VERSION}-')
env = '\n'.join(line for line in env.splitlines() if not line.startswith(('POSTGRES_IMAGE=', 'REDIS_IMAGE=')))
(OUT / '.env.example').write_text(env + '''
LITELLM_PRISMA_MIGRATE_DEPLOY_TIMEOUT=1800
LITELLM_PRISMA_COMMAND_TIMEOUT=120
LITELLM_PRISMA_BOOTSTRAP_TIMEOUT=600
LITELLM_MIGRATION_LOCK_TIMEOUT=1800
START_TIMEOUT_SECONDS=1800
GATEWAY_HEALTH_START_PERIOD=1800s
''', encoding='utf8', newline='\n')
start = (ROOT / 'deploy/start.sh').read_text(encoding='utf8').replace('realai-gateway-arm64-images.tar', 'all-images-arm64.tar')
start = start.replace('if [ "$(setting LOCAL_DEPENDENCIES)" = "true" ]; then\n  docker compose --profile local-dependencies up -d --pull never database redis\nfi\n', '')
(OUT / 'start.sh').write_text(start, encoding='utf8', newline='\n')

frontend = ROOT / 'sources/litellm-1.110.1/ui/litellm-dashboard'
with tarfile.open(OUT / 'frontend-source.tar.gz', 'w:gz') as archive:
    for name in ['src', 'public', 'vendor', 'scripts', 'tests', '.agents', 'package.json', 'package-lock.json',
                 'next.config.mjs', 'postcss.config.js', 'tsconfig.json', 'tsconfig.production.json',
                 'vitest.config.ts', 'eslint.config.mjs', 'components.json', 'AGENTS.md']:
        item = frontend / name
        if item.exists():
            archive.add(item, arcname='frontend/' + name, filter=lambda i: None if '/.env' in i.name else i)
for name in ['完整部署说明.md', 'rebuild.sh']:
    content = (ROOT / 'build-tools/unified-docs' / name).read_text(encoding='utf8').replace('1.0.10', VERSION)
    content = content.replace('选择“内网兼容接口”', '选择“通用协议兼容接口”')
    (OUT / name).write_text(content, encoding='utf8', newline='\n')
copy(ROOT / 'build-tools/表单填写说明-1.0.12.md', OUT / '表单填写与升级说明.md')
copy(ROOT / 'deploy/tests', OUT / 'tests')
verification = OUT / 'verification'
verification.mkdir(exist_ok=True)
for pattern in ['*forms*1.0.12.log', 'design-forms-1.0.12.json', 'build-gateway-1.0.12*.log']:
    for source in (ROOT / 'build-tools').glob(pattern):
        copy(source, verification / source.name)
screenshots = ROOT / '.impeccable/review/forms-1.0.12'
if screenshots.exists():
    copy(screenshots, verification / 'screenshots')
images = []
details = {}
for tag in TAGS:
    row = json.loads(subprocess.check_output(['docker', 'image', 'inspect', tag]))[0]
    assert row['Architecture'] == 'arm64', tag
    details[tag] = row
    images.append({'tag': tag, 'architecture': 'arm64', 'id': row['Id']})
image_path = OUT / 'all-images-arm64.tar'
subprocess.run(['docker', 'save', '-o', str(image_path), *TAGS], check=True)
with tarfile.open(image_path) as archive:
    manifests = json.load(archive.extractfile('manifest.json'))
    assert {tag for item in manifests for tag in item.get('RepoTags', [])} == set(TAGS)
    for expected in images:
        manifest = next(item for item in manifests if expected['tag'] in item.get('RepoTags', []))
        raw = archive.extractfile(manifest['Config']).read()
        saved = json.loads(raw)
        assert saved['architecture'] == 'arm64'
        assert saved['rootfs']['diff_ids'] == details[expected['tag']]['RootFS']['Layers']
        for key in ['Env', 'Cmd', 'Entrypoint', 'Labels', 'WorkingDir']:
            assert saved['config'].get(key) == details[expected['tag']]['Config'].get(key)
        expected['config_sha256'] = 'sha256:' + hashlib.sha256(raw).hexdigest()
(OUT / '版本清单.json').write_text(json.dumps({'product': 'AI大模型智能网关平台', 'version': VERSION,
    'status': '内网验收候选', 'images': images, 'production_credentials_included': False,
    'validation': '本地 AMD64 页面验证；ARM64 容器启动与架构验证。未接入生产引擎，须在目标 ARM64 主机验收。',
    'external_dependencies': ['PostgreSQL', 'Redis', 'Prometheus', '推理引擎']}, ensure_ascii=False, indent=2), encoding='utf8')
files = sorted(path for path in OUT.rglob('*') if path.is_file() and path.name != 'SHA256SUMS')
assert not any(path.name == '.env' for path in files)
with (OUT / 'SHA256SUMS').open('w', encoding='utf8', newline='\n') as stream:
    for path in files:
        with path.open('rb') as handle:
            digest = hashlib.file_digest(handle, 'sha256').hexdigest()
        stream.write(f'{digest}  {path.relative_to(OUT).as_posix()}\n')
package = ROOT / f'deploy/AI大模型智能网关平台-{VERSION}-完整ARM64部署包.tar'
pending = package.with_suffix('.tar.pending')
with tarfile.open(pending, 'w') as archive:
    archive.add(OUT, arcname='AI大模型智能网关平台')
os.replace(pending, package)
with package.open('rb') as handle:
    digest = hashlib.file_digest(handle, 'sha256').hexdigest()
package.with_suffix('.tar.sha256').write_text(f'{digest}  {package.name}\n', encoding='utf8')
print(json.dumps({'package': str(package), 'bytes': package.stat().st_size, 'sha256': digest, 'images': images}, ensure_ascii=False))
