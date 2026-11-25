from collections.abc import Mapping


FIELDS = {
    'routing_strategy': ('路由策略', '选择同一模型多个部署之间的请求分配策略。'),
    'routing_strategy_args': ('路由参数', '当前路由策略的配置参数。'),
    'routing_groups': ('路由分组', '为不同模型组设置独立的路由策略，未分组的模型使用全局策略。'),
    'num_retries': ('失败重试次数', '单次请求失败后的重试次数。'),
    'timeout': ('请求超时', '模型请求的最长等待时间，单位为秒。'),
    'stream_timeout': ('流式请求超时', '流式模型请求的最长等待时间，单位为秒。'),
    'max_fallbacks': ('备用切换上限', '单次请求最多尝试的备用模型数量。'),
    'fallbacks': ('备用模型链', '按顺序配置主模型与备用模型的映射。'),
    'context_window_fallbacks': ('上下文超限备用模型', '上下文长度超过上游限制时使用的备用模型。'),
    'content_policy_fallbacks': ('内容策略备用模型', '遇到内容策略错误时使用的备用模型。'),
    'allowed_fails': ('允许失败次数', '部署达到此失败次数后进入冷却。'),
    'cooldown_time': ('故障冷却时间', '故障部署暂时停止接收请求的时间，单位为秒。'),
    'retry_after': ('重试等待时间', '重试失败请求前的最短等待时间，单位为秒。'),
    'retry_policy': ('分类重试策略', '为不同错误类型设置独立的重试次数。'),
    'model_group_alias': ('模型组别名', '将调用名称映射到已有模型组。'),
    'enable_pre_call_checks': ('调用前检查', '在路由请求前检查部署状态和限制。'),
    'default_litellm_params': ('默认调用参数', '未在请求中指定时使用的模型调用参数。'),
    'set_verbose': ('详细日志', '记录路由处理的详细诊断信息。'),
    'default_max_parallel_requests': ('默认并发请求上限', '所有部署使用的默认并发请求上限。'),
    'enable_tag_filtering': ('启用标签路由', '根据请求标签筛选可用部署。'),
    'tag_filtering_match_any': ('标签任意匹配', '启用时匹配任意一个标签，否则要求全部匹配。'),
    'disable_cooldowns': ('停用故障冷却', '停用后故障部署不会被自动隔离。'),
    'enable_weighted_failover': ('启用加权故障切换', '切换备用部署时考虑部署权重。'),
    'enable_mid_stream_fallback_continuation': ('流式中途续答', '当前内网版本关闭此功能，避免拼接不同模型回答。'),
    'tag_routing_prefix': ('标签路由前缀', '用于按标签识别目标部署的前缀。'),
    'fallback_on_unsupported_params': ('参数不兼容时切换', '上游不支持请求参数时尝试备用模型。'),
    'request_tag_mappings': ('请求标签映射', '把请求中的链路附加信息映射为路由标签，精确匹配优先于前缀规则。'),
    'max_in_flight_requests_per_worker': ('每进程并发上限', '单个服务进程同时处理的最大请求数。'),
    'max_queued_requests_per_worker': ('每进程排队上限', '单个服务进程可接收的最大等待请求数。'),
    'admission_queue_timeout_seconds': ('请求准入等待超时', '等待服务进程处理槽位的最长时间，单位为秒。'),
    'max_parallel_requests': ('密钥并发上限', '每个调用密钥的最大并发请求数。'),
    'global_max_parallel_requests': ('网关并发上限', '单个网关实例允许的最大并发请求数。'),
    'user_api_key_cache_max_size': ('身份缓存容量', '每个服务进程保留的密钥、团队、用户等身份记录数量上限。'),
    'max_request_size_mb': ('请求大小上限', '超过此大小的请求将被拒绝，单位为兆字节。'),
    'max_batch_file_size_mb': ('批量输入文件大小上限', '转发到上游前检查的批量输入文件大小上限，单位为兆字节。'),
    'max_batch_file_records': ('批量输入记录上限', '每份批量输入文件允许的最大非空记录数，可由密钥和团队设置进一步限制。'),
    'max_batch_file_uploads_per_day': ('每日批量上传上限', '按调用方统计每日批量输入文件上传次数。'),
    'max_file_downloads_per_minute': ('每分钟文件下载上限', '按调用方和文件统计每分钟内容下载次数。'),
    'max_file_size_mb': ('上传文件大小上限', '转发到上游前检查的文件大小上限，单位为兆字节。'),
    'allowed_file_extensions': ('允许的文件扩展名', '仅接收列表中的文件扩展名，不区分大小写。空列表拒绝所有上传。'),
    'blocked_file_extensions': ('阻止的文件扩展名', '拒绝列表中的文件扩展名，不区分大小写。优先使用允许列表。'),
    'max_response_size_mb': ('响应大小上限', '超过此大小的响应将被拒绝，单位为兆字节。'),
    'proxy_config_reload_interval_seconds': ('配置重载间隔', '每个服务实例重新读取持久化配置的间隔，单位为秒。'),
    'store_prompts_in_spend_logs': ('保存请求与回复正文', '开启后在调用日志中保存原文，内网部署默认关闭。'),
    'disable_requester_ip_address_logging': ('停用调用方地址记录', '启用后不在新调用日志中保存调用方地址，并遮蔽相关请求头与错误中的地址。'),
    'disable_auto_add_proxy_admin_to_teams': ('停用管理员自动加入团队', '创建团队时不再自动将当前平台管理员加入团队。'),
    'disable_fallbacks_on_per_model_rate_limits': ('模型额度超限时停用备用切换', '模型级限流触发后直接返回限流错误，不再尝试备用模型。'),
    'maximum_spend_logs_retention_period': ('调用日志保留时间', '超过保留期的调用日志由清理任务分批删除，例如 30d。'),
    'maximum_health_check_retention_period': ('健康检查保留时间', '超过保留期的健康检查记录由清理任务删除，应明显长于检查间隔。'),
    'maximum_daily_tag_spend_retention_period': ('标签日用量保留时间', '超过保留期的标签日汇总记录由清理任务删除，不影响累计额度计数。'),
    'maximum_spend_logs_cleanup_batch_size': ('日志单批清理数量', '每条清理语句最多删除的记录数。'),
    'maximum_spend_logs_cleanup_max_batches': ('日志单次清理批次', '一次清理任务对每张表执行的最大批次数。'),
    'maximum_spend_logs_cleanup_run_budget': ('日志单次清理时限', '单次清理任务的最长执行时间，达到时限后下次继续。'),
    'maximum_spend_logs_cleanup_batch_timeout': ('日志清理语句超时', '每批清理语句与锁等待的最长执行时间。'),
    'store_model_in_db': ('持久化模型配置', '在数据库中保存并读取模型及配置。'),
    'forward_client_headers_to_llm_api': ('转发客户端请求头', '将客户端请求头转发到内网上游模型服务，启用前确认需要转发的凭据。'),
    'apply_user_budget_to_team_keys': ('团队密钥应用用户额度', '用户通过团队密钥调用时，同时检查其个人额度。'),
    'budget_exceeded_throttle_percentage': ('超额后的限流比例', '超额后保留的令牌和请求额度比例，留空时直接拒绝。'),
    'openai_system_messages_first': ('系统消息优先排列', '将系统和开发者消息移动到兼容协议请求开头，保持相对顺序以提高前缀缓存命中率。'),
    'budget_rollover': ('超额费用结转', '额度重置时将超出额度的费用计入下个周期。'),
    'personal_key_model_access_from_teams': ('个人密钥继承团队权限', '个人密钥仅可访问其所有者当前团队允许的模型资源。'),
    'max_ui_session_budget': ('管理会话费用上限', '每次登录管理后台可发起模型测试的费用上限，单位为美元。'),
}

STRATEGIES = {
    'simple-shuffle': '随机选择可用部署，适合负载接近的同规格副本。',
    'least-busy': '选择当前在途请求较少的部署。',
    'latency-based-routing': '按滑动时间窗口内的历史时延选择部署。',
    'cost-based-routing': '优先选择令牌单价较低的部署。',
    'usage-based-routing': '按每分钟令牌用量选择部署，此策略已弃用。',
    'usage-based-routing-v2': '按令牌用量和可用额度选择部署。',
    'priority': '优先选择较小优先级编号的部署，失败后切换到更大的编号。',
    'lar1': '使用负载感知路由策略。',
}

UI_DESCRIPTIONS = {
    'disable_model_add_for_internal_users': '禁止普通用户添加模型部署。',
    'disable_team_admin_delete_team_user': '禁止团队管理员删除团队成员。',
    'forward_client_headers_to_llm_api': '将客户端请求头转发至模型服务，请确认所需凭据的转发范围。',
    'forward_llm_provider_auth_headers': '将客户端提供的模型鉴权请求头转发至内网上游。',
    'scope_user_search_to_org': '将普通用户的搜索范围限制在所属组织。',
    'disable_custom_api_keys': '禁止用户自行指定调用密钥，改用系统生成的密钥。',
    'enabled_ui_pages_internal_users': '选择普通用户可见的已启用页面，实际操作仍由后端权限检查。',
    'team_admin_editable_team_fields': '选择团队管理员可修改的团队配置项。',
}


def localize_schema(value: object) -> object:
    if isinstance(value, list):
        return [localize_schema(row) for row in value]
    if not isinstance(value, dict):
        return value
    output = {key: localize_schema(child) for key, child in value.items()}
    if isinstance(output.get('description'), str):
        output['description'] = '管理本地部署的界面与访问设置。'
    if isinstance(output.get('properties'), dict):
        for name, row in output['properties'].items():
            if isinstance(row, dict) and 'description' in row:
                row['description'] = UI_DESCRIPTIONS.get(name, '按内网管理需求配置此项。')
    return output


def localize_settings(value: object) -> object:
    if isinstance(value, list):
        return [localize_settings(row) for row in value if not isinstance(row, Mapping) or not str(row.get('field_name', '')).startswith(('mcp_', 'agent_', 'anthropic_', 'enable_anthropic')) and not any(term in str(row.get('field_name', '')).lower() for term in ('spend', 'budget', 'cost', 'pricing', 'price', 'discount', 'markup', 'usd', 'dollar'))]
    if not isinstance(value, dict):
        return value
    field = str(value.get('field_name', ''))
    if field:
        label, description = FIELDS.get(field, ('高级配置', '按实际内网需求设置，配置字段保持原值。'))
        return {**value, 'ui_field_name': label, 'field_description': description, 'link': None}
    if 'fields' in value:
        return {**value, 'fields': localize_settings(value['fields']), 'routing_strategy_descriptions': STRATEGIES}
    return value
