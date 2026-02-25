/**
 * 碟片助手 - Disc Assistant
 * 一个圆形碟片风格的智能助手，支持语音唤醒和交互
 */

class DiscAssistant {
  constructor(options = {}) {
    // 配置
    this.config = {
      wakeWords: ['小碟小碟', 'hey 小碟', '小碟'],
      name: '小碟',
      voiceEnabled: true,
      // 默认展示右下角“小碟”小圆点（休眠状态），不弹出大面板和遮罩
      autoStart: true,
      ...options
    };

    // 状态管理
    this.state = 'sleeping'; // sleeping, awake, listening, processing
    this.recognition = null;
    this.synthesis = window.speechSynthesis;
    this.messages = [];
    this.isVoiceMode = false;

    // 简单声音引擎（提示音），使用 Web Audio 生成，不需要额外音频文件
    this.audioCtx = null;

    // DOM 元素
    this.elements = {};

    // 初始化
    this.init();
  }

  init() {
    this.createDOM();
    this.bindEvents();
    // 不再自动启动语音识别，等待唤醒后再说

    // DOM 创建完成后根据配置决定是否显示入口
    const assistant = document.getElementById('disc-assistant');
    if (assistant) {
      if (this.config.autoStart) {
        assistant.classList.remove('hidden');
      } else {
        assistant.classList.add('hidden');
      }
    }

    console.log(`[${this.config.name}] 碟片助手已初始化`);
  }

  // ========== DOM 创建 ==========
  createDOM() {
    // 检查是否已存在
    if (document.getElementById('disc-assistant')) {
      return;
    }

    // 主容器
    const assistant = document.createElement('div');
    assistant.id = 'disc-assistant';
    assistant.className = 'disc-assistant sleeping';

    // 碟片结构
    assistant.innerHTML = `
      <div class="disc-mini" id="disc-mini"></div>
      <div class="disc-container" id="disc-container" style="display: none;">
        <div class="disc-outer-ring"></div>
        <div class="disc-spinning-ring"></div>
        <div class="disc-inner-ring">
          <div class="disc-core"></div>
        </div>
        <div class="disc-sound-waves" id="disc-sound-waves" style="display: none;">
          <div class="wave"></div>
          <div class="wave"></div>
          <div class="wave"></div>
        </div>
      </div>
    `;

    document.body.appendChild(assistant);

    // 遮罩层
    const overlay = document.createElement('div');
    overlay.id = 'disc-overlay';
    overlay.className = 'disc-overlay hidden';
    document.body.appendChild(overlay);

    // 语音提示
    const voiceHint = document.createElement('div');
    voiceHint.id = 'disc-voice-hint';
    voiceHint.className = 'disc-voice-hint hidden';
    // 默认是唤醒提示，而不是“正在聆听”
    voiceHint.textContent = `说"${this.config.name}${this.config.name}"唤醒我，或点击右下角小碟。`;
    document.body.appendChild(voiceHint);

    // 对话面板
    const chatPanel = document.createElement('div');
    chatPanel.id = 'disc-chat-panel';
    chatPanel.className = 'disc-chat-panel hidden';
    chatPanel.innerHTML = `
      <div class="disc-chat-header">
        <div class="disc-chat-title">${this.config.name}助手</div>
        <button class="disc-chat-close" id="disc-chat-close">×</button>
      </div>
      <div class="disc-chat-body">
        <div class="disc-chat-messages" id="disc-chat-messages"></div>
      </div>
      <div class="disc-quick-actions" id="disc-quick-actions">
        <button class="disc-quick-btn" data-action="add-employee">添加员工</button>
        <button class="disc-quick-btn" data-action="view-org">查看架构</button>
        <button class="disc-quick-btn" data-action="analyze">分析数据</button>
        <button class="disc-quick-btn" data-action="help">模型接入</button>
      </div>
      <div class="disc-chat-input-area">
        <input type="text" class="disc-chat-input" id="disc-chat-input" placeholder="输入消息或点击麦克风说话...">
        <button class="disc-chat-send" id="disc-chat-send">➤</button>
      </div>
    `;
    document.body.appendChild(chatPanel);

    // 缓存元素
    this.elements = {
      assistant,
      mini: document.getElementById('disc-mini'),
      container: document.getElementById('disc-container'),
      soundWaves: document.getElementById('disc-sound-waves'),
      overlay: document.getElementById('disc-overlay'),
      voiceHint: document.getElementById('disc-voice-hint'),
      chatPanel: document.getElementById('disc-chat-panel'),
      messages: document.getElementById('disc-chat-messages'),
      input: document.getElementById('disc-chat-input'),
      sendBtn: document.getElementById('disc-chat-send'),
      closeBtn: document.getElementById('disc-chat-close'),
      quickActions: document.getElementById('disc-quick-actions')
    };

    // 添加欢迎消息
    this.addMessage('assistant', `你好！我是${this.config.name}，你的智能助手。点击右下角的小圆点唤醒我，然后点击碟片即可语音对话。`);
  }

  // ========== 事件绑定 ==========
  bindEvents() {
    // 点击小碟唤醒
    this.elements.mini.addEventListener('click', () => this.wakeUp());

    // 点击碟片开始/停止聆听
    this.elements.container.addEventListener('click', () => {
      if (this.state === 'awake') {
        this.startListening();
      } else if (this.state === 'listening') {
        this.stopListening();
      }
    });

    // 关闭面板
    this.elements.closeBtn.addEventListener('click', () => this.sleep());

    // 点击遮罩关闭
    this.elements.overlay.addEventListener('click', () => this.sleep());

    // 发送消息
    this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
    this.elements.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendMessage();
      }
    });

    // 快捷操作
    this.elements.quickActions.addEventListener('click', (e) => {
      if (e.target.classList.contains('disc-quick-btn')) {
        const action = e.target.dataset.action;
        this.handleQuickAction(action);
      }
    });

    // ESC 键关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state !== 'sleeping') {
        this.sleep();
      }
    });
  }

  // ========== 语音识别初始化 ==========
  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('浏览器不支持语音识别功能');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = 'zh-CN';

    this.recognition.onresult = (event) => {
      const results = event.results;
      const lastResult = results[results.length - 1];

      if (lastResult.isFinal) {
        const transcript = lastResult[0].transcript.trim();
        console.log('识别结果:', transcript);

        // 只有真正有内容且在聆听状态才处理
        if (this.state === 'listening' && transcript.length > 0) {
          this.processCommand(transcript);
        }
      }
    };

    this.recognition.onerror = (event) => {
      console.error('语音识别错误:', event.error);
      if (this.state === 'listening') {
        this.addMessage('assistant', '抱歉，我没有听清楚，请再说一遍。');
        this.stopListening();
      }
    };

    this.recognition.onend = () => {
      // 识别结束，不做自动重启
      console.log('语音识别结束');
    };
  }

  // ========== 状态管理 ==========
  setState(newState) {
    const oldState = this.state;
    this.state = newState;

    // 更新样式
    this.elements.assistant.className = `disc-assistant ${newState}`;

    // 状态切换逻辑
    switch (newState) {
      case 'sleeping':
        this.elements.mini.style.display = 'block';
        this.elements.container.style.display = 'none';
        this.elements.soundWaves.style.display = 'none';
        this.elements.overlay.classList.add('hidden');
        this.elements.voiceHint.classList.add('hidden');
        break;

      case 'awake':
        this.elements.mini.style.display = 'none';
        this.elements.container.style.display = 'block';
        this.elements.soundWaves.style.display = 'none';
        this.elements.overlay.classList.remove('hidden');
        this.elements.voiceHint.classList.add('hidden');
        break;

      case 'listening':
        this.elements.soundWaves.style.display = 'block';
        this.elements.voiceHint.classList.remove('hidden');
        this.elements.voiceHint.textContent = '正在聆听，请说话...';
        break;

      case 'processing':
        this.elements.soundWaves.style.display = 'none';
        this.elements.voiceHint.classList.remove('hidden');
        this.elements.voiceHint.textContent = '正在思考...';
        break;
    }

    console.log(`[${this.config.name}] 状态: ${oldState} → ${newState}`);
  }

  // ========== 核心功能 ==========
  wakeUp() {
    if (this.state !== 'sleeping') return;

    // 第一次唤醒时显示整体助手入口
    this.show();
    // 唤醒提示音
    this.playTone('wake');
    this.setState('awake');
    this.showChatPanel();
    this.speak(`你好，我是${this.config.name}，有什么可以帮你的？`);

    // 初始化语音识别（仅在唤醒后）
    if (!this.recognition) {
      this.initSpeechRecognition();
    }
  }

  sleep() {
    // 清除聆听超时
    if (this.listenTimeout) {
      clearTimeout(this.listenTimeout);
      this.listenTimeout = null;
    }

    this.setState('sleeping');
    this.hideChatPanel();

    // 完全停止语音识别
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }
  }

  startListening() {
    if (!this.recognition) {
      this.addMessage('assistant', '抱歉，您的浏览器不支持语音识别功能。');
      return;
    }

    // 防止重复启动
    if (this.state === 'listening') {
      return;
    }

    this.setState('listening');
    // 开始聆听提示音
    this.playTone('listen');
    this.isVoiceMode = true;

    // 延迟一点再开始识别，避免浏览器冲突
    setTimeout(() => {
      if (this.state === 'listening' && this.recognition) {
        try {
          this.recognition.start();
        } catch (e) {
          console.error('语音识别启动失败:', e);
          this.setState('awake');
        }
      }
    }, 100);

    // 8秒后自动停止聆听
    this.listenTimeout = setTimeout(() => {
      if (this.state === 'listening') {
        this.stopListening();
        this.addMessage('assistant', '我没有听到指令，需要帮忙的话请点击碟片说话。');
      }
    }, 8000);
  }

  stopListening() {
    // 清除聆听超时
    if (this.listenTimeout) {
      clearTimeout(this.listenTimeout);
      this.listenTimeout = null;
    }

    // 停止语音识别
    if (this.recognition) {
      this.recognition.stop();
    }

    this.setState('awake');
    // 结束聆听轻微提示
    this.playTone('end');
  }

  checkWakeWord(text) {
    const lowerText = text.toLowerCase();
    return this.config.wakeWords.some(word => lowerText.includes(word.toLowerCase()));
  }

  async processCommand(command) {
    this.setState('processing');
    this.addMessage('user', command);

    // 优先尝试调用大模型（如果已在模型库里为小碟选好了模型）
    const usedModel = await this.tryCallLLM(command);
    if (usedModel) {
      this.setState('awake');
      return;
    }

    // 如果没有为小碟配置模型，或者调用失败，则回退到本地默认规则回复
    const response = this.generateResponse(command);
    this.addMessage('assistant', response);
    this.speak(response);
    this.setState('awake');
  }

  // ========== 调用后端大模型 ==========
  async tryCallLLM(command) {
    try {
      const orgNodeModels = window.orgNodeModels || {};
      const binding = orgNodeModels['disc-assistant'];
      if (!binding || !binding.provider || !binding.model) {
        return false;
      }

      const aiProviders = window.aiProviders || {};
      const apiConfigs = window.apiConfigs || {};
      const providerCfg = aiProviders[binding.provider];
      if (!providerCfg) {
        this.addMessage('assistant', `当前为小碟绑定的提供商「${binding.provider}」在配置中不存在。`);
        return false;
      }

      const requireKey = providerCfg.requireKey !== false;
      const apiKey = apiConfigs[binding.provider];

      if (requireKey && !apiKey) {
        this.addMessage('assistant', `已经为小碟选择了模型「${binding.model}」，但还没有配置对应的 API Key，请在顶部「API 密钥管理」中为「${providerCfg.name}」填写密钥。`);
        return false;
      }

      // 构造系统提示：小碟是公司内部助手，可以引用员工和部门信息
      const employees = window.employees || [];
      const empText = employees
        .map(e => `姓名: ${e.name}, 职位: ${e.role}, 部门: ${e.dept}${e.note ? ', 备注: ' + e.note : ''}`)
        .join('\n');

      const systemPrompt =
        '你是公司内部的语音助手「小碟」。请用简洁、自然的中文回答用户问题。' +
        (empText ? `\n以下是公司员工的一些信息，可在需要时参考：\n${empText}` : '');

      const response = await fetch('http://localhost:8080/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          provider: binding.provider,
          model: binding.model,
          apiKey: apiKey || '', // 免 Key 时后端会根据配置决定是否强制
          // 标记调用来源：小碟助手
          source: {
            type: 'assistant',
            label: 'disc-assistant'
          },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: command }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.addMessage('assistant', `❌ 调用大模型失败（${response.status}）：${errorText}`);
        return false;
      }

      const data = await response.json();
      const content = (data && data.content) ? data.content : '(模型没有返回内容)';

      this.addMessage('assistant', content);
      this.speak(content);
      return true;
    } catch (err) {
      console.error('调用大模型出错:', err);
      this.addMessage('assistant', `❌ 调用大模型出错：${err.message}。我会先用内置规则回答你。`);
      return false;
    }
  }

  generateResponse(command) {
    const cmd = command.toLowerCase();

    // 员工管理相关
    if (cmd.includes('添加') && cmd.includes('员工')) {
      return '我来帮您添加新员工。请在右侧表单中填写：员工姓名、职位名称和部门（都是必填）。';
    }
    if (cmd.includes('删除') || cmd.includes('移除')) {
      return '请在员工列表中找到要删除的员工，点击删除按钮即可。';
    }
    if (cmd.includes('编辑') || cmd.includes('修改')) {
      return '点击员工列表中的"编辑"按钮，即可修改员工信息。';
    }
    if (cmd.includes('架构') || cmd.includes('结构') || cmd.includes('组织')) {
      return '左侧画布展示了公司组织架构图，您可以拖动查看不同部门的关系。';
    }
    if (cmd.includes('部门')) {
      const depts = (window.EMP_DEPARTMENTS && window.EMP_DEPARTMENTS.length)
        ? window.EMP_DEPARTMENTS
        : ['董事会', '总经理办公室', '项目部', '宣传部', '程序部', '市场部', '人事部', '财务部', '运营部'];
      return `公司目前的部门包括：${depts.join('、')}。`;
    }
    if (cmd.includes('职位') || cmd.includes('岗位')) {
      const roles = (window.EMP_ROLES && window.EMP_ROLES.length)
        ? window.EMP_ROLES
        : ['董事长', '总经理', '副总经理', '项目经理', '宣传专员', '程序部前端工程师', '程序部后端工程师', '部门经理', '组长', '员工', '实习生'];
      return `系统支持的职位包括：${roles.join('、')}。`;
    }

    // 系统功能
    if (cmd.includes('帮助') || cmd.includes('怎么用')) {
      return '我可以帮您：1.添加/编辑员工（不会自动出现在左侧架构图里，当前不支持删除） 2.查看组织架构 3.筛选员工列表 4.回答系统使用问题。说出"添加员工"或"查看架构"来开始。';
    }
    if (cmd.includes('你好') || cmd.includes('您好')) {
      return '你好！很高兴为您服务，有什么我可以帮您的吗？';
    }
    if (cmd.includes('谢谢') || cmd.includes('感谢')) {
      return '不客气！有需要随时叫我。';
    }
    if (cmd.includes('再见') || cmd.includes('拜拜')) {
      setTimeout(() => this.sleep(), 2000);
      return '再见！祝您工作顺利。';
    }

    // 默认回复
    return `我收到了您的指令："${command}"。这是一个演示版本，更多功能正在开发中。您可以说"帮助"来了解我能做什么。`;
  }

  // ========== 消息系统 ==========
  addMessage(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `disc-message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'disc-message-avatar';
    avatar.textContent = role === 'assistant' ? '🤖' : '👤';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'disc-message-content';
    contentDiv.textContent = content;

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentDiv);

    this.elements.messages.appendChild(messageDiv);
    this.scrollToBottom();

    // 保存消息记录
    this.messages.push({ role, content, time: new Date() });
  }

  sendMessage() {
    const text = this.elements.input.value.trim();
    if (!text) return;

    this.elements.input.value = '';
    this.isVoiceMode = false;
    this.processCommand(text);
  }

  scrollToBottom() {
    this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
  }

  // ========== 提示音（Web Audio） ==========
  playTone(type = 'wake') {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;

      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
      }

      const ctx = this.audioCtx;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // 不同状态用不同音高 / 时长
      let freq = 880; // Hz
      let duration = 0.15; // 秒

      if (type === 'wake') {
        freq = 1046; // 高一点
        duration = 0.18;
      } else if (type === 'listen') {
        freq = 880;
        duration = 0.15;
      } else if (type === 'end') {
        freq = 660;
        duration = 0.12;
      }

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration + 0.02);
    } catch (e) {
      console.warn('提示音播放失败:', e);
    }
  }

  // ========== 快捷操作 ==========
  handleQuickAction(action) {
    switch (action) {
      case 'add-employee':
        this.addMessage('user', '添加员工');
        this.addMessage('assistant', '请在右侧表单中填写员工信息：姓名、职位、部门，然后点击保存。');
        // 自动聚焦到姓名输入框
        setTimeout(() => {
          const nameInput = document.getElementById('employee-name');
          if (nameInput) {
            nameInput.focus();
            nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 500);
        break;

      case 'view-org':
        this.addMessage('user', '查看组织架构');
        this.addMessage('assistant', '左侧画布展示了公司组织架构。您可以拖动画布来查看不同区域，目前显示了董事会、管理层和各部门的层级关系。');
        break;

      case 'analyze':
        this.addMessage('user', '分析数据');
        const empCount = window.employees ? window.employees.length : 0;
        this.addMessage('assistant', `当前系统中共有 ${empCount} 名员工。您可以使用右侧的筛选功能按部门或职位查看员工分布。`);
        break;

      case 'help':
        // 小碟的模型接入：让用户给“小碟”单独选一个模型，不影响全局默认和各部门绑定
        this.addMessage('user', '模型接入');

        if (window.openModal && window.renderModelSelection && window.bindModelSelectionEvents && window.setModelSelectionTargetNode) {
          try {
            // 告诉主应用：这次模型选择是给“小碟助手”用的
            window.setModelSelectionTargetNode('disc-assistant');
            window.openModal('🎯 为小碟选择模型', window.renderModelSelection());
            window.bindModelSelectionEvents();
          } catch (e) {
            console.error('通过全局函数打开模型接入弹窗失败:', e);
            this.addMessage(
              'assistant',
              '🧠 模型接入说明：\n' +
              '1. 点击页面顶部「AI 功能中心」里的「API 密钥管理」，填入你在各大模型平台申请的密钥；\n' +
              '2. 在「模型选择」里选择要给“小碟助手”使用的模型；\n' +
              '3. 配置完成后，可在后续版本中让小碟直接调用这些大模型进行对话；\n' +
              '4. 如果后端未启动，请先在本机运行 node backend/server.js。'
            );
          }
        } else {
          // 兜底：如果主应用未暴露对应函数，退回到文字说明
          this.addMessage(
            'assistant',
            '🧠 模型接入说明：\n' +
            '1. 点击页面顶部「AI 功能中心」里的「API 密钥管理」，填入你在各大模型平台申请的密钥；\n' +
            '2. 在「模型选择」里选择要给“小碟助手”使用的模型；\n' +
            '3. 配置完成后，可在后续版本中让小碟直接调用这些大模型进行对话；\n' +
            '4. 如果后端未启动，请先在本机运行 node backend/server.js。'
          );
        }
        break;
    }
  }

  // ========== 语音合成 ==========
  speak(text) {
    if (!this.config.voiceEnabled || !this.synthesis) return;

    // 取消之前的语音
    this.synthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    utterance.pitch = 1;

    this.synthesis.speak(utterance);
  }

  // ========== UI 控制 ==========
  show() {
    this.elements.assistant.classList.remove('hidden');
  }

  hide() {
    this.elements.assistant.classList.add('hidden');
  }

  showChatPanel() {
    this.elements.chatPanel.classList.remove('hidden');
  }

  hideChatPanel() {
    this.elements.chatPanel.classList.add('hidden');
  }

  // ========== 公共 API ==========
  // 程序化触发唤醒
  triggerWake() {
    this.wakeUp();
  }

  // 添加自定义回复规则
  addResponseRule(pattern, response) {
    // 可以扩展为更复杂的规则系统
    console.log('添加回复规则:', pattern, response);
  }

  // 获取对话历史
  getHistory() {
    return [...this.messages];
  }

  // 清空对话
  clearChat() {
    this.messages = [];
    this.elements.messages.innerHTML = '';
    this.addMessage('assistant', `对话已清空，我是${this.config.name}，有什么可以帮您的？`);
  }
}

// 自动初始化
document.addEventListener('DOMContentLoaded', () => {
  window.discAssistant = new DiscAssistant({
    name: '小碟',
    wakeWords: ['小碟小碟', 'hey 小碟', '小碟'],
    voiceEnabled: true,
    // 进页面时展示右下角“小碟”小圆点，等待你点它再展开碟片和遮罩
    autoStart: true
  });
});

// 导出供外部使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DiscAssistant;
}
