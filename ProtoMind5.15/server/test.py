import requests
from requests.packages.urllib3.util.ssl_ import create_urllib3_context

# 测试基本连接
try:
    response = requests.get("https://api.doubao.com", timeout=5)
    print("基本连接测试:", response.status_code)
except Exception as e:
    print("连接测试失败:", str(e))