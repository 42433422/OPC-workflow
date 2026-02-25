import json
import os
import sys
import urllib.request


COZE_API_TOKEN = os.getenv("COZE_API_TOKEN")
WORKFLOW_ID = os.getenv("COZE_WORKFLOW_ID", "video-script-generator-001")


def call_workflow(parameters: dict):
  if not COZE_API_TOKEN:
    print("缺少环境变量 COZE_API_TOKEN，请先配置你的扣子 PAT。", file=sys.stderr)
    sys.exit(1)

  url = "https://api.coze.cn/v1/workflows/run"
  payload = {
    "workflow_id": WORKFLOW_ID,
    "parameters": parameters,
  }

  data = json.dumps(payload).encode("utf-8")

  req = urllib.request.Request(
    url,
    data=data,
    headers={
      "Authorization": f"Bearer {COZE_API_TOKEN}",
      "Content-Type": "application/json",
    },
    method="POST",
  )

  try:
    with urllib.request.urlopen(req) as resp:
      body = resp.read().decode("utf-8")
      print("Status:", resp.status)
      print("Response:", body)
  except urllib.error.HTTPError as e:
    body = e.read().decode("utf-8")
    print("Status:", e.code, file=sys.stderr)
    print("Response:", body, file=sys.stderr)
  except Exception as e:
    print("调用工作流出错:", str(e), file=sys.stderr)


def main():
  # 1) 从命令行获取输入
  if len(sys.argv) > 1:
    raw_input = " ".join(sys.argv[1:]).strip()
  else:
    raw_input = input("请输入视频脚本主题（例如：新款运动鞋推广）：").strip()

  if not raw_input:
    print("输入不能为空。", file=sys.stderr)
    sys.exit(1)

  # 2) 如果看起来是 JSON，尝试解析为完整 parameters
  parameters: dict
  if raw_input.startswith("{") and raw_input.endswith("}"):
    try:
      parsed = json.loads(raw_input)
      if isinstance(parsed, dict):
        parameters = parsed
      else:
        print("JSON 必须是对象类型，例如 {\"topic\": \"xxx\"}。", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
      print(f"解析 JSON 失败: {e}", file=sys.stderr)
      sys.exit(1)
  else:
    # 3) 否则自动转换为 { "topic": "<输入文本>" }
    # 如果你的工作流输入变量不是 topic，请在这里改成对应的字段名
    parameters = {"topic": raw_input}

  print("调用工作流:", WORKFLOW_ID)
  print("parameters:", json.dumps(parameters, ensure_ascii=False, indent=2))
  call_workflow(parameters)


if __name__ == "__main__":
  main()


