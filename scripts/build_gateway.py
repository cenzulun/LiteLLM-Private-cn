import argparse
from pathlib import Path
import os
import shutil
import subprocess


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="构建当前前端与网关运行镜像")
    parser.add_argument("--platform", choices=["linux/amd64", "linux/arm64"], default="linux/arm64")
    parser.add_argument("--base-image")
    parser.add_argument("--skip-ui", action="store_true", help="使用已由当前源码构建的前端导出目录")
    args = parser.parse_args()
    ui = root / "sources/litellm-1.110.1/ui/litellm-dashboard"
    env = {**os.environ, "NODE_ENV": "production", "NEXT_TELEMETRY_DISABLED": "1"}
    if not args.skip_ui:
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
        if not npm:
            raise SystemExit("未找到 npm，请先安装仓库指定的 Node.js 版本")
        subprocess.run([npm, "ci"], cwd=ui, env=env, check=True)
        subprocess.run(["node", "scripts/localize-base-ui.mjs"], cwd=ui, env=env, check=True)
        subprocess.run([npm, "run", "build", "--", "--webpack"], cwd=ui, env=env, check=True)
    if not (ui / "out/index.html").is_file():
        raise SystemExit("缺少前端导出目录，请先完成前端构建")
    version = (root / "VERSION").read_text(encoding="utf8").strip()
    context = root / f"build-tools/runtime-context-{version}"
    context.mkdir(parents=True, exist_ok=True)
    for name in ["realai_private", "sitecustomize.py", "patch_runtime.py", "metadata-zh.json", "Dockerfile.runtime"]:
        source = root / "deploy" / name
        if source.is_dir():
            shutil.copytree(source, context / name, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".env"))
        else:
            shutil.copy2(source, context / name)
    if (context / "ui-out").exists():
        shutil.rmtree(context / "ui-out")
    shutil.copytree(ui / "out", context / "ui-out")
    (context / ".dockerignore").write_text("__pycache__\n*.pyc\n.env\n", encoding="utf8")
    tag = f"realai/gateway:{version}-{args.platform.split('/')[1]}"
    command = ["docker", "buildx", "build", "--platform", args.platform, "-f", str(context / "Dockerfile.runtime"), "-t", tag, "--load"]
    if args.base_image:
        command.extend(["--build-arg", f"BASE_IMAGE={args.base_image}"])
    subprocess.run([*command, str(context)], check=True)
    print(f"已构建 {tag}")


if __name__ == "__main__":
    main()
