const { callAIModel, PROVIDER_CONFIG } = require('../services/ai-service');
const { ok, error } = require('../utils/response');

async function handleChat(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { provider, model, messages, apiKey, source } = JSON.parse(body || '{}');
      const providerCfg = PROVIDER_CONFIG[provider] || { requireKey: true };

      if (!provider || !model || !messages) {
        return error(res, 400, 'BAD_REQUEST', '缺少必要参数 provider / model / messages');
      }

      // 仅在该渠道要求密钥时强制校验 apiKey
      if (providerCfg.requireKey && !apiKey) {
        return error(res, 400, 'API_KEY_REQUIRED', '该模型提供商需要配置 API Key');
      }

      const result = await callAIModel(provider, model, messages, apiKey, source);
      // 为了保持前端兼容，在 data 中返回 result，同时在顶层也展开一份 content 字段
      return ok(res, result, '调用大模型成功');
    } catch (error) {
      console.error('Chat error:', error);
      return error(res, 500, 'CHAT_ERROR', error.message);
    }
  });
}

module.exports = {
  handleChat
};


