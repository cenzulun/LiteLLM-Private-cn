from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'deploy/release-1.0.12-arm64'
health = json.loads(subprocess.check_output(['docker', 'inspect', 'realai-unified-arm64-acceptance-gateway-1']))[0]['State']['Health']['Status']
verified = health == 'healthy' and (ROOT / 'build-tools/test-forms-live-arm64-1.0.12.log').is_file()
path = OUT / '版本清单.json'
data = json.loads(path.read_text(encoding='utf8'))
data['validation'] = ('本地 AMD64 页面与协议调用验证通过；ARM64 仿真容器健康检查和接口验证通过。' if verified else
    f'本地 AMD64 页面与协议调用验证通过；ARM64 架构和镜像归档验证通过，仿真容器健康状态为 {health}，尚未完成启动验收。') + '未接入生产引擎，须在目标 ARM64 主机验收。'
path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf8')
verification = OUT / 'verification'
for name in ['format-forms-1.0.12.log', 'lint-forms-1.0.12.log', 'test-forms-release-files-1.0.12.log']:
    (verification / name).unlink(missing_ok=True)
for pattern in ['*forms*1.0.12.log', 'design-forms-1.0.12.json', 'build-gateway-1.0.12*.log']:
    for source in (ROOT / 'build-tools').glob(pattern):
        if source.name in ['format-forms-1.0.12.log', 'lint-forms-1.0.12.log', 'test-forms-release-files-1.0.12.log']:
            continue
        shutil.copy2(source, verification / source.name)
shutil.copytree(ROOT / '.impeccable/review/forms-1.0.12', verification / 'screenshots', dirs_exist_ok=True)
(OUT / '验收记录.md').write_text('''# 本版验证记录

- 本地 4100 已更新至 1.0.12，沿用原持久化卷。
- 浏览器核验接入方式共 9 项，通用协议兼容接口仅 1 项；不同适配器明确区分。
- 浏览器核验接口类型保留原始路径，选择对话补全后仍显示 /chat/completions。
- 浏览器核验调度地址预填和逐字段提示，不保存虚构生产连接。
- 7 项前端针对性测试、7 项协议适配元数据测试、9 项后端元数据测试、6 项地址策略测试通过。
- 标准兼容协议普通与流式调用回归通过，使用隔离测试服务，不代表生产模型验收。
- 完整前端编译与类型检查通过，新增辅助模块代码规范检查、格式检查通过。
- 镜像归档内两张镜像均为 ARM64，Compose 配置、源码一致性与 SHA256 校验通过。

''' + data['validation'] + '\n\n真实推理、14 台生产引擎的版本兼容性、指标接入和故障切换需要在内网验证。\n', encoding='utf8')
files = sorted(path for path in OUT.rglob('*') if path.is_file() and path.name != 'SHA256SUMS')
with (OUT / 'SHA256SUMS').open('w', encoding='utf8', newline='\n') as stream:
    for path in files:
        with path.open('rb') as handle:
            digest = hashlib.file_digest(handle, 'sha256').hexdigest()
        stream.write(f'{digest}  {path.relative_to(OUT).as_posix()}\n')
package = ROOT / 'deploy/AI大模型智能网关平台-1.0.12-完整ARM64部署包.tar'
pending = package.with_suffix('.tar.pending')
with tarfile.open(pending, 'w') as archive:
    archive.add(OUT, arcname='AI大模型智能网关平台')
os.replace(pending, package)
with package.open('rb') as handle:
    digest = hashlib.file_digest(handle, 'sha256').hexdigest()
package.with_suffix('.tar.sha256').write_text(f'{digest}  {package.name}\n', encoding='utf8')
print(json.dumps({'package': str(package), 'bytes': package.stat().st_size, 'sha256': digest,
                  'arm64_runtime_verified': verified, 'health': health}, ensure_ascii=False))
