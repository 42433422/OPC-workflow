#!/usr/bin/env bash

# 简单的本地工作流运行脚本
# 依赖：
#   - 已安装 Python（推荐 3.8+）
#   - 已在环境中设置 COZE_API_TOKEN（扣子 PAT）
#
# 用法示例：
#   bash scripts/local_run.sh -m flow              # 交互式输入
#   bash scripts/local_run.sh -m flow -i '{"topic": "新款运动鞋推广"}'
#   bash scripts/local_run.sh -m flow -i '美食探店推荐'

set -e

MODE=""
INPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--mode)
      MODE="$2"
      shift 2
      ;;
    -i|--input)
      INPUT="$2"
      shift 2
      ;;
    *)
      echo "未知参数: $1"
      exit 1
      ;;
  esac
done

if [[ "$MODE" != "flow" ]]; then
  echo "当前脚本仅支持 -m flow 模式，例如：bash scripts/local_run.sh -m flow"
  exit 1
fi

if [[ -z "$COZE_API_TOKEN" ]]; then
  echo "缺少 COZE_API_TOKEN 环境变量，请先导出你的扣子 PAT，例如："
  echo "  export COZE_API_TOKEN=\"pat_xxx\""
  exit 1
fi

if [[ -z "$INPUT" ]]; then
  echo "请输入视频脚本主题（例如：新款运动鞋推广）："
  read -r INPUT
fi

python scripts/run_workflow.py "$INPUT"


