const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const usersFile = path.join(dataDir, 'users.json');
const sessionsFile = path.join(dataDir, 'sessions.json');

// 确保数据目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 读取用户数据库
function loadUsersDb() {
  if (!fs.existsSync(usersFile)) {
    // 创建默认管理员账号
    const defaultUsers = {
      users: [
        {
          id: 1,
          username: 'admin',
          passwordHash: hashPassword('admin123'),
          role: 'admin',
          name: '系统管理员',
          createdAt: new Date().toISOString()
        }
      ]
    };
    saveUsersDb(defaultUsers);
    console.log('✅ 已创建默认管理员账号: admin / admin123');
    return defaultUsers;
  }
  try {
    const raw = fs.readFileSync(usersFile, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('读取用户数据库失败:', e);
    return { users: [] };
  }
}

function saveUsersDb(db) {
  fs.writeFileSync(usersFile, JSON.stringify(db, null, 2), 'utf-8');
}

// 读取会话数据库
function loadSessionsDb() {
  if (!fs.existsSync(sessionsFile)) {
    return { sessions: [] };
  }
  try {
    const raw = fs.readFileSync(sessionsFile, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return { sessions: [] };
  }
}

function saveSessionsDb(db) {
  fs.writeFileSync(sessionsFile, JSON.stringify(db, null, 2), 'utf-8');
}

// 密码哈希
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// 生成会话令牌
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 验证用户
function verifyUser(username, password) {
  const db = loadUsersDb();
  const user = db.users.find(u => u.username === username);
  if (!user) return null;
  
  const passwordHash = hashPassword(password);
  if (user.passwordHash !== passwordHash) return null;
  
  return { id: user.id, username: user.username, role: user.role, name: user.name };
}

// 创建会话
function createSession(user) {
  const db = loadSessionsDb();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24小时
  
  db.sessions.push({
    token,
    userId: user.id,
    username: user.username,
    role: user.role,
    createdAt: new Date().toISOString(),
    expiresAt
  });
  
  // 清理过期会话
  db.sessions = db.sessions.filter(s => new Date(s.expiresAt) > new Date());
  
  saveSessionsDb(db);
  return token;
}

// 验证令牌
function verifyToken(token) {
  if (!token) return null;
  
  const db = loadSessionsDb();
  const session = db.sessions.find(s => s.token === token);
  
  if (!session) return null;
  if (new Date(session.expiresAt) <= new Date()) return null;
  
  return {
    userId: session.userId,
    username: session.username,
    role: session.role
  };
}

// 认证中间件
function authMiddleware(req, res, next) {
  // 公开路由白名单
  const publicPaths = ['/api/login', '/api/register', '/api/public'];
  if (publicPaths.some(path => req.url.startsWith(path))) {
    return next();
  }
  
  // 静态文件不需要认证（开发阶段）
  if (!req.url.startsWith('/api/')) {
    return next();
  }
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '未提供认证令牌' }));
    return;
  }
  
  const token = authHeader.substring(7);
  const user = verifyToken(token);
  
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '认证令牌无效或已过期' }));
    return;
  }
  
  req.user = user;
  next();
}

// 角色检查中间件
function requireRole(roles) {
  return function(req, res, next) {
    if (!req.user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '未认证' }));
      return;
    }
    
    if (!roles.includes(req.user.role)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '权限不足' }));
      return;
    }
    
    next();
  };
}

module.exports = {
  verifyUser,
  createSession,
  verifyToken,
  authMiddleware,
  requireRole,
  hashPassword,
  loadUsersDb,
  saveUsersDb
};
