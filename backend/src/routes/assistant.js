const { callAIModel, PROVIDER_CONFIG } = require('../services/ai-service');
const { logger } = require('../utils/logger');

// 一个最小可用的“小碟助手意图路由”接口：/api/assistant
// 前端传入：{ provider, model, apiKey, message, sessionId? }
// 返回：{ tool, args, reply }
async function handleAssistant(req, res) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    try {
      const { provider, model, apiKey, message, sessionId } = JSON.parse(body || '{}');

      if (!provider || !model || !message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing provider / model / message' }));
        return;
      }

      const providerCfg = PROVIDER_CONFIG[provider] || { requireKey: true };
      if (providerCfg.requireKey && !apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API key is required for this provider' }));
        return;
      }

      const toolsSpec = `
你是公司内部语音助手「小碟」的“意图路由器”，只负责根据用户中文指令，选择要调用的工具，并给出简短中文说明。

必须严格输出 JSON，不能包含任何多余文字、注释或 markdown。
JSON 结构为：
{
  "tool": "open_finance_report | open_org_node_panel | default_reply",
  "args": { ... },
  "reply": "给用户看的简短中文回复"
}

可用工具：
1）open_finance_report
  - 说明：打开「财务部 · AI 花费报表」页面（finance-report.html），用于查看模型调用与费用。
  - args 字段：可以为空对象 {}，也可以包含可选字段：
    - "range": "all" | "last_7_days" | "last_30_days" | "last_90_days"

2）open_org_node_panel
  - 说明：在组织架构画布上，打开某个构建单位的悬浮窗面板。
  - args 必须包含字段：
    - "nodeName": 构建单位名称，例如 "财务部"、"项目部"、具体员工姓名等
    - "panelType": "feature" | "work" | "model" | "prompt"

3）default_reply
  - 说明：不调用任何工具，只返回一段自然语言回答。
  - args 为 {}。

选择工具的规则示例：
- 涉及“财务部 / 财务情况 / 模型花费 / AI 花费 + 工作情况 / 报表 / 打开 / 查看”等表述时，优先使用 open_finance_report；
- 涉及“打开 XX 工作情况 / 悬浮窗 / 模型接入 / 提示词”等构建单位相关操作时，使用 open_org_node_panel；
- 其他无法映射到具体工具的，使用 default_reply。

当前会话 ID（可选，用于后续扩展记忆）：${sessionId || 'N/A'}。
如果指令含糊不清，优先选择 default_reply，向用户追问澄清。
      `.trim();

      const messages = [
        { role: 'system', content: toolsSpec },
        { role: 'user', content: message }
      ];

      const result = await callAIModel(provider, model, messages, apiKey, {
        type: 'assistant',
        label: 'disc-assistant-intent'
      });

      let parsed;
      try {
        parsed = JSON.parse(result.content || '{}');
      } catch (e) {
        parsed = {
          tool: 'default_reply',
          args: {},
          reply: `（内部提示：模型未按 JSON 返回）${result.content || ''}`
        };
      }

      // 兜底防御：确保字段存在
      const safe = {
        tool: typeof parsed.tool === 'string' ? parsed.tool : 'default_reply',
        args: parsed && typeof parsed.args === 'object' ? parsed.args : {},
        reply:
          typeof parsed.reply === 'string' && parsed.reply.trim()
            ? parsed.reply.trim()
            : '好的，我会继续优化对话能力。'
      };

      logger.info('assistant.intent', { provider, model, tool: safe.tool });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(safe));
    } catch (error) {
      logger.error('Assistant error', { error });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

module.exports = {
  handleAssistant
};


