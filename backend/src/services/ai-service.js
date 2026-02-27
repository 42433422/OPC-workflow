const nodeFetch = require('node-fetch');
const fetch = nodeFetch;
const { sqliteDb } = require('../utils/sqlite');
const { logger } = require('../utils/logger');

// 各大模型提供商配置（是否必须要 API Key）
const PROVIDER_CONFIG = {
  qwen: { requireKey: true },
  deepseek: { requireKey: true },
  moonshot: { requireKey: true },
  zhipu: { requireKey: true },
  // 国外模型
  openai: { requireKey: true },
  grok: { requireKey: true },
  gemini: { requireKey: true }
  // 示例：接入免 Key 接口
  // freeai: { requireKey: false, useBackendKey: true }
};

// 简单的单价表（示例）：单位为“元 / 1K tokens”
const TOKEN_PRICING = {
  qwen: {
    'qwen-max': 0.02,
    'qwen-plus': 0.01,
    'qwen-turbo': 0.005,
    'qwen-coder-plus': 0.01
  },
  deepseek: {
    'deepseek-chat': 0.01,
    'deepseek-coder': 0.01,
    'deepseek-reasoner': 0.02
  },
  moonshot: {
    'moonshot-v1-8k': 0.02,
    'moonshot-v1-32k': 0.04,
    'moonshot-v1-128k': 0.08
  },
  zhipu: {
    'glm-4': 0.02,
    'glm-4-flash': 0.01,
    'glm-3-turbo': 0.005
  },
  openai: {
    'gpt-4o-mini': 0.015,
    'gpt-4o': 0.03,
    'gpt-4.1-mini': 0.015,
    'gpt-4.1': 0.05
  },
  grok: {
    'grok-2-latest': 0.03,
    'grok-2-mini': 0.015,
    'grok-3': 0.05
  },
  gemini: {
    'gemini-1.5-pro': 0.03,
    'gemini-1.5-flash': 0.015,
    'gemini-2.0-flash': 0.02
  }
};

// 调用 AI 模型，并将用量写入 SQLite
async function callAIModel(provider, model, messages, apiKey, source) {
  const providers = {
    qwen: {
      url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      formatBody: (model, messages) => ({
        model: model,
        input: {
          messages: messages.map(m => ({
            role: m.role,
            content: m.content
          }))
        },
        parameters: {
          result_format: 'message'
        }
      }),
      parseResponse: (data) => {
        if (data.output && data.output.choices && data.output.choices[0]) {
          return {
            content: data.output.choices[0].message.content,
            usage: data.usage
          };
        }
        throw new Error('Invalid response format');
      }
    },

    deepseek: {
      url: 'https://api.deepseek.com/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      formatBody: (model, messages) => ({
        model: model,
        messages: messages,
        stream: false
      }),
      parseResponse: (data) => {
        if (data.choices && data.choices[0]) {
          return {
            content: data.choices[0].message.content,
            usage: data.usage
          };
        }
        throw new Error('Invalid response format');
      }
    },

    moonshot: {
      url: 'https://api.moonshot.cn/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      formatBody: (model, messages) => ({
        model: model,
        messages: messages,
        stream: false
      }),
      parseResponse: (data) => {
        if (data.choices && data.choices[0]) {
          return {
            content: data.choices[0].message.content,
            usage: data.usage
          };
        }
        throw new Error('Invalid response format');
      }
    },

    zhipu: {
      url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      formatBody: (model, messages) => ({
        model: model,
        messages: messages,
        stream: false
      }),
      parseResponse: (data) => {
        if (data.choices && data.choices[0]) {
          return {
            content: data.choices[0].message.content,
            usage: data.usage
          };
        }
        throw new Error('Invalid response format');
      }
    },

    // OpenAI（GPT 系列）
    openai: {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      formatBody: (model, messages) => ({
        model,
        messages,
        stream: false
      }),
      parseResponse: (data) => {
        if (data.choices && data.choices[0]) {
          return {
            content: data.choices[0].message.content,
            usage: data.usage
          };
        }
        throw new Error('Invalid response format');
      }
    },

    // Grok（xAI）
    grok: {
      url: 'https://api.x.ai/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      formatBody: (model, messages) => ({
        model,
        messages,
        stream: false
      }),
      parseResponse: (data) => {
        if (data.choices && data.choices[0]) {
          return {
            content: data.choices[0].message.content,
            usage: data.usage
          };
        }
        throw new Error('Invalid response format');
      }
    },

    // Gemini（Google）
    gemini: {
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      formatBody: (model, messages) => ({
        model,
        messages,
        stream: false
      }),
      parseResponse: (data) => {
        if (data.choices && data.choices[0]) {
          return {
            content: data.choices[0].message.content,
            usage: data.usage
          };
        }
        throw new Error('Invalid response format');
      }
    }
  };

  const config = providers[provider];
  if (!config) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(config.formatBody(model, messages))
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const parsed = config.parseResponse(data);

    // 记录用量信息到 SQLite usage_records
    try {
      const usageInfo = parsed.usage || {};
      const totalTokens = usageInfo.total_tokens
        || (usageInfo.input_tokens || 0) + (usageInfo.output_tokens || 0)
        || (usageInfo.prompt_tokens || 0) + (usageInfo.completion_tokens || 0);

      const prompt = usageInfo.prompt_tokens || usageInfo.input_tokens || 0;
      const completion = usageInfo.completion_tokens || usageInfo.output_tokens || 0;
      const total = totalTokens || prompt + completion;

      const sourceRaw = source || null;
      let sourceType = null;
      let sourceLabel = null;
      if (sourceRaw && typeof sourceRaw === 'object') {
        sourceType = sourceRaw.type || null;
        sourceLabel =
          sourceType === 'employee'
            ? sourceRaw.employeeName || `员工#${sourceRaw.employeeId || '-'}`
            : sourceType === 'department'
              ? sourceRaw.deptName || '某部门'
              : sourceType === 'project'
                ? sourceRaw.projectName || '某项目'
                : sourceType === 'assistant'
                  ? '小碟助手'
                  : sourceType === 'global-assistant'
                    ? '顶部 AI 助手'
                    : null;
      } else if (typeof sourceRaw === 'string') {
        sourceType = 'raw';
        sourceLabel = sourceRaw;
      }

      sqliteDb
        .prepare(
          `INSERT INTO usage_records
           (time, provider, model, source_type, source_label, source_raw,
            prompt_tokens, completion_tokens, total_tokens)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          new Date().toISOString(),
          provider,
          model,
          sourceType,
          sourceLabel,
          JSON.stringify(sourceRaw),
          prompt,
          completion,
          total
        );
    } catch (e) {
      logger.error('记录模型用量到 SQLite 失败', { error: e });
    }

    return parsed;
  } catch (error) {
    logger.error('调用外部模型 API 出错', { provider, model, error });
    throw error;
  }
}

module.exports = {
  callAIModel,
  PROVIDER_CONFIG,
  TOKEN_PRICING
};


