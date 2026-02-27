// 临时补丁文件 - 用于添加剪影剪辑功能面板

// 在 renderOrgNodeFeaturePanel 函数开头添加以下代码（在第一个 if 之前）：

  // 特殊节点：剪影剪辑员工 - 显示文件夹管理功能
  if (info.label === "剪影剪辑" && type === "员工") {
    // 获取员工完整信息
    const empId = id ? id.replace("emp-", "") : "";
    const emp = employees.find(e => e.id === parseInt(empId, 10));
    const folderPath = emp && emp.folderPath ? emp.folderPath : "";
    
    return `
      <div class="api-config-section">
        <h3>🎬 剪影剪辑 - 功能面板</h3>
        <div class="tool-card">
          <h4>📁 剪影文件夹管理</h4>
          <p style="margin-bottom: 12px; font-size: 13px; color: var(--text-muted);">管理剪影剪辑的专属文件夹路径，用于存放剪影项目文件：</p>
          
          ${folderPath ? `
            <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 6px; margin-bottom: 12px;">
              <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">当前文件夹路径：</div>
              <div style="font-family: monospace; font-size: 13px; word-break: break-all; color: var(--text-primary);">${folderPath}</div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="primary-btn" id="jianying-folder-open-btn">📂 打开文件夹</button>
              <button class="secondary-btn" id="jianying-folder-edit-btn">✏️ 修改路径</button>
            </div>
          ` : `
            <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 6px; margin-bottom: 12px; border-left: 3px solid var(--warning);">
              <p style="color: var(--warning); font-size: 13px; margin: 0;">⚠️ 尚未设置文件夹路径</p>
            </div>
            <button class="primary-btn" id="jianying-folder-set-btn">📁 设置文件夹路径</button>
          `}
        </div>
        
        <div class="tool-card">
          <h4>🎥 视频制作工具</h4>
          <p style="margin-bottom: 8px;">推荐的 AI 视频制作工具：</p>
          <ul style="padding-left: 18px; font-size: 13px; line-height: 1.6;">
            <li><strong>剪映专业版</strong>：字节跳动出品，功能强大，适合专业剪辑</li>
            <li><strong>CapCut</strong>：剪映国际版，海外用户首选</li>
            <li><strong>即梦 AI</strong>：字节旗下 AI 视频生成工具</li>
            <li><strong>可灵 AI</strong>：快手出品，画质优秀</li>
          </ul>
        </div>
      </div>
    `;
  }

