const fetch = require('node-fetch');

async function testCozeAPI() {
  const apiToken = 'pat_mYMjlfMFusAXD1HMxO38JRoqNDnp60XIa8lsrhuCdzzn2j6f4W0Lr5EHDblsWbmL';
  const botId = '17412557577151323224942443794345';
  
  try {
    console.log('Testing Coze API...');
    
    // 测试1: Open API v2 chat endpoint
    console.log('\n1. Testing Open API v2 chat endpoint:');
    const url1 = 'https://api.coze.cn/open_api/v2/chat';
    const body1 = {
      bot_id: botId,
      user_id: 'test_user',
      messages: [
        {
          role: 'user',
          content: '生成一个春节促销视频脚本'
        }
      ],
      stream: false
    };
    
    const response1 = await fetch(url1, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body1)
    });
    
    console.log('Status:', response1.status);
    const data1 = await response1.text();
    console.log('Response:', data1);
    
    // 测试2: Chat completions endpoint
    console.log('\n2. Testing Chat completions endpoint:');
    const url2 = 'https://api.coze.cn/v1/chat/completions';
    const body2 = {
      model: 'coze',
      messages: [
        {
          role: 'user',
          content: '生成一个春节促销视频脚本'
        }
      ],
      stream: false,
      user_id: 'test_user'
    };
    
    const response2 = await fetch(url2, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body2)
    });
    
    console.log('Status:', response2.status);
    const data2 = await response2.text();
    console.log('Response:', data2);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testCozeAPI();