const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');
const XLSX = require('xlsx');
const nodeFetch = require('node-fetch');
const fetch = nodeFetch;
const { spawn } = require('child_process');

// 新模块导入
const { authMiddleware, verifyUser, createSession } = require('./middleware/auth');
const { validators, sanitizeObject } = require('./utils/validator');
const logger = require('./utils/logger');
const {
  loadEmployeeDb,
  saveEmployeeDb,
  loadDeptDb,
  saveDeptDb,
  loadCustomersDb,
  saveCustomersDb,
  loadVoiceProfiles,
  saveVoiceProfiles,
  createEmployeeFolder,
  initDeptReportDirs
} = require('./utils/db');

// 路由模块
const { handleChat } = require('./src/routes/ai-chat');
const { handleAssistant } = require('./src/routes/assistant');
const {
  handleUsageReport,
  handleUsageRecords,
  handleUsageReportDoc,
  handleUsageReportXlsx
} = require('./src/routes/reports');
const {
  handleGetEmployees,
  handleCreateEmployee,
  handleUpdateEmployee,
  handleDeleteEmployee
} = require('./routes/employees');

// 数据存储路径（简单文件数据库）
const dataDir = path.join(__dirname, 'data');
const employeeFile = path.join(dataDir, 'employees.json');
const deptFile = path.join(dataDir, 'departments.json');
const usageFile = path.join(dataDir, 'usage.json');
const deptReportRootDir = path.join(dataDir, 'dept-reports');
const voiceProfilesFile = path.join(dataDir, 'voices.json');
const customersFile = path.join(dataDir, 'customers.json');

// GPT-SoVITS 根目录（用于存放语音数据集和触发训练脚本）
// 默认按当前项目结构推断：backend 上一级目录下的 GPT-SoVITS-beta0706
const gptSoVitsRoot = path.join(__dirname, '..', 'GPT-SoVITS-beta0706');
const voiceDatasetRoot = path.join(gptSoVitsRoot, 'dataset');

// 确保数据目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
// 部门报表根目录
if (!fs.existsSync(deptReportRootDir)) {
  fs.mkdirSync(deptReportRootDir, { recursive: true });
}

// 员工文件夹根目录
const employeeFoldersDir = path.join(dataDir, 'employee-folders');
if (!fs.existsSync(employeeFoldersDir)) {
  fs.mkdirSync(employeeFoldersDir, { recursive: true });
}

// 语音数据集根目录（如果 GPT-SoVITS 存在，则准备好 dataset 目录）
if (fs.existsSync(gptSoVitsRoot)) {
  if (!fs.existsSync(voiceDatasetRoot)) {
    try {
      fs.mkdirSync(voiceDatasetRoot, { recursive: true });
    } catch (e) {
      console.error('创建语音数据集目录失败:', voiceDatasetRoot, e);
    }
  }
}



// 多实例 TTS 映射：按语言路由到不同的 GPT-SoVITS api.py 端口
const TTS_INSTANCES = {
  zh: 'http://127.0.0.1:9880',
  en: 'http://127.0.0.1:9881',
  ja: 'http://127.0.0.1:9880', // 暂时复用中文实例，后续可以单独开日文实例
};

// ===================== GPT-SoVITS TTS 自启动辅助 =====================
let gptTtsStarting = false;

// 确保 GPT-SoVITS 的 api.py 正在本机运行（如果没跑则尝试后台自启动）
function ensureGptTtsServer() {
  if (!fs.existsSync(gptSoVitsRoot)) {
    console.warn('未找到 GPT-SoVITS 根目录，无法自启动 api.py:', gptSoVitsRoot);
    return;
  }
  if (gptTtsStarting) {
    // 已经在拉起过程中，避免重复 spawn
    return;
  }
  gptTtsStarting = true;
  try {
    console.log('尝试自动启动 GPT-SoVITS TTS 服务: python api.py');
    const py = spawn('python', ['api.py'], {
      cwd: gptSoVitsRoot,
      stdio: 'ignore',
      detached: true
    });
    py.unref();
  } catch (e) {
    console.error('自动启动 GPT-SoVITS TTS 服务失败:', e);
  } finally {
    // 稍后再允许下一次检测
    setTimeout(() => {
      gptTtsStarting = false;
    }, 10000);
  }
}

// 触发 GPT-SoVITS 侧的异步预处理 / 训练流水线（如果脚本存在）
function triggerVoicePipeline(speakerId, lang) {
  try {
    if (!fs.existsSync(gptSoVitsRoot)) {
      console.warn('未找到 GPT-SoVITS 根目录，跳过自动训练触发:', gptSoVitsRoot);
      return;
    }
    const scriptPath = path.join(gptSoVitsRoot, 'auto_voice_train.py');
    if (!fs.existsSync(scriptPath)) {
      console.warn('未找到 auto_voice_train.py 脚本，只执行数据落地，不自动训练:', scriptPath);
      return;
    }
    const args = ['auto_voice_train.py', '--speaker', speakerId];
    if (lang) {
      args.push('--lang', lang);
    }
    const py = spawn('python', args, {
      cwd: gptSoVitsRoot,
      stdio: 'ignore',
      detached: true
    });
    py.unref();
    console.log(`已异步触发声音流水线: speaker=${speakerId}, lang=${lang || 'unknown'}`);
  } catch (e) {
    console.error('触发声音流水线失败:', e);
  }
}

// 登录处理函数
function handleLogin(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { username, password } = JSON.parse(body);
      const user = verifyUser(username, password);
      
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '用户名或密码错误' }));
        logger.warn('登录失败', { username, ip: req.connection.remoteAddress });
        return;
      }
      
      const token = createSession(user);
      logger.info('登录成功', { username, userId: user.id });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role
        }
      }));
    } catch (e) {
      logger.error('登录处理错误', { error: e.message });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '无效的请求数据' }));
    }
  });
}

// 健康检查
function handleHealth(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  }));
}

// 简单的路由处理
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 请求日志
  logger.requestLogger(req, res, () => {});

  // 公开路由（不需要认证）
  if (pathname === '/api/login' && method === 'POST') {
    return handleLogin(req, res);
  }

  if (pathname === '/api/health' && method === 'GET') {
    return handleHealth(req, res);
  }

  // 认证中间件（除了公开路由）
  const isPublicRoute = pathname === '/api/login' || pathname === '/api/health';
  if (!isPublicRoute && pathname.startsWith('/api/')) {
    const authResult = await new Promise((resolve) => {
      authMiddleware(req, res, () => resolve(true));
    });
    if (!authResult) return;
  }

  // API 路由
  if (pathname === '/api/chat' && method === 'POST') {
    await handleChat(req, res);
    return;
  }

  if (pathname === '/api/assistant' && method === 'POST') {
    await handleAssistant(req, res);
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

  // 声音模型 / 语音数据集 API
  if (pathname === '/api/tts' && method === 'POST') {
    return handleTts(req, res);
  }

  if (pathname === '/api/voices' && method === 'GET') {
    return handleGetVoices(req, res);
  }

  if (pathname === '/api/voice-dataset' && method === 'POST') {
    return handleUploadVoiceDataset(req, res);
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

  // 客户数据库 API
  if (pathname === '/api/customers' && method === 'GET') {
    return handleGetCustomers(req, res);
  }

  if (pathname === '/api/customers' && method === 'POST') {
    return handleCreateCustomer(req, res);
  }

  if (pathname.startsWith('/api/customers/') && (method === 'GET' || method === 'PUT' || method === 'DELETE')) {
    const idStr = pathname.replace('/api/customers/', '');
    const id = parseInt(idStr, 10);
    if (!Number.isInteger(id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid customer id' }));
      return;
    }
    if (method === 'GET') {
      return handleGetCustomerById(req, res, id);
    }
    if (method === 'PUT') {
      return handleUpdateCustomer(req, res, id);
    }
    if (method === 'DELETE') {
      return handleDeleteCustomer(req, res, id);
    }
  }

  // 静态文件服务
  serveStaticFile(req, res, pathname);
});

const { ok, error } = require('./src/utils/response');

// 注意：handleGetEmployees 已移至 routes/employees.js

// 声音模型列表
function handleGetVoices(req, res) {
  const db = loadVoiceProfiles();
  return ok(res, db.voices || [], '获取声音模型列表成功');
}

// 文本转语音（调用 GPT-SoVITS 提供的 api.py HTTP 接口）
async function handleTts(req, res) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}');
      const text = (payload.text || '').trim();
      const lang = (payload.lang || 'zh').toLowerCase();
      const speakerId = payload.speakerId ? String(payload.speakerId).trim() : '';

      if (!text) {
        return error(res, 400, 'TEXT_REQUIRED', 'text 为必填');
      }

      // 如果有指定说话人，并且在 voices.json 中有对应记录，则优先走"直接权重调用"路径
      if (speakerId) {
        const vdb = loadVoiceProfiles();
        const voices = vdb.voices || [];
        const voice = voices.find((v) => v.speakerId === speakerId);

        if (voice && voice.sovitsPath && voice.gptPath && Array.isArray(voice.lastUploadFiles) && voice.lastUploadFiles.length > 0) {
          try {
            const sovitsPath = path.isAbsolute(voice.sovitsPath)
              ? voice.sovitsPath
              : path.join(gptSoVitsRoot, voice.sovitsPath);
            const gptPath = path.isAbsolute(voice.gptPath)
              ? voice.gptPath
              : path.join(gptSoVitsRoot, voice.gptPath);
            const refRel = voice.lastUploadFiles[0];
            const refWavPath = path.isAbsolute(refRel)
              ? refRel
              : path.join(gptSoVitsRoot, refRel);

            const ttsScript = path.join(gptSoVitsRoot, 'tts_once.py');
            if (!fs.existsSync(ttsScript)) {
              console.warn('未找到 tts_once.py 脚本，回退到 HTTP TTS:', ttsScript);
            } else {
              const args = [
                ttsScript,
                '--gpt_path',
                gptPath,
                '--sovits_path',
                sovitsPath,
                '--ref_wav',
                refWavPath,
                '--lang',
                lang || voice.lang || 'zh',
                '--text',
                text,
              ];
              const py = spawn('python', args, {
                cwd: gptSoVitsRoot,
                stdio: ['ignore', 'pipe', 'pipe'],
              });

              let stdout = '';
              let stderr = '';
              py.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
              });
              py.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
              });

              py.on('close', (code) => {
                if (code !== 0 || !stdout.trim()) {
                  console.error('tts_once.py 失败:', code, stderr);
                  return error(res, 500, 'TTS_FAILED', 'tts_once.py 调用失败，请检查后端日志。', { detail: stderr });
                }

                const base64 = stdout.trim();
                return ok(res, {
                  audioBase64: `data:audio/wav;base64,${base64}`,
                  lang: lang || voice.lang || 'zh',
                  speakerId,
                  mode: voice.mode || 'zero-shot',
                }, 'TTS 成功');
              });

              return;
            }
          } catch (e) {
            console.error('基于 speakerId 的直接 TTS 调用失败，回退 HTTP 模式:', e);
          }
        }
      }

      // HTTP 模式：GPT-SoVITS api.py 多实例（按语言路由端口）
      const textLanguage =
        lang === 'en' ? 'en' : lang === 'ja' ? 'ja' : lang === 'auto' ? 'auto' : 'zh';
      const ttsUrl = TTS_INSTANCES[textLanguage] || TTS_INSTANCES.zh || 'http://127.0.0.1:9880';

      const callUpstream = () =>
        fetch(ttsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            text_language: textLanguage
          })
        });

      let upstream;
      try {
        upstream = await callUpstream();
      } catch (e) {
        console.warn('首次调用 GPT-SoVITS TTS 失败，尝试自动启动 api.py 后重试:', e.message || e);
        ensureGptTtsServer();
        await new Promise((resolve) => setTimeout(resolve, 4000));
        try {
          upstream = await callUpstream();
        } catch (e2) {
          console.error('二次调用 GPT-SoVITS TTS 仍然失败:', e2);
          return error(res, 502, 'TTS_UNAVAILABLE', '无法连接到 GPT-SoVITS TTS 服务，已尝试自动启动 api.py，请稍后重试或检查本机环境。');
        }
      }

      if (!upstream.ok) {
        let errDetail = '';
        try {
          const errJson = await upstream.json();
          errDetail = errJson && errJson.error ? String(errJson.error) : '';
        } catch {
          errDetail = '';
        }
        console.error('GPT-SoVITS TTS 返回非 200:', upstream.status, errDetail);
        return error(res, 500, 'TTS_ERROR', 'GPT-SoVITS TTS 推理失败', { status: upstream.status, detail: errDetail });
      }

      const buf = await upstream.buffer();
      const base64 = buf.toString('base64');

      return ok(res, {
        audioBase64: `data:audio/wav;base64,${base64}`,
        lang: textLanguage
      }, 'TTS 成功');
    } catch (e) {
      console.error('处理 /api/tts 请求失败:', e);
      return error(res, 400, 'INVALID_BODY', 'Invalid JSON body');
    }
  });
}

// 上传语音数据集
function handleUploadVoiceDataset(req, res) {
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const speakerId = (payload.speakerId || '').trim();
      const displayName = (payload.displayName || '').trim();
      const lang = (payload.lang || 'zh').toLowerCase();
      const ownerType = payload.ownerType || 'custom';
      const ownerId = payload.ownerId || null;
      const files = Array.isArray(payload.files) ? payload.files : [];

      if (!speakerId) {
        return error(res, 400, 'MISSING_SPEAKER_ID', 'speakerId 为必填');
      }
      if (!displayName) {
        return error(res, 400, 'MISSING_DISPLAY_NAME', 'displayName 为必填');
      }
      if (files.length === 0) {
        return error(res, 400, 'MISSING_FILES', 'files 数组不能为空');
      }

      // 保存上传的文件到 dataset 目录
      const speakerDir = path.join(voiceDatasetRoot, speakerId);
      if (!fs.existsSync(speakerDir)) {
        fs.mkdirSync(speakerDir, { recursive: true });
      }

      const savedFiles = [];
      for (const file of files) {
        if (!file.filename || !file.dataBase64) continue;
        const filePath = path.join(speakerDir, file.filename);
        const buffer = Buffer.from(file.dataBase64, 'base64');
        fs.writeFileSync(filePath, buffer);
        savedFiles.push(filePath);
      }

      // 更新 voices.json
      const vdb = loadVoiceProfiles();
      const existingIndex = vdb.voices.findIndex((v) => v.speakerId === speakerId);
      const voiceEntry = {
        speakerId,
        displayName,
        lang,
        ownerType,
        ownerId,
        lastUploadFiles: savedFiles,
        updatedAt: new Date().toISOString()
      };

      if (existingIndex >= 0) {
        vdb.voices[existingIndex] = { ...vdb.voices[existingIndex], ...voiceEntry };
      } else {
        vdb.voices.push(voiceEntry);
      }
      saveVoiceProfiles(vdb);

      // 异步触发训练流水线
      triggerVoicePipeline(speakerId, lang);

      return ok(res, { speakerId, savedFiles: savedFiles.length }, '语音数据集上传成功，已触发自动训练');
    } catch (e) {
      console.error('处理 /api/voice-dataset 失败:', e);
      return error(res, 400, 'INVALID_BODY', 'Invalid JSON body');
    }
  });
}

// 注意：员工相关处理函数已移至 routes/employees.js

// 部门列表
function handleGetDepts(req, res) {
  const db = loadDeptDb();
  return ok(res, db.departments || [], '获取部门列表成功');
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
        note: payload.note || ''
      };

      db.departments.push(dept);
      saveDeptDb(db);

      // 创建部门报表文件夹
      const dir = path.join(deptReportRootDir, dept.name);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      return ok(res, dept, '创建部门成功', 201);
    } catch (e) {
      console.error('Create department error:', e);
      return error(res, 400, 'INVALID_BODY', 'Invalid JSON body');
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
        return error(res, 404, 'DEPT_NOT_FOUND', 'Department not found');
      }

      const old = db.departments[idx];
      const oldName = old.name;
      const updated = {
        ...old,
        name: payload.name !== undefined ? payload.name : old.name,
        code: payload.code !== undefined ? payload.code : old.code,
        note: payload.note !== undefined ? payload.note : old.note
      };

      db.departments[idx] = updated;
      saveDeptDb(db);

      // 如果部门名称变更，重命名报表文件夹
      if (oldName && updated.name && oldName !== updated.name) {
        const oldDir = path.join(deptReportRootDir, oldName);
        const newDir = path.join(deptReportRootDir, updated.name);
        if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
          fs.renameSync(oldDir, newDir);
        }
      }

      return ok(res, updated, '更新部门成功');
    } catch (e) {
      console.error('Update department error:', e);
      return error(res, 400, 'INVALID_BODY', 'Invalid JSON body');
    }
  });
}

// 删除部门
function handleDeleteDept(req, res, id) {
  const db = loadDeptDb();
  const idx = db.departments.findIndex(d => d.id === id);
  if (idx === -1) {
    return error(res, 404, 'DEPT_NOT_FOUND', 'Department not found');
  }

  const removed = db.departments.splice(idx, 1)[0];
  saveDeptDb(db);

  return ok(res, removed, '删除部门成功');
}

// 客户列表
function handleGetCustomers(req, res) {
  const db = loadCustomersDb();
  return ok(res, db.customers || [], '获取客户列表成功');
}

// 获取单个客户
function handleGetCustomerById(req, res, id) {
  const db = loadCustomersDb();
  const customer = db.customers.find(c => c.id === id);
  if (!customer) {
    return error(res, 404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
  }
  return ok(res, customer, '获取客户成功');
}

// 创建客户
function handleCreateCustomer(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const db = loadCustomersDb();

      const customer = {
        id: db.nextId++,
        name: payload.name || '',
        contact: payload.contact || '',
        phone: payload.phone || '',
        email: payload.email || '',
        address: payload.address || '',
        note: payload.note || '',
        createdAt: new Date().toISOString()
      };

      db.customers.push(customer);
      saveCustomersDb(db);

      return ok(res, customer, '创建客户成功', 201);
    } catch (e) {
      console.error('Create customer error:', e);
      return error(res, 400, 'INVALID_BODY', 'Invalid JSON body');
    }
  });
}

// 更新客户
function handleUpdateCustomer(req, res, id) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const payload = JSON.parse(body || '{}');
      const db = loadCustomersDb();
      const idx = db.customers.findIndex(c => c.id === id);
      if (idx === -1) {
        return error(res, 404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
      }

      const old = db.customers[idx];
      const updated = {
        ...old,
        name: payload.name !== undefined ? payload.name : old.name,
        contact: payload.contact !== undefined ? payload.contact : old.contact,
        phone: payload.phone !== undefined ? payload.phone : old.phone,
        email: payload.email !== undefined ? payload.email : old.email,
        address: payload.address !== undefined ? payload.address : old.address,
        note: payload.note !== undefined ? payload.note : old.note
      };

      db.customers[idx] = updated;
      saveCustomersDb(db);

      return ok(res, updated, '更新客户成功');
    } catch (e) {
      console.error('Update customer error:', e);
      return error(res, 400, 'INVALID_BODY', 'Invalid JSON body');
    }
  });
}

// 删除客户
function handleDeleteCustomer(req, res, id) {
  const db = loadCustomersDb();
  const idx = db.customers.findIndex(c => c.id === id);
  if (idx === -1) {
    return error(res, 404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
  }

  const deletedCustomer = db.customers.splice(idx, 1)[0];
  saveCustomersDb(db);

  return ok(res, { deleted: deletedCustomer }, '删除客户成功');
}

// 静态文件服务
function serveStaticFile(req, res, pathname) {
  // 安全处理路径
  const safePath = pathname.replace(/\.{2,}/g, '');
  let filePath = path.join(__dirname, '..', 'frontend', safePath);

  // 默认首页
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(__dirname, '..', 'frontend', 'index.html');
  }

  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  // 获取文件扩展名并设置 Content-Type
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  // 读取并返回文件
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// Coze 工作流处理
async function handleCozeWorkflow(req, res) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}');
      const { topic, workflow_id } = payload;

      if (!topic) {
        return error(res, 400, 'TOPIC_REQUIRED', '缺少必要参数: topic');
      }

      const COZE_API_TOKEN = process.env.COZE_API_TOKEN;
      const COZE_WORKFLOW_ID = workflow_id || process.env.COZE_WORKFLOW_ID || 'video-script-generator-001';

      if (!COZE_API_TOKEN) {
        logger.error('Coze API Token 未配置');
        return error(res, 500, 'TOKEN_NOT_CONFIGURED', 'Coze API Token 未配置，请设置环境变量 COZE_API_TOKEN');
      }

      logger.info('调用 Coze 工作流', { workflow_id: COZE_WORKFLOW_ID, topic: topic.substring(0, 50) });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      try {
        // 首先尝试 Workflow API
        const workflowRequestBody = {
          workflow_id: COZE_WORKFLOW_ID,
          parameters: { topic },
          user_id: 'user_' + Date.now(),
          request_id: `req_${Date.now()}`
        };
        
        logger.info('Coze Workflow API 请求', { url: 'https://api.coze.cn/v1/workflows/run', body: workflowRequestBody });
        
        let response = await fetch('https://api.coze.cn/v1/workflows/run', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${COZE_API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(workflowRequestBody),
          signal: controller.signal
        });

        // 如果 Workflow API 返回 500，尝试 Bot Chat API
        if (response.status === 500) {
          logger.info('Workflow API 返回 500，尝试 Bot Chat API');
          
          const chatRequestBody = {
            bot_id: COZE_WORKFLOW_ID,
            user_id: 'user_' + Date.now(),
            stream: false,
            auto_save_history: true,
            additional_messages: [
              {
                role: 'user',
                content: topic,
                content_type: 'text'
              }
            ]
          };
          
          logger.info('Coze Bot Chat API 请求', { url: 'https://api.coze.cn/v3/chat', body: { ...chatRequestBody, additional_messages: [{ role: 'user', content: topic.substring(0, 30) + '...' }] } });
          
          response = await fetch('https://api.coze.cn/v3/chat', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${COZE_API_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(chatRequestBody),
            signal: controller.signal
          });
        }

        clearTimeout(timeout);

        if (!response.ok) {
          const errorText = await response.text();
          logger.error('Coze API 返回错误', { status: response.status, error: errorText });
          return error(res, response.status, 'COZE_API_ERROR', `Coze API 错误: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        logger.info('Coze API 调用成功', { workflow_id: COZE_WORKFLOW_ID });

        // 处理不同 API 的响应格式
        let scriptContent;
        if (data.data?.output) {
          scriptContent = data.data.output;
        } else if (data.output) {
          scriptContent = data.output;
        } else if (data.result) {
          scriptContent = data.result;
        } else if (data.messages && data.messages.length > 0) {
          // Bot Chat API 响应格式
          scriptContent = data.messages[data.messages.length - 1].content;
        } else {
          scriptContent = data;
        }

        return ok(res, {
          script_content: scriptContent,
          raw_response: data
        }, '视频脚本生成成功');

      } catch (fetchError) {
        clearTimeout(timeout);
        if (fetchError.name === 'AbortError') {
          logger.error('Coze API 调用超时');
          return error(res, 504, 'TIMEOUT', 'Coze API 调用超时，请稍后重试');
        }
        throw fetchError;
      }

    } catch (err) {
      logger.error('Coze 工作流处理失败', { error: err.message, stack: err.stack });
      return error(res, 500, 'WORKFLOW_ERROR', '工作流处理失败: ' + err.message);
    }
  });
}

// 获取模型列表
function handleGetModels(req, res) {
  const models = [
    { provider: 'qwen', name: '通义千问', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'] },
    { provider: 'deepseek', name: 'DeepSeek', models: ['deepseek-chat', 'deepseek-coder'] },
    { provider: 'moonshot', name: 'Kimi', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
    { provider: 'zhipu', name: '智谱', models: ['glm-4', 'glm-4-flash'] },
    { provider: 'openai', name: 'OpenAI', models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
    { provider: 'grok', name: 'Grok', models: ['grok-1'] },
    { provider: 'gemini', name: 'Gemini', models: ['gemini-pro', 'gemini-pro-vision'] }
  ];
  return ok(res, models, '获取模型列表成功');
}

// 统一使用 8080 端口，方便前端和后端在同一端口下工作
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  logger.info('服务器启动成功', {
    port: PORT,
    url: `http://localhost:${PORT}`,
    env: process.env.NODE_ENV || 'development'
  });
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Serving frontend from: ${path.join(__dirname, '..', 'frontend')}`);
  console.log(`🔐 默认登录账号: admin / admin123`);
  // 初始化各部门报表文件夹
  initDeptReportDirs();
  console.log(`📂 部门报表根目录: ${deptReportRootDir}`);
});
