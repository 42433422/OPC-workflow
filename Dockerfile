# 多阶段构建 Dockerfile

# 阶段 1: 构建阶段
FROM node:18-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./
COPY backend/package*.json ./backend/

# 安装依赖
RUN npm ci --only=production

# 阶段 2: 运行阶段
FROM node:18-alpine

# 安装必要工具
RUN apk add --no-cache curl

WORKDIR /app

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 复制依赖
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/backend/node_modules ./backend/node_modules

# 复制应用代码
COPY --chown=nodejs:nodejs . .

# 创建数据目录
RUN mkdir -p /app/backend/data && chown -R nodejs:nodejs /app/backend/data

# 切换到非 root 用户
USER nodejs

# 暴露端口
EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/api/health || exit 1

# 启动命令
WORKDIR /app/backend
CMD ["node", "server.js"]
