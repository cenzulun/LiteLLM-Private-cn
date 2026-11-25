from pathlib import Path
import argparse
import json
import subprocess
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=4100)
parser.add_argument('--container', default='realai-gateway-gateway-1')
args = parser.parse_args()
ROOT = Path(__file__).resolve().parents[1]
with urllib.request.urlopen(f'http://127.0.0.1:{args.port}/public/providers/fields', timeout=30) as response:
    rows = json.load(response)
assert isinstance(rows, list)
compatible = [row for row in rows if row['litellm_provider'] == 'openai']
assert len(compatible) == 1 and compatible[0]['provider'] == 'OpenAI'
assert compatible[0]['provider_display_name'] == '通用协议兼容接口'
assert len({row['litellm_provider'] for row in rows}) == len(rows)
assert len({row['provider_display_name'] for row in rows}) == len(rows)
assert not any(row['litellm_provider'] == 'openai_like' for row in rows)
script = '''
from pathlib import Path
import hashlib,json,sysconfig
root=Path(sysconfig.get_path('purelib'))/'litellm/proxy/_experimental/out'
bundles=list((root/'_next/static').rglob('*.js'))
texts=[path.read_text() for path in bundles]
for text in ['通用协议兼容接口','/chat/completions','配套部署的调度服务地址已预填','同一推理池登记同一模型的副本']:
    assert any(text in source for source in texts), text
print(json.dumps({'served_ui':str(root),'bundle_count':len(bundles),'middleware_sha256':hashlib.sha256(Path('/app/realai_private/middleware.py').read_bytes()).hexdigest()}))
'''
result = json.loads(subprocess.check_output(['docker', 'exec', args.container, 'python', '-c', script]))
assert result['middleware_sha256'] == __import__('hashlib').sha256((ROOT / 'deploy/realai_private/middleware.py').read_bytes()).hexdigest()
print(json.dumps({'provider_choices': [{'adapter': row['litellm_provider'], 'name': row['provider_display_name']} for row in rows],
                  'served_ui_verified': result, 'port': args.port}, ensure_ascii=False))
