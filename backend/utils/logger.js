const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', '..', 'logs');

// 确保日志目录存在
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// 日志级别
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// 当前日志级别（从环境变量读取，默认 INFO）
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

// 获取当前日期字符串
function getDateString() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// 获取当前时间字符串
function getTimeString() {
  return new Date().toISOString();
}

// 写入日志文件
function writeToFile(level, message, meta = {}) {
  const dateStr = getDateString();
  const logFile = path.join(logsDir, `${dateStr}.log`);
  
  const logEntry = {
    timestamp: getTimeString(),
    level,
    message,
    ...meta
  };
  
  const logLine = JSON.stringify(logEntry) + '\n';
  
  fs.appendFile(logFile, logLine, (err) => {
    if (err) {
      console.error('写入日志失败:', err);
    }
  });
}

// 控制台输出（带颜色）
const COLORS = {
  ERROR: '\x1b[31m', // 红色
  WARN: '\x1b[33m',  // 黄色
  INFO: '\x1b[36m',  // 青色
  DEBUG: '\x1b[35m', // 紫色
  RESET: '\x1b[0m'
};

function consoleOutput(level, message, meta = {}) {
  const color = COLORS[level] || COLORS.RESET;
  const timestamp = getTimeString();
  const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta) : '';
  
  console.log(`${color}[${timestamp}] [${level}] ${message}${metaStr ? ' ' + metaStr : ''}${COLORS.RESET}`);
}

// 主日志函数
function log(level, message, meta = {}) {
  const levelValue = LOG_LEVELS[level];
  
  if (levelValue === undefined) {
    console.error(`未知日志级别: ${level}`);
    return;
  }
  
  // 只记录当前级别及以上的日志
  if (levelValue <= CURRENT_LEVEL) {
    writeToFile(level, message, meta);
    consoleOutput(level, message, meta);
  }
}

// 便捷方法
const logger = {
  error(message, meta) {
    log('ERROR', message, meta);
  },
  
  warn(message, meta) {
    log('WARN', message, meta);
  },
  
  info(message, meta) {
    log('INFO', message, meta);
  },
  
  debug(message, meta) {
    log('DEBUG', message, meta);
  },
  
  // 请求日志中间件
  requestLogger(req, res, next) {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('HTTP Request', {
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        userAgent: req.headers['user-agent']?.substring(0, 100)
      });
    });
    
    next();
  },
  
  // 错误日志
  errorLogger(err, req, res, next) {
    logger.error('Unhandled Error', {
      message: err.message,
      stack: err.stack?.substring(0, 500),
      url: req.url,
      method: req.method
    });
    next(err);
  }
};

module.exports = logger;
