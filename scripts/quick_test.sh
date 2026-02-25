#!/usr/bin/env bash

# 一键快速测试工作流生成视频脚本
#
# 用法：
#   ./scripts/quick_test.sh 美食探店
#   ./scripts/quick_test.sh          # 使用默认主题

set -e

TOPIC="$1"

if [[ -z "$TOPIC" ]]; then
  TOPIC="春节促销活动视频脚本"
fi

bash scripts/local_run.sh -m flow -i "$TOPIC"


