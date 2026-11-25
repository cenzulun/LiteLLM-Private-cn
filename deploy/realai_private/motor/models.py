from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from realai_private.network import endpoint_error


class FrozenModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", str_strip_whitespace=True)


class Connection(FrozenModel):
    name: str = Field(min_length=1, max_length=80)
    model_name: str = Field(min_length=1, max_length=160)
    inference_url: str = Field(max_length=512)
    management_url: str = Field(max_length=512)
    observability_url: str = Field(max_length=512)
    controller_url: str = Field(default="", max_length=512)
    control_url: str = Field(default="", max_length=512)
    mode: Literal["union", "pd"] = "union"
    expected_version: str = Field(default="3.2.0", max_length=40)
    engine_version: str = Field(default="v0.30.0rc2", max_length=40)
    verify_tls: bool = True
    timeout: int = Field(default=10, ge=2, le=60)
    inference_key: str | None = Field(default=None, max_length=4096)
    management_key: str | None = Field(default=None, max_length=4096)
    clear_inference_key: bool = False
    clear_management_key: bool = False
    revision: int = Field(default=0, ge=0)

    @field_validator("inference_url", "management_url", "observability_url", "controller_url", "control_url")
    @classmethod
    def check_url(cls, value: str) -> str:
        if not value:
            return value
        error = endpoint_error(value)
        if error:
            raise ValueError(error)
        parsed = urlsplit(value)
        if parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ValueError("请填写服务根地址，不要添加 /v1、查询参数或片段")
        return value.rstrip("/")

    @model_validator(mode="after")
    def required_urls(self):
        if not self.inference_url or not self.management_url or not self.observability_url:
            raise ValueError("推理、管理和观测地址都必须填写")
        return self


class Endpoint(FrozenModel):
    id: int = Field(ge=0)
    address: str = Field(min_length=3, max_length=260)

    @field_validator("address")
    @classmethod
    def check_address(cls, value: str) -> str:
        parsed = urlsplit("http://" + value)
        if not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            raise ValueError("实例端点必须为 主机:端口")
        if parsed.port is None or not 1 <= parsed.port <= 65535:
            raise ValueError("实例端点必须包含有效端口")
        return value


class Instance(FrozenModel):
    id: int = Field(ge=1, le=2147483647)
    role: Literal["union", "prefill", "decode"] = "union"
    endpoints: tuple[Endpoint, ...] = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def unique_endpoints(self):
        if len({item.id for item in self.endpoints}) != len(self.endpoints):
            raise ValueError("同一实例的端点编号不可重复")
        if len({item.address for item in self.endpoints}) != len(self.endpoints):
            raise ValueError("同一实例的端点地址不可重复")
        return self


class Topology(FrozenModel):
    event: Literal["set", "add", "del"] = "add"
    instances: tuple[Instance, ...] = Field(max_length=128)
    revision: int = Field(ge=0)

    @model_validator(mode="after")
    def unique_instances(self):
        if self.event != "set" and not self.instances:
            raise ValueError("请至少填写一个实例")
        if len({item.id for item in self.instances}) != len(self.instances):
            raise ValueError("实例编号不可重复")
        return self


class Binding(FrozenModel):
    alias: str = Field(min_length=1, max_length=160, pattern=r"^[^\s*]+$")


class InferenceTest(FrozenModel):
    prompt: str = Field(default="请回复：连接正常", min_length=1, max_length=2000)
    stream: bool = False
    max_tokens: int = Field(default=32, ge=1, le=128)


class Strategy(FrozenModel):
    prefill: Literal["load_balance", "round_robin", "kv_cache_affinity"]
    decode: Literal["load_balance", "round_robin"]
    restart: bool = False
    revision: int = Field(ge=0)
