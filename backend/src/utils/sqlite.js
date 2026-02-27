const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { logger } = require('./logger');

const dataDir = path.join(__dirname, '..', '..', 'data');
const usageFile = path.join(dataDir, 'usage.json');
const deptReportRootDir = path.join(dataDir, 'dept-reports');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(deptReportRootDir)) {
  fs.mkdirSync(deptReportRootDir, { recursive: true });
}

const sqlitePath = path.join(dataDir, 'app.db');
const sqliteDb = new Database(sqlitePath);

// 基础表结构
sqliteDb
  .prepare(
    `CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      source_type TEXT,
      source_label TEXT,
      source_raw TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0
    )`
  )
  .run();

// 关键字段索引，提升按时间/提供商/模型/来源查询和排序性能
sqliteDb.prepare('CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_records(time)').run();
sqliteDb.prepare('CREATE INDEX IF NOT EXISTS idx_usage_provider_model ON usage_records(provider, model)').run();
sqliteDb.prepare('CREATE INDEX IF NOT EXISTS idx_usage_source_type_label ON usage_records(source_type, source_label)').run();

function migrateUsageJsonToSqliteOnce() {
  try {
    const row = sqliteDb.prepare('SELECT COUNT(1) AS count FROM usage_records').get();
    const hasAny = row && row.count > 0;
    if (hasAny || !fs.existsSync(usageFile)) {
      return;
    }

    const raw = fs.readFileSync(usageFile, 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    const records = Array.isArray(parsed.records) ? parsed.records : [];
    if (!records.length) return;

    const insert = sqliteDb.prepare(
      `INSERT INTO usage_records
       (time, provider, model, source_type, source_label, source_raw,
        prompt_tokens, completion_tokens, total_tokens)
       VALUES (@time, @provider, @model, @source_type, @source_label, @source_raw,
               @prompt_tokens, @completion_tokens, @total_tokens)`
    );
    const insertMany = sqliteDb.transaction((rows) => {
      rows.forEach((r) => insert.run(r));
    });

    const mapped = records.map((rec) => {
      const provider = rec.provider || 'unknown';
      const model = rec.model || 'unknown';
      const usage = rec.usage || {};
      const prompt = usage.prompt_tokens || usage.input_tokens || 0;
      const completion = usage.completion_tokens || usage.output_tokens || 0;
      const total = usage.total_tokens || prompt + completion;

      const src = rec.source || {};
      let source_type = null;
      let source_label = null;
      if (typeof src === 'string') {
        source_type = 'raw';
        source_label = src;
      } else if (src && typeof src === 'object') {
        source_type = src.type || null;
        source_label =
          source_type === 'employee'
            ? src.employeeName || `员工#${src.employeeId || '-'}`
            : source_type === 'department'
              ? src.deptName || '某部门'
              : source_type === 'project'
                ? src.projectName || '某项目'
                : source_type === 'assistant'
                  ? '小碟助手'
                  : source_type === 'global-assistant'
                    ? '顶部 AI 助手'
                    : null;
      }

      return {
        time: rec.time || new Date().toISOString(),
        provider,
        model,
        source_type,
        source_label,
        source_raw: JSON.stringify(rec.source || null),
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total
      };
    });

    insertMany(mapped);
    logger.info('已将旧的 usage.json 记录迁移到 SQLite(app.db)', {
      count: mapped.length
    });
  } catch (e) {
    logger.error('迁移 usage.json 到 SQLite 失败', { error: e });
  }
}

migrateUsageJsonToSqliteOnce();

function getAllUsageRecordsFromSqlite() {
  const rows = sqliteDb
    .prepare(
      `SELECT id, time, provider, model, source_type, source_label, source_raw,
              prompt_tokens, completion_tokens, total_tokens
       FROM usage_records
       ORDER BY time ASC, id ASC`
    )
    .all();

  return rows.map((row) => {
    let source = null;
    if (row.source_raw) {
      try {
        source = JSON.parse(row.source_raw);
      } catch {
        source = row.source_label || null;
      }
    } else if (row.source_label) {
      source = row.source_label;
    }
    return {
      time: row.time,
      provider: row.provider,
      model: row.model,
      source,
      usage: {
        prompt_tokens: row.prompt_tokens || 0,
        completion_tokens: row.completion_tokens || 0,
        total_tokens: row.total_tokens || 0
      }
    };
  });
}

module.exports = {
  sqliteDb,
  getAllUsageRecordsFromSqlite,
  deptReportRootDir,
  dataDir
};


