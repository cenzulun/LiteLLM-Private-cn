from collections.abc import Mapping

NAMES = {
    'prometheus': '监控指标采集',
    'generic_api': '内网日志接口',
    'langfuse': '内网调用追踪',
    'langfuse_otel': '内网调用追踪（遥测协议）',
    'otel': '内网遥测采集',
    'signoz': '内网链路观测',
}
PARAMETERS = {
    'GENERIC_LOGGER_ENDPOINT': '内网接收地址', 'GENERIC_LOGGER_HEADERS': '请求头',
    'langfuse_public_key': '访问公钥', 'langfuse_secret_key': '访问密钥',
    'langfuse_host': '内网服务地址', 'langfuse_environment': '环境名称',
    'langfuse_span_scope': '追踪范围', 'otel_endpoint': '内网采集地址',
    'otel_traces_endpoint': '内网追踪地址', 'otel_headers': '请求头',
    'otel_exporter_otlp_protocol': '传输协议',
    'signoz_ingestion_endpoint': '内网接收地址', 'signoz_ingestion_key': '接入密钥',
}


def callback_metadata(value: object) -> object:
    if not isinstance(value, list):
        return value
    return [
        {**row, 'displayName': NAMES[row['id']], 'logo': None,
         'dynamic_params': {key: {**config, 'ui_name': PARAMETERS.get(key, key)}
                            for key, config in (row.get('dynamic_params') or {}).items()}}
        for row in value if isinstance(row, Mapping) and row.get('id') in NAMES
    ]


def callback_state(value: object) -> object:
    if not isinstance(value, dict) or 'callbacks' not in value:
        return value
    return {**value,
            'callbacks': [row for row in value.get('callbacks', []) if row.get('name') in NAMES],
            'available_callbacks': {key: {**row, 'ui_callback_name': NAMES.get(key, '内网日志采集')}
                                    for key, row in value.get('available_callbacks', {}).items() if key in NAMES},
            'alerts': [row for row in value.get('alerts', []) if row.get('name') == 'email']}
