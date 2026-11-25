from pathlib import Path
import shutil
import sysconfig


root = Path(sysconfig.get_path("purelib")) / "litellm/proxy"
stream_path = root.parent / "litellm_core_utils/streaming_handler.py"
stream_source = stream_path.read_text(encoding="utf-8")
stream_anchor = """                    if self.sent_last_chunk is True:
                        processed_chunk = await self._call_post_streaming_deployment_hook(processed_chunk)
"""
stream_replacement = """                    processed_chunk = await self._call_post_streaming_deployment_hook(processed_chunk)
                    if self.sent_last_chunk is True:
"""
stream_source = stream_source.replace(stream_replacement, stream_anchor, 1)
observe_anchor = """                    if processed_chunk is None:
                        continue

"""
observe_hook = """                    from realai_private.routing_telemetry import observe_stream_chunk
                    await observe_stream_chunk(self.logging_obj.model_call_details, processed_chunk)

"""
if observe_hook not in stream_source:
    if stream_source.count(observe_anchor) != 1:
        raise RuntimeError("未找到唯一流式观测安装点，停止构建")
    stream_source = stream_source.replace(observe_anchor, observe_anchor + observe_hook, 1)
stream_path.write_text(stream_source, encoding="utf-8")
provider_path = root.parent / "litellm_core_utils/get_llm_provider_logic.py"
provider_source = provider_path.read_text(encoding="utf-8")
provider_hook = """        # Private compatible-provider migration: explicit api_base is required.
        from realai_private.providers import normalize_compatible_provider
        model, custom_llm_provider = normalize_compatible_provider(
            model, custom_llm_provider, api_base
        )

"""
if provider_hook not in provider_source:
    anchor = "        dynamic_api_key = None\n"
    if provider_source.count(anchor) != 1:
        raise RuntimeError("未找到唯一协议解析安装点，停止构建")
    provider_path.write_text(provider_source.replace(anchor, provider_hook + anchor, 1), encoding="utf-8")
path = root / "proxy_server.py"
source = path.read_text(encoding="utf-8")
addition = "\nfrom realai_private.middleware import install as install_private_deployment\ninstall_private_deployment(app)\n"
if addition not in source:
    path.write_text(source + addition, encoding="utf-8")
ui = Path("/app/ui-out")
target = root / "_experimental/out"
if ui.exists() and (ui / "index.html").exists():
    if target.exists(): shutil.rmtree(target)
    shutil.copytree(ui, target)
