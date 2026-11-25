import ipaddress
import re
import socket
from urllib.parse import urlsplit


def address_is_internal(value: str) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    host = value.strip().split("%", 1)[0]
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return bool(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", host))


def endpoint_error(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return "请填写服务地址"
    try:
        parsed = urlsplit(value)
    except ValueError:
        return "服务地址格式不正确"
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        return "服务地址必须使用不包含账号密码的 HTTP 或 HTTPS 网址"
    try:
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            return "服务端口不正确"
    except ValueError:
        return "服务端口不正确"
    return None


def internal_socket_address(connection: socket.socket, address: tuple) -> tuple:
    return address


def install_network_guard() -> None:
    return None
