# OPC-workflow

个人公司工作流程管理系统

## 项目简介

OPC-workflow 是一个专为个人公司设计的工作流程管理系统，帮助个人创业者高效管理日常工作、项目和财务。

## 功能特性

- **前端界面**：提供直观的用户界面，包括仪表盘、财务报表、市场分析等功能
- **后端服务**：基于 Node.js 构建的后端服务，处理数据存储和业务逻辑
- **数据管理**：支持员工信息、模型用量、财务报表等数据的管理和导出
- **自动化工作流**：集成 Coze AI 助手，实现智能工作流程自动化
- **语音合成**：集成 GPT-SoVITS 语音合成模型，支持自定义语音生成
- **Docker 部署**：支持 Docker 和 Docker Compose 快速部署

## 技术栈

- **前端**：HTML5, CSS3, JavaScript
- **后端**：Node.js, Express
- **数据库**：SQLite（本地开发环境）
- **AI 集成**：Coze AI 平台、通义千问、DeepSeek、Moonshot、智谱 GLM、OpenAI、Grok、Gemini
- **语音合成**：GPT-SoVITS
- **部署**：Docker、Docker Compose

## 快速开始

### 环境要求

- Node.js 14.0 或更高版本
- npm 6.0 或更高版本
- Docker（可选，用于容器化部署）

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/42433422/OPC-workflow.git
   cd OPC-workflow
   ```

2. **安装依赖**
   ```bash
   npm install
   cd backend
   npm install
   ```

3. **启动服务**
   ```bash
   # 启动后端服务
   cd backend
   node server.js
   
   # 前端访问
   # 打开浏览器访问 http://localhost:8080
   ```

### Docker 部署（可选）

```bash
# 使用 Docker Compose 启动所有服务
docker-compose up -d
```

## 项目结构

```
OPC-workflow/
├── backend/           # 后端服务
│   ├── data/          # 数据文件
│   ├── middleware/    # 中间件
│   ├── routes/        # 路由
│   ├── src/           # 源代码
│   ├── tests/         # 测试
│   ├── utils/         # 工具函数
│   ├── package.json   # 后端依赖
│   └── server.js      # 后端入口
├── frontend/          # 前端界面
│   ├── index.html     # 主页面
│   ├── app.js         # 前端逻辑
│   └── style.css      # 样式文件
├── scripts/           # 脚本文件
├── GPT-SoVITS-beta0706/  # 语音合成模型
├── docker-compose.yml # Docker Compose 配置
├── Dockerfile         # Docker 配置
├── package.json       # 项目依赖
├── LICENSE            # Apache 2.0 许可证
└── README.md          # 项目说明
```

## 许可证

本项目采用 Apache 2.0 许可证。详见 [LICENSE](LICENSE) 文件。

## 贡献

欢迎提交 Issue 和 Pull Request 来改进项目。

## 联系方式

- 邮箱：970882904@qq.com
- GitHub Issues：https://github.com/42433422/OPC-workflow/issues

## 版本信息

- **当前版本**：v1.0.1
- **发布日期**：2026-02-26
- **更新内容**：
  - 添加 Docker 支持
  - 添加语音合成功能
  - 完善员工管理系统
  - 添加更多 AI 提供商支持
