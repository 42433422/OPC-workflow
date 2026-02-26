const fetch = require('node-fetch');

async function testCozeAPI() {
  // 从环境变量读取扣子 API Token，避免在代码仓库中硬编码敏感信息
  const apiToken = process.env.COZE_API_TOKEN || '';
  const botId = process.env.COZE_BOT_ID || '7610814389452734470';
  
  const endpoints = [
    {
      name: 'v3 chat (official format)',
      url: 'https://api.coze.cn/v3/chat',
      body: {
        bot_id: botId,
        user_id: 'test_user',
        stream: false,
        auto_save_history: true,
        additional_messages: [
          {
            role: 'user',
            content: '请为我的品牌生成一份60秒春节促销视频脚本，包括画面分镜、旁白和字幕',
            content_type: 'text'
          }
        ]
      }
    },
    {
      name: 'Open API v2 chat',
      url: 'https://api.coze.cn/open_api/v2/chat',
      body: {
        bot_id: '17412557577151323224942443794345',
        user_id: 'test_user',
        messages: [
          {
            role: 'user',
            content: '生成一个春节促销视频脚本'
          }
        ],
        stream: false
      }
    },
    {
      name: 'v1 chat completions',
      url: 'https://api.coze.cn/v1/chat/completions',
      body: {
        model: 'coze',
        messages: [
          {
            role: 'user',
            content: '生成一个春节促销视频脚本'
          }
        ],
        stream: false,
        user_id: 'test_user'
      }
    },
    {
      name: 'v1 workflows run',
      url: 'https://api.coze.cn/v1/workflows/run',
      body: {
        workflow_id: '123456',
        user_id: 'test_user',
        query: '生成一个春节促销视频脚本',
        request_id: `req_${Date.now()}`
      }
    }
  ];
  
  try {
    if (!apiToken) {
      console.error('缺少环境变量 COZE_API_TOKEN，请先在本地环境中配置你的扣子 PAT。');
      return;
    }

    console.log('Testing Coze API with PAT token from env...');
    
    for (const endpoint of endpoints) {
      console.log(`\n=== Testing ${endpoint.name} ===`);
      console.log('URL:', endpoint.url);
      console.log('Request Body:', JSON.stringify(endpoint.body, null, 2));
      
      try {
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(endpoint.body)
        });
        
        console.log('Status:', response.status);
        console.log('Headers:', Object.fromEntries(response.headers));
        const data = await response.text();
        console.log('Response:', data);
      } catch (error) {
        console.error('Error:', error.message);
      }
    }
    
  } catch (error) {
    console.error('Test error:', error.message);
  }
}

testCozeAPI();