import os
from urllib.parse import quote

from realai_private.network import install_network_guard

if os.getenv('REDIS_HOST') and not os.getenv('REDIS_URL'):
    host = os.environ['REDIS_HOST']
    host = f'[{host}]' if ':' in host and not host.startswith('[') else host
    password = os.getenv('REDIS_PASSWORD', '')
    user = os.getenv('REDIS_USERNAME', '')
    credentials = f'{quote(user, safe="")}:{quote(password, safe="")}@' if password or user else ''
    scheme = 'rediss' if os.getenv('REDIS_SSL', 'false').lower() == 'true' else 'redis'
    os.environ['REDIS_URL'] = f'{scheme}://{credentials}{host}:{os.getenv("REDIS_PORT", "6379")}/{os.getenv("REDIS_DB", "0")}'

install_network_guard()
