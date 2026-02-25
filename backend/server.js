const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');
const XLSX = require('xlsx');
const nodeFetch = require('node-fetch');
const fetch = nodeFetch;

// 数据存储路径（简单文件数据库）
const dataDir = path.join(__dirname, 'data');
const employeeFile = path.join(dataDir, 'employees.json');
const deptFile = path.join(dataDir, 'departments.json');
const usageFile = path.join(dataDir, 'usage.json');
const deptReportRootDir = path.join(dataDir, 'dept-reports');

// 确保数据目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
// 部门报表根目录
if (!fs.existsSync(deptReportRootDir)) {
  fs.mkdirSync(deptReportRootDir, { recursive: true });
}

// 读写员工"数据库"
function loadEmployeeDb() {
  if (!fs.existsSync(employeeFile)) {
    return { nextId: 1, employees: [] };
  }
  try {
    const raw = fs.readFileSync(employeeFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      nextId: parsed.nextId || 1,
      employees: Array.isArray(parsed.employees) ? parsed.employees : []
    };
  } catch (e) {
    console.error('读取员工数据库失败，重置为空:', e);
    return { nextId: 1, employees: [] };
  }
}

function saveEmployeeDb(db) {
  fs.writeFileSync(employeeFile, JSON.stringify(db, null, 2) + os.EOL, 'utf-8');
}

// 读写部门"数据库"
function loadDeptDb() {
  if (!fs.existsSync(deptFile)) {
    return {
      nextId: 1,
      departments: [
        { id: 1, name: '董事会', code: 'BOARD', note: '公司最高决策层' },
        { id: 2, name: '总经理办公室', code: 'CEO_OFFICE', note: '协调公司整体运营' },
        { id: 3, name: '项目部', code: 'PROJECT', note: '负责各类项目推进' },
        { id: 4, name: '宣传部', code: 'MARKETING', note: '品牌宣传与市场活动' },
        { id: 5, name: '程序部', code: 'DEV', note: '前端 / 后端 / 技术开发' },
        { id: 6, name: '市场部', code: 'SALES', note: '销售与市场拓展' },
        { id: 7, name: '人事部', code: 'HR', note: '招聘与员工管理' },
        { id: 8, name: '财务部', code: 'FIN', note: '财务与成本控制' },
        { id: 9, name: '运营部', code: 'OPS', note: '日常运营与维护' }
      ]
    };
  }
  try {
    const raw = fs.readFileSync(deptFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      nextId: parsed.nextId || (Array.isArray(parsed.departments) ? parsed.departments.length + 1 : 1),
      departments: Array.isArray(parsed.departments) ? parsed.departments : []
    };
  } catch (e) {
    console.error('读取部门数据库失败，重置为空:', e);
    return { nextId: 1, departments: [] };
  }
}

function saveDeptDb(db) {
  fs.writeFileSync(deptFile, JSON.stringify(db, null, 2) + os.EOL, 'utf-8');
}

// 为每个部门准备一个对应的报表文件夹（示例：财务部 / 程序部 / 市场部等）
function initDeptReportDirs() {
  const db = loadDeptDb();
  (db.departments || []).forEach((dept) => {
    if (!dept || !dept.name) return;
    const dir = path.join(deptReportRootDir, dept.name);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (e) {
        console.error('创建部门报表文件夹失败:', dept.name, e);
      }
    }
  });
}

// 读写模型调用用量 / 费用数据库
function loadUsageDb() {
  if (!fs.existsSync(usageFile)) {
    return { records: [] };
  }
  try {
    const raw = fs.readFileSync(usageFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      records: Array.isArray(parsed.records) ? parsed.records : []
    };
  } catch (e) {
    console.error('读取用量数据库失败，重置为空:', e);
    return { records: [] };
  }
}

function saveUsageDb(db) {
  fs.writeFileSync(usageFile, JSON.stringify(db, null, 2) + os.EOL, 'utf-8');
}

// 简单的路由处理
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API 路由
  if (pathname === '/api/chat' && method === 'POST') {
    await handleChat(req, res);
    return;
  }

  if (pathname === '/api/coze-workflow' && method === 'POST') {
    return handleCozeWorkflow(req, res);
  }

  if (pathname === '/api/models' && method === 'GET') {
    handleGetModels(req, res);
    return;
  }

  if (pathname === '/api/usage-report' && method === 'GET') {
    return handleUsageReport(req, res);
  }

  if (pathname === '/api/usage-report-doc' && method === 'GET') {
    return handleUsageReportDoc(req, res);
  }

  if (pathname === '/api/usage-records' && method === 'GET') {
    return handleUsageRecords(req, res);
  }

  if (pathname === '/api/usage-report-xlsx' && method === 'GET') {
    return handleUsageReportXlsx(req, res);
  }

  if (pathname === '/api/usage-records' && method === 'GET') {
    return handleUsageRecords(req, res);
  }

  // 员工数据库 API
  if (pathname === '/api/employees' && method === 'GET') {
    return handleGetEmployees(req, res);
  }

  if (pathname === '/api/employees' && method === 'POST') {
    return handleCreateEmployee(req, res);
  }

  // /api/employees/:id
  if (pathname.startsWith('/api/employees/') && (method === 'PUT' || method === 'DELETE')) {
    const idStr = pathname.replace('/api/employees/', '');
    const id = parseInt(idStr, 10);
    if (!Number.isInteger(id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid employee id' }));
      return;
    }
    if (method === 'PUT') {
      return handleUpdateEmployee(req, res, id);
    }
    if (method === 'DELETE') {
      return handleDeleteEmployee(req, res, id);
    }
  }

  // 部门数据库 API
  if (pathname === '/api/departments' && method === 'GET') {
    return handleGetDepts(req, res);
  }

  if (pathname === '/api/departments' && method === 'POST') {
    return handleCreateDept(req, res);
  }

  if (pathname.startsWith('/api/departments/') && (method === 'PUT' || method === 'DELETE')) {
    const idStr = pathname.replace('/api/departments/', '');
    const id = parseInt(idStr, 10);
    if (!Number.isInteger(id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid department id' }));
      return;
    }
    if (method === 'PUT') {
      return handleUpdateDept(req, res, id);
    }
    if (method === 'DELETE') {
      return handleDeleteDept(req, res, id);
    }
  }

  // 静态文件服务
  serveStaticFile(req, res, pathname);
});

// 各大模型提供商配置（是否必须要 API Key）
// 如果接入"无需账号/密钥"的免费接口，把 requireKey 设为 false
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

// 处理聊天请求
async function handleChat(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { provider, model, messages, apiKey, source } = JSON.parse(body);
      const providerCfg = PROVIDER_CONFIG[provider] || { requireKey: true };

      if (!provider || !model || !messages) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required parameters' }));
        return;
      }

      // 仅在该渠道要求密钥时强制校验 apiKey
      if (providerCfg.requireKey && !apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API key is required for this provider' }));
        return;
      }

      const result = await callAIModel(provider, model, messages, apiKey, source);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      console.error('Chat error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

// 员工列表
function handleGetEmployees(req, res) {
  const db = loadEmployeeDb();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(db.employees));
}

// 创建员工
function handleCreateEmployee(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const db = loadEmployeeDb();

      const employee = {
        id: db.nextId++,
        name: payload.name || '',
        role: payload.role || '',
        dept: payload.dept || '',
        note: payload.note || '',
        // 预留扩展字段：每个员工独立信息
        meta: payload.meta || {}
      };

      db.employees.push(employee);
      saveEmployeeDb(db);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(employee));
    } catch (e) {
      console.error('Create employee error:', e);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
  });
}

// 更新员工
function handleUpdateEmployee(req, res, id) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const db = loadEmployeeDb();
      const idx = db.employees.findIndex(e => e.id === id);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Employee not found' }));
        return;
      }

      const old = db.employees[idx];
      const updated = {
        ...old,
        name: payload.name !== undefined ? payload.name : old.name,
        role: payload.role !== undefined ? payload.role : old.role,
        dept: payload.dept !== undefined ? payload.dept : old.dept,
        note: payload.note !== undefined ? payload.note : old.note,
        meta: payload.meta !== undefined ? payload.meta : (old.meta || {})
      };

      db.employees[idx] = updated;
      saveEmployeeDb(db);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(updated));
    } catch (e) {
      console.error('Update employee error:', e);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
  });
}

// 删除员工
function handleDeleteEmployee(req, res, id) {
  const db = loadEmployeeDb();
  const idx = db.employees.findIndex(e => e.id === id);
  if (idx === -1) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Employee not found' }));
    return;
  }

  const removed = db.employees.splice(idx, 1)[0];
  saveEmployeeDb(db);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(removed));
}

// 部门列表
function handleGetDepts(req, res) {
  const db = loadDeptDb();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(db.departments));
}

// 创建部门
function handleCreateDept(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const db = loadDeptDb();

      const dept = {
        id: db.nextId++,
        name: payload.name || '',
        code: payload.code || '',
        note: payload.note || '',
        meta: payload.meta || {}
      };

      db.departments.push(dept);
      saveDeptDb(db);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dept));
    } catch (e) {
      console.error('Create department error:', e);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
  });
}

// 更新部门
function handleUpdateDept(req, res, id) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const db = loadDeptDb();
      const idx = db.departments.findIndex(d => d.id === id);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Department not found' }));
        return;
      }

      const old = db.departments[idx];
      const updated = {
        ...old,
        name: payload.name !== undefined ? payload.name : old.name,
        code: payload.code !== undefined ? payload.code : old.code,
        note: payload.note !== undefined ? payload.note : old.note,
        meta: payload.meta !== undefined ? payload.meta : (old.meta || {})
      };

      db.departments[idx] = updated;
      saveDeptDb(db);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(updated));
    } catch (e) {
      console.error('Update department error:', e);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
  });
}

// 删除部门
function handleDeleteDept(req, res, id) {
  const db = loadDeptDb();
  const idx = db.departments.findIndex(d => d.id === id);
  if (idx === -1) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Department not found' }));
    return;
  }

  const removed = db.departments.splice(idx, 1)[0];
  saveDeptDb(db);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(removed));
}

// 调用 AI 模型
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

    // OpenAI（GPT 系列，如 gpt-4o, gpt-4.1 等）
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

    // Grok（xAI，使用兼容 OpenAI 的 chat.completions 接口）
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

    // Gemini（Google / Google AI Studio）
    gemini: {
      // 这里使用统一的"兼容 OpenAI Chat Completions"代理风格，你可以按自己网关实际地址替换
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

    // 记录用量信息到本地 usage.json，便于财务部统计费用
    try {
      const usageInfo = parsed.usage || {};
      const totalTokens = usageInfo.total_tokens
        || (usageInfo.input_tokens || 0) + (usageInfo.output_tokens || 0)
        || (usageInfo.prompt_tokens || 0) + (usageInfo.completion_tokens || 0);

      const db = loadUsageDb();
      db.records.push({
        time: new Date().toISOString(),
        provider,
        model,
        source: source || null,
        usage: {
          prompt_tokens: usageInfo.prompt_tokens || usageInfo.input_tokens || 0,
          completion_tokens: usageInfo.completion_tokens || usageInfo.output_tokens || 0,
          total_tokens: totalTokens || 0
        }
      });
      saveUsageDb(db);
    } catch (e) {
      console.error('记录模型用量失败:', e);
    }

    return parsed;
  } catch (error) {
    console.error('API call error:', error);
    throw error;
  }
}

// 获取可用模型列表
// 这是权威模型清单，前端启动时会请求此接口
function handleGetModels(req, res) {
  const models = {
    qwen: {
      name: '通义千问',
      models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-coder-plus']
    },
    deepseek: {
      name: 'DeepSeek',
      models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner']
    },
    moonshot: {
      name: 'Kimi',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
    },
    zhipu: {
      name: '智谱 GLM',
      models: ['glm-4', 'glm-4-flash', 'glm-3-turbo']
    },
    openai: {
      name: 'OpenAI（GPT）',
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1']
    },
    grok: {
      name: 'Grok（xAI）',
      models: ['grok-2-latest', 'grok-2-mini', 'grok-3']
    },
    gemini: {
      name: 'Gemini',
      models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash']
    }
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(models));
}

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

// Coze 工作流调用（令牌优先从环境变量读取）
const COZE_CONFIG = {
  apiToken: process.env.COZE_API_TOKEN || process.env.COZE_WORKFLOW_TOKEN || ''
};

async function handleCozeWorkflow(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}');

      const token = COZE_CONFIG.apiToken;
      if (!token) {
        throw new Error('Coze 工作流令牌未配置，请在环境变量 COZE_API_TOKEN 或 COZE_WORKFLOW_TOKEN 中设置。');
      }

      // 使用工作流专属域名，不再直接调用通用 /v1/workflows/run
      const url = 'https://cz5k6mzkgq.coze.site/run';
      // 直接转发前端传入的参数；常见为 { topic: '...' }
      const requestBody = payload && typeof payload === 'object' ? payload : {};
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Coze API error: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (error) {
      console.error('Coze workflow error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

// 生成用量 / 费用报表：按厂商 + 模型汇总
function handleUsageReport(req, res) {
  const db = loadUsageDb();
  const summary = {};
  const summaryBySource = {};

  db.records.forEach(rec => {
    const prov = rec.provider || 'unknown';
    const model = rec.model || 'unknown';
    const u = rec.usage || {};
    const prompt = u.prompt_tokens || 0;
    const completion = u.completion_tokens || 0;
    const total = u.total_tokens || (prompt + completion);

    if (!summary[prov]) summary[prov] = {};
    if (!summary[prov][model]) {
      summary[prov][model] = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        total_cost: 0
      };
    }

    summary[prov][model].prompt_tokens += prompt;
    summary[prov][model].completion_tokens += completion;
    summary[prov][model].total_tokens += total;

    // 按来源维度汇总（部门 / 员工 / 项目 / 小碟 / 顶部助手等）
    const src = rec.source || {};
    const srcType = src.type || 'unknown';
    const srcLabel =
      srcType === 'employee'
        ? (src.employeeName || `员工#${src.employeeId || '-'}`)
        : srcType === 'department'
          ? (src.deptName || '某部门')
          : srcType === 'project'
            ? (src.projectName || '某项目')
            : srcType === 'assistant'
              ? '小碟助手'
              : srcType === 'global-assistant'
                ? '顶部 AI 助手'
                : '未标注来源';

    const sourceKey = `${srcType}:${srcLabel}`;
    if (!summaryBySource[sourceKey]) {
      summaryBySource[sourceKey] = {
        type: srcType,
        label: srcLabel,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        total_cost: 0
      };
    }

    summaryBySource[sourceKey].prompt_tokens += prompt;
    summaryBySource[sourceKey].completion_tokens += completion;
    summaryBySource[sourceKey].total_tokens += total;
  });

  // 根据单价表估算费用
  Object.entries(summary).forEach(([prov, models]) => {
    Object.entries(models).forEach(([model, stat]) => {
      const priceMap = TOKEN_PRICING[prov] || {};
      const pricePerK = priceMap[model] || 0; // 元 / 1K tokens
      stat.total_cost = +(stat.total_tokens / 1000 * pricePerK).toFixed(4);
    });
  });

  Object.values(summaryBySource).forEach(stat => {
    // 这里简单用「unknown/模型平均价」兜底；严格场景可以带上 provider/model 再精算
    // 暂时按统一 0.02 元 / 1K tokens 估算
    const pricePerK = 0.02;
    stat.total_cost = +(stat.total_tokens / 1000 * pricePerK).toFixed(4);
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ summary, summaryBySource }));
}

// 获取详细用量记录
function handleUsageRecords(req, res) {
  const db = loadUsageDb();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(db.records || []));
}

// 构造简单的 RTF 文本，供 Word 打开（.doc / RTF）
function buildUsageReportRtf(summary, summaryBySource) {
  let rtf = '{\\rtf1\\ansi\\deff0\n';
  rtf += '{\\b 模型用量与费用报表}\\par\n';
  rtf += `生成时间：${new Date().toLocaleString()}\\par\\par\n`;

  // 按厂商 + 模型
  Object.entries(summary).forEach(([prov, models]) => {
    rtf += `{\\b 提供商：}${prov} \\par\n`;
    rtf += '模型\tPrompt Tokens\tCompletion Tokens\tTotal Tokens\t预计成本(元)\\par\n';
    Object.entries(models).forEach(([model, stat]) => {
      rtf += `${model}\t${stat.prompt_tokens || 0}\t${stat.completion_tokens || 0}\t${stat.total_tokens || 0}\t${(stat.total_cost || 0).toFixed(4)}\\par\n`;
    });
    rtf += '\\par\n';
  });

  // 按来源
  const sourceKeys = Object.keys(summaryBySource || {});
  if (sourceKeys.length > 0) {
    rtf += '{\\b 按来源汇总（部门 / 员工 / 项目 / 助手）}\\par\n';
    rtf += '来源类型\t来源名称\tTotal Tokens\t预计成本(元)\\par\n';
    sourceKeys.forEach((key) => {
      const stat = summaryBySource[key];
      rtf += `${stat.type}\t${stat.label}\t${stat.total_tokens || 0}\t${(stat.total_cost || 0).toFixed(4)}\\par\n`;
    });
  }

  rtf += '}';
  return rtf;
}

// 导出 Word/RTF 报表
function handleUsageReportDoc(req, res) {
  const db = loadUsageDb();
  const summary = {};
  const summaryBySource = {};

  db.records.forEach(rec => {
    const prov = rec.provider || 'unknown';
    const model = rec.model || 'unknown';
    const u = rec.usage || {};
    const prompt = u.prompt_tokens || 0;
    const completion = u.completion_tokens || 0;
    const total = u.total_tokens || (prompt + completion);

    if (!summary[prov]) summary[prov] = {};
    if (!summary[prov][model]) {
      summary[prov][model] = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        total_cost: 0
      };
    }

    summary[prov][model].prompt_tokens += prompt;
    summary[prov][model].completion_tokens += completion;
    summary[prov][model].total_tokens += total;

    const src = rec.source || {};
    const srcType = src.type || 'unknown';
    const srcLabel =
      srcType === 'employee'
        ? (src.employeeName || `员工#${src.employeeId || '-'}`)
        : srcType === 'department'
          ? (src.deptName || '某部门')
          : srcType === 'project'
            ? (src.projectName || '某项目')
            : srcType === 'assistant'
              ? '小碟助手'
              : srcType === 'global-assistant'
                ? '顶部 AI 助手'
                : '未标注来源';

    const sourceKey = `${srcType}:${srcLabel}`;
    if (!summaryBySource[sourceKey]) {
      summaryBySource[sourceKey] = {
        type: srcType,
        label: srcLabel,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        total_cost: 0
      };
    }

    summaryBySource[sourceKey].prompt_tokens += prompt;
    summaryBySource[sourceKey].completion_tokens += completion;
    summaryBySource[sourceKey].total_tokens += total;
  });

  // 套用与 JSON 报表相同的单价逻辑
  Object.entries(summary).forEach(([prov, models]) => {
    Object.entries(models).forEach(([model, stat]) => {
      const priceMap = TOKEN_PRICING[prov] || {};
      const pricePerK = priceMap[model] || 0;
      stat.total_cost = +(stat.total_tokens / 1000 * pricePerK).toFixed(4);
    });
  });
  Object.values(summaryBySource).forEach(stat => {
    const pricePerK = 0.02;
    stat.total_cost = +(stat.total_tokens / 1000 * pricePerK).toFixed(4);
  });

  const rtf = buildUsageReportRtf(summary, summaryBySource);
  const filename = `模型用量报表_${new Date().toISOString().slice(0, 10)}.doc`;

   // 默认将报表文件持久化到“财务部”文件夹中，方便财务部归档
  try {
    const financeDir = path.join(deptReportRootDir, '财务部');
    if (!fs.existsSync(financeDir)) {
      fs.mkdirSync(financeDir, { recursive: true });
    }
    const filePath = path.join(financeDir, filename);
    fs.writeFileSync(filePath, rtf, 'utf-8');
    console.log('💾 已生成财务部报表文件:', filePath);
  } catch (e) {
    console.error('保存财务部报表失败:', e);
  }

  res.writeHead(200, {
    'Content-Type': 'application/msword; charset=utf-8',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`
  });
  res.end(rtf, 'utf-8');
}

// 返回原始用量记录列表，供财务分析页做更细的筛选 / 统计
function handleUsageRecords(req, res) {
  const db = loadUsageDb();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(db.records || []));
}

// 导出 Excel 报表
function handleUsageReportXlsx(req, res) {
  const db = loadUsageDb();
  const summary = {};
  const summaryBySource = {};
  const allRecords = [];

  db.records.forEach(rec => {
    const prov = rec.provider || 'unknown';
    const model = rec.model || 'unknown';
    const u = rec.usage || {};
    const prompt = u.prompt_tokens || 0;
    const completion = u.completion_tokens || 0;
    const total = u.total_tokens || (prompt + completion);

    allRecords.push({
      '时间': rec.time ? new Date(rec.time).toLocaleString('zh-CN') : '',
      '提供商': prov,
      '模型': model,
      'Prompt Tokens': prompt,
      'Completion Tokens': completion,
      'Total Tokens': total,
      '来源类型': rec.source?.type || 'unknown',
      '来源名称': rec.source?.type === 'employee' ? rec.source?.employeeName :
                  rec.source?.type === 'department' ? rec.source?.deptName :
                  rec.source?.type === 'project' ? rec.source?.projectName :
                  rec.source?.type === 'assistant' ? '小碟助手' :
                  rec.source?.type === 'global-assistant' ? '顶部 AI 助手' : '未知'
    });

    if (!summary[prov]) summary[prov] = {};
    if (!summary[prov][model]) {
      summary[prov][model] = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        total_cost: 0
      };
    }

    summary[prov][model].prompt_tokens += prompt;
    summary[prov][model].completion_tokens += completion;
    summary[prov][model].total_tokens += total;

    const src = rec.source || {};
    const srcType = src.type || 'unknown';
    const srcLabel =
      srcType === 'employee'
        ? (src.employeeName || `员工#${src.employeeId || '-'}`)
        : srcType === 'department'
          ? (src.deptName || '某部门')
          : srcType === 'project'
            ? (src.projectName || '某项目')
            : srcType === 'assistant'
              ? '小碟助手'
              : srcType === 'global-assistant'
                ? '顶部 AI 助手'
                : '未标注来源';

    const sourceKey = `${srcType}:${srcLabel}`;
    if (!summaryBySource[sourceKey]) {
      summaryBySource[sourceKey] = {
        type: srcType,
        label: srcLabel,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        total_cost: 0
      };
    }

    summaryBySource[sourceKey].prompt_tokens += prompt;
    summaryBySource[sourceKey].completion_tokens += completion;
    summaryBySource[sourceKey].total_tokens += total;
  });

  Object.entries(summary).forEach(([prov, models]) => {
    Object.entries(models).forEach(([model, stat]) => {
      const priceMap = TOKEN_PRICING[prov] || {};
      const pricePerK = priceMap[model] || 0;
      stat.total_cost = +(stat.total_tokens / 1000 * pricePerK).toFixed(4);
    });
  });
  Object.values(summaryBySource).forEach(stat => {
    const pricePerK = 0.02;
    stat.total_cost = +(stat.total_tokens / 1000 * pricePerK).toFixed(4);
  });

  const wb = XLSX.utils.book_new();

  const wsSummary = XLSX.utils.aoa_to_sheet([
    ['模型用量与费用报表'],
    [`生成时间：${new Date().toLocaleString('zh-CN')}`],
    [''],
    ['===== 费用汇总 ====='],
    ['总调用次数', db.records.length],
    ['总 Prompt Tokens', Object.values(summary).reduce((a, b) => a + Object.values(b).reduce((c, d) => c + d.prompt_tokens, 0), 0)],
    ['总 Completion Tokens', Object.values(summary).reduce((a, b) => a + Object.values(b).reduce((c, d) => c + d.completion_tokens, 0), 0)],
    ['总 Tokens', Object.values(summary).reduce((a, b) => a + Object.values(b).reduce((c, d) => c + d.total_tokens, 0), 0)],
    ['总预计费用(元)', Object.values(summary).reduce((a, b) => a + Object.values(b).reduce((c, d) => c + d.total_cost, 0), 0).toFixed(4)],
    [''],
    ['===== 按提供商-模型 ====='],
    ['提供商', '模型', 'Prompt Tokens', 'Completion Tokens', 'Total Tokens', '预计成本(元)']
  ]);

  Object.entries(summary).forEach(([prov, models]) => {
    Object.entries(models).forEach(([model, stat]) => {
      XLSX.utils.sheet_add_aoa(wsSummary, [[prov, model, stat.prompt_tokens, stat.completion_tokens, stat.total_tokens, stat.total_cost]], { origin: -1 });
    });
  });

  XLSX.utils.sheet_add_aoa(wsSummary, [[''], ['===== 按来源统计 ====='], ['来源类型', '来源名称', 'Prompt Tokens', 'Completion Tokens', 'Total Tokens', '预计成本(元)']], { origin: -1 });

  Object.values(summaryBySource).forEach(stat => {
    XLSX.utils.sheet_add_aoa(wsSummary, [[stat.type, stat.label, stat.prompt_tokens, stat.completion_tokens, stat.total_tokens, stat.total_cost]], { origin: -1 });
  });

  wsSummary['!cols'] = [{ wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, '费用汇总');

  const wsDetail = XLSX.utils.json_to_sheet(allRecords);
  wsDetail['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 12 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, wsDetail, '详细记录');

  const xlsxBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  const filename = `模型用量报表_${new Date().toISOString().slice(0, 10)}.xlsx`;

  try {
    const financeDir = path.join(deptReportRootDir, '财务部');
    if (!fs.existsSync(financeDir)) {
      fs.mkdirSync(financeDir, { recursive: true });
    }
    const filePath = path.join(financeDir, filename);
    fs.writeFileSync(filePath, xlsxBuffer);
    console.log('💾 已生成财务部报表文件:', filePath);
  } catch (e) {
    console.error('保存财务部报表失败:', e);
  }

  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`
  });
  res.end(xlsxBuffer);
}

// 静态文件服务
function serveStaticFile(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, '..', 'frontend', filePath);

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}

// 统一使用 8080 端口，方便前端和后端在同一端口下工作
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Serving frontend from: ${path.join(__dirname, '..', 'frontend')}`);
  // 初始化各部门报表文件夹
  initDeptReportDirs();
  console.log(`📂 部门报表根目录: ${deptReportRootDir}`);
});
