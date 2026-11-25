"""Keep local rules and private services; preserve protocol keys and values."""
NAMES = {
    'presidio': '内网敏感信息检测',
    'litellm_content_filter': '本地内容过滤',
    'llm_as_a_judge': '内网模型评审',
    'generic_guardrail_api': '内网通用规则接口',
    'block_code_execution': '代码执行拦截',
    'tool_permission': '工具权限规则',
}

FIELD_HINTS = {
    'presidio_analyzer_api_base': '内网敏感信息分析服务地址。',
    'presidio_anonymizer_api_base': '内网敏感信息脱敏服务地址。',
    'presidio_filter_scope': '选择检测输入、输出或两者，选项值保持接口原值。',
    'presidio_run_on': '选择需要执行敏感信息检测的消息方向。',
    'presidio_language': '识别语言代码，须与内网分析服务已安装的语言模型一致。',
    'output_parse_pii': '是否解析并处理回复中的敏感信息。',
    'additional_provider_specific_params': '传给内网规则服务的附加参数对象。',
    'unreachable_fallback': '规则服务不可达时的处理方式：fail_closed 拒绝请求，fail_open 放行请求。',
    'fail_on_error': '规则服务返回错误时，是否拒绝本次模型请求。',
    'num_retries': '内网规则服务调用失败后的最大重试次数。',
    'forward_messages_as_sent': '是否按上游实际收到的格式转发消息。',
    'streaming_end_of_stream_only': '是否只在流式回复结束后执行检查。',
    'streaming_sampling_rate': '流式回复检查的采样比例，按规则服务约定填写。',
    'streaming_transform_mode': '流式检查方式：block_only 仅拦截，incremental_diff 增量替换。',
    'blocked_languages': '需要检测并拦截的代码语言，语言标识保持原值。',
    'action': '匹配后的处理方式：block 拦截，mask 脱敏。',
    'confidence_threshold': '触发规则所需的最低置信度，范围为零到一。',
    'detect_execution_intent': '是否同时检测执行代码的意图。',
    'rules': '工具权限规则列表。',
    'default_action': '未匹配规则时的处理方式：allow 放行，deny 拒绝。',
    'on_disallowed_action': '工具调用被禁止时的处理方式：block 拦截，rewrite 改写。',
    'patterns': '需要检测的预置模式或自定义正则表达式。',
    'blocked_words': '需要匹配的关键词列表。',
    'blocked_words_file': '容器内关键词文件路径，文件需通过内网部署挂载。',
    'categories': '需要启用的内容规则类别及处理方式。',
    'severity_threshold': '触发规则的严重程度阈值，使用服务约定的等级值。',
    'pattern_redaction_format': '模式匹配内容的脱敏替换格式，保留占位参数。',
    'keyword_redaction_tag': '命中关键词后的脱敏替换文本。',
    'competitor_intent_config': '按业务需要配置竞争品牌意图检测规则。',
}

# Display names only; rule identifiers and enum values remain unchanged.
RULE_NAMES = {
    'email': '电子邮件地址', 'us_ssn': '美国社会保障号码', 'us_ssn_no_dash': '美国社会保障号码（无分隔符）',
    'us_phone': '美国电话号码', 'visa': '信用卡号码（维萨）', 'mastercard': '信用卡号码（万事达）',
    'amex': '信用卡号码（美国运通）', 'discover': '信用卡号码（发现卡）', 'credit_card': '信用卡号码',
    'aws_access_key': '云服务访问标识', 'aws_secret_key': '云服务访问密钥', 'github_token': '代码托管访问令牌',
    'slack_token': '协作服务访问令牌', 'generic_api_key': '通用接口密钥', 'openai_api_key': '兼容服务接口密钥',
    'anthropic_api_key': '外部模型接口密钥', 'gemini_api_key': '外部模型访问密钥',
    'ipv4': '网络地址（第四版）', 'ipv6': '网络地址（第六版）', 'url': '网址',
    'gender_sexual_orientation': '性别与性取向歧视', 'race_ethnicity_national_origin': '种族、族裔与国籍歧视',
    'religion': '宗教与信仰歧视', 'age_discrimination': '年龄歧视', 'disability': '残障歧视',
    'marital_family_status': '婚姻与家庭状况歧视', 'military_status': '军人身份歧视', 'public_assistance': '社会救助身份歧视',
    'weapons_firearms': '武器与枪支', 'weapons_other': '其他武器', 'explosives': '爆炸物',
    'violence_threats': '暴力与威胁', 'terrorism': '恐怖主义与极端主义', 'self_harm_suicide': '自伤与自杀',
    'illegal_activities': '违法活动', 'harassment_hate': '骚扰与仇恨言论',
    'bias_gender': '性别偏见', 'bias_racial': '种族偏见', 'bias_religious': '宗教偏见', 'bias_sexual_orientation': '性取向偏见',
    'claims_fraud_coaching': '保险理赔欺诈指导', 'claims_medical_advice': '理赔中的医疗建议',
    'claims_phi_disclosure': '理赔中泄露健康信息', 'claims_prior_auth_gaming': '规避预授权审核', 'claims_system_override': '绕过理赔系统规则',
    'denied_financial_advice': '受限金融与投资建议', 'denied_insults': '侮辱与人身攻击', 'denied_legal_advice': '受限法律建议', 'denied_medical_advice': '受限医疗建议',
    'harm_toxic_abuse': '有害辱骂内容', 'harm_toxic_abuse_au': '有害辱骂内容（澳大利亚）', 'harm_toxic_abuse_de': '有害辱骂内容（德语）',
    'harm_toxic_abuse_es': '有害辱骂内容（西班牙语）', 'harm_toxic_abuse_fr': '有害辱骂内容（法语）',
    'harmful_child_safety': '儿童安全风险', 'harmful_illegal_weapons': '非法武器风险', 'harmful_self_harm': '自伤风险', 'harmful_violence': '暴力风险',
    'prompt_injection_data_exfiltration': '提示词注入与数据外泄', 'prompt_injection_jailbreak': '提示词越狱',
    'prompt_injection_malicious_code': '提示词注入恶意代码', 'prompt_injection_sql': '提示词注入数据库语句', 'prompt_injection_system_prompt': '窃取系统提示词',
    'nl_bsn_contextual': '荷兰公民服务号码', 'br_cpf': '巴西个人税号', 'br_cpf_unformatted': '巴西个人税号（无分隔符）',
    'br_phone_landline': '巴西固定电话号码', 'br_phone_mobile': '巴西移动电话号码', 'br_cep': '巴西邮政编码', 'br_cnpj': '巴西企业税号', 'br_rg': '巴西居民身份证号',
    'au_tfn': '澳大利亚税号', 'au_abn': '澳大利亚企业编号', 'au_medicare': '澳大利亚医保号码',
    'iban': '国际银行账户号码', 'fr_nir': '法国社会保障号码', 'eu_iban_enhanced': '欧盟银行账户号码（增强格式）',
    'fr_phone': '法国电话号码', 'eu_vat': '欧盟增值税号', 'eu_passport_generic': '欧盟护照号码', 'fr_postal_code': '法国邮政编码',
    'street_address': '街道地址', 'airline_pnr': '航班订座编号', 'skywards_number': '航空常旅客号码', 'uae_emirates_id': '阿联酋身份证号',
    'uae_phone': '阿联酋电话号码', 'flight_number': '航班号', 'sg_nric': '新加坡身份证号', 'sg_phone': '新加坡电话号码',
    'sg_postal_code': '新加坡邮政编码', 'sg_uen': '新加坡企业编号', 'sg_bank_account': '新加坡银行账号',
    'ca_sin': '加拿大社会保险号码', 'ca_ohip': '加拿大安大略省医保号码', 'ca_on_drivers_licence': '加拿大安大略省驾驶证号',
    'ca_immigration_doc': '加拿大移民文件号码', 'ca_bank_account': '加拿大银行账号', 'ca_postal_code': '加拿大邮政编码',
    'uoft_student_id': '校内学生或员工编号', 'uoft_utorid': '校内登录标识', 'uoft_tcard': '校园卡号',
}
COUNTRIES = {'us':'美国','uk':'英国','germany':'德国','france':'法国','netherlands':'荷兰','canada':'加拿大','india':'印度','australia':'澳大利亚','china':'中国','japan':'日本','singapore':'新加坡'}
CATEGORIES = dict(zip(
    ['General','Finance','USA','UK','Spain','Italy','Poland','Singapore','Australia','India','Finland','Germany','Korea','Canada','Sweden','Thailand','Turkey','Nigeria','Philippines','South Africa',
     'PII Patterns','Payment Card Patterns','Credential Patterns','Network Patterns','Protected Class - Fair Lending','Dangerous Content','Dangerous Content - High Risk','Dangerous Content - Crisis','Dangerous Content - Illegal','Brazilian PII Patterns','EU PII Patterns','Aviation PII Patterns','UAE PII Patterns','Singapore PII Patterns','Canadian PII Patterns','Canadian Institutional Identifiers (FIPPA)'],
    ['通用','金融','美国','英国','西班牙','意大利','波兰','新加坡','澳大利亚','印度','芬兰','德国','韩国','加拿大','瑞典','泰国','土耳其','尼日利亚','菲律宾','南非',
     '敏感信息模式','支付卡模式','凭据模式','网络地址模式','受保护身份与公平借贷','危险内容','高风险危险内容','危机干预内容','违法危险内容','巴西敏感信息模式','欧盟敏感信息模式','航空敏感信息模式','阿联酋敏感信息模式','新加坡敏感信息模式','加拿大敏感信息模式','加拿大机构标识模式']))

def private_guardrail_metadata(value):
    if not isinstance(value, dict):
        return value
    result = {}
    for key, row in value.items():
        if key not in NAMES or not isinstance(row, dict):
            continue
        row = dict(row)
        row['ui_friendly_name'] = NAMES[key]
        result[key] = localize_rule_schema(row)
    return result

def localize_rule_schema(value, field_key=''):
    if isinstance(value, list):
        return [localize_rule_schema(row, field_key) for row in value]
    if not isinstance(value, dict):
        return value
    output = {}
    for key, row in value.items():
        if key in ('description', 'field_description', 'tooltip') and isinstance(row, str):
            output[key] = FIELD_HINTS.get(field_key, '按实际内网规则配置填写，字段名保持原值。')
        elif key == 'display_name' and isinstance(row, str):
            name = value.get('name', '')
            output[key] = RULE_NAMES.get(name, ('护照号码（' + COUNTRIES.get(name.removeprefix('passport_'), '其他国家') + '）') if name.startswith('passport_') else '自定义内容规则')
        elif key == 'category' and isinstance(row, str):
            output[key] = CATEGORIES.get(row, row)
        elif key == 'pattern_categories' and isinstance(row, list):
            output[key] = [CATEGORIES.get(item, item) for item in row]
        elif key == 'supported_guardrails' and isinstance(row, dict):
            output[key] = {name: modes for name, modes in row.items() if name in NAMES}
        elif key in ('docs_url', 'documentation_url', 'logo_url'):
            output[key] = None
        elif key in ('default_value', 'placeholder') and isinstance(row, str) and row.startswith(('http://','https://')):
            output[key] = ''
        else:
            output[key] = localize_rule_schema(row, key)
    return output
