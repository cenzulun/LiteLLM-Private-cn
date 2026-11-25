from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CONTEXT = ROOT / 'build-tools/form-runtime-context-1.0.12'
CONTEXT.mkdir(exist_ok=True)
for name in ['realai_private', 'sitecustomize.py', 'patch_runtime.py', 'metadata-zh.json', 'Dockerfile.runtime']:
    source = ROOT / 'deploy' / name
    if source.is_dir():
        shutil.copytree(source, CONTEXT / name, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    else:
        shutil.copy2(source, CONTEXT / name)
(CONTEXT / '.dockerignore').write_text('__pycache__\n*.pyc\n.env\n', encoding='utf8')
(CONTEXT / 'ui-out').mkdir(exist_ok=True)
subprocess.run(['docker', 'cp', 'realai-motor-ui-build:/work/out/.', str(CONTEXT / 'ui-out')], check=True)
assert (CONTEXT / 'ui-out/index.html').is_file()
print(CONTEXT)
