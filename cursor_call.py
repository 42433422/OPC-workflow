import json
import os
import sys
import urllib.request


def call_workflow(topic: str):
    token = os.getenv("COZE_API_TOKEN")
    workflow_id = os.getenv("COZE_WORKFLOW_ID", "video-script-generator-001")

    if not token:
        print("缺少环境变量 COZE_API_TOKEN，请先配置你的扣子 PAT。", file=sys.stderr)
        return

    url = "https://api.coze.cn/v1/workflows/run"

    # 根据你的工作流输入变量名调整这里的字段名
    parameters = {"topic": topic}
    payload = {
        "workflow_id": workflow_id,
        "parameters": parameters,
    }

    data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
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
    if len(sys.argv) > 1:
        topic = " ".join(sys.argv[1:]).strip()
    else:
        topic = input("请输入视频脚本主题（例如：新款运动鞋推广）：").strip()

    if not topic:
        print("主题不能为空。", file=sys.stderr)
        return

    call_workflow(topic)


if __name__ == "__main__":
    main()


