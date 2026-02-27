const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { getAllUsageRecordsFromSqlite, deptReportRootDir } = require('../utils/sqlite');
const { TOKEN_PRICING } = require('../services/ai-service');
const { ok } = require('../utils/response');

function handleUsageReport(req, res) {
  const records = getAllUsageRecordsFromSqlite();
  const summary = {};
  const summaryBySource = {};

  records.forEach(rec => {
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

  return ok(res, { summary, summaryBySource }, '获取用量报表成功');
}

function handleUsageRecords(req, res) {
  const records = getAllUsageRecordsFromSqlite();
  return ok(res, records || [], '获取用量记录成功');
}

function buildUsageReportRtf(summary, summaryBySource) {
  let rtf = '{\\rtf1\\ansi\\deff0\n';
  rtf += '{\\b 模型用量与费用报表}\\par\n';
  rtf += `生成时间：${new Date().toLocaleString()}\\par\\par\n`;

  Object.entries(summary).forEach(([prov, models]) => {
    rtf += `{\\b 提供商：}${prov} \\par\n`;
    rtf += '模型\tPrompt Tokens\tCompletion Tokens\tTotal Tokens\t预计成本(元)\\par\n';
    Object.entries(models).forEach(([model, stat]) => {
      rtf += `${model}\t${stat.prompt_tokens || 0}\t${stat.completion_tokens || 0}\t${stat.total_tokens || 0}\t${(stat.total_cost || 0).toFixed(4)}\\par\n`;
    });
    rtf += '\\par\n';
  });

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

function handleUsageReportDoc(req, res) {
  const records = getAllUsageRecordsFromSqlite();
  const summary = {};
  const summaryBySource = {};

  records.forEach(rec => {
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

function handleUsageReportXlsx(req, res) {
  const records = getAllUsageRecordsFromSqlite();
  const summary = {};
  const summaryBySource = {};
  const allRecords = [];

  records.forEach(rec => {
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
    ['总调用次数', records.length],
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

module.exports = {
  handleUsageReport,
  handleUsageRecords,
  handleUsageReportDoc,
  handleUsageReportXlsx
};


