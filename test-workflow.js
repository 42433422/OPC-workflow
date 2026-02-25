const fetch = require('node-fetch');

async function runWorkflow() {
  // 从环境变量读取扣子 API 令牌，避免把密钥写死在代码里
  // 官方示例通常使用 COZE_API_TOKEN 作为环境变量名
  const token = process.env.COZE_API_TOKEN;
  if (!token) {
    console.error('缺少 COZE_API_TOKEN 环境变量，请先在系统/终端里配置新的 API token。');
    return;
  }
  // 使用工作流专属域名，不再直接调用通用 /v1/workflows/run
  const url = 'https://cz5k6mzkgq.coze.site/run';

  const body = {
    // 这里的字段名需要和工作流输入变量一致；根据 Coze 页面 curl 示例，这里使用 topic
    topic: '春节促销活动视频脚本'
  };

  try {
    console.log('Calling workflow: video-script-generator-001');
    console.log('Request body:', JSON.stringify(body, null, 2));

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    console.log('Status:', resp.status);
    const text = await resp.text();
    console.log('Response:', text);
  } catch (err) {
    console.error('Workflow call error:', err);
  }
}

runWorkflow();


