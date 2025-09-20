# 转录功能超时修复测试指南

## 问题描述
转录功能在约1分钟后自动停止，这是由于服务器端的worker超时机制导致的。

## 修复内容

### 1. 服务器端配置修改
- **文件**: `ai_agents/.env`
- **修改**: 将 `WORKER_QUIT_TIMEOUT_SECONDS` 从 `60` 修改为 `3600`（1小时）
- **效果**: Worker现在会保持活跃1小时而不是1分钟

### 2. 前端心跳机制
- **文件**: `ai_agents/agents/examples/demo/web/src/app/transcription/page.tsx`
- **新增功能**:
  - 添加了ping心跳机制，每30秒向服务器发送一次ping请求
  - 在连接AI助手时自动启动心跳
  - 在断开连接或停止录音时自动停止心跳

## 测试步骤

### 准备工作
1. 确保Docker服务正在运行
2. 确保已配置正确的Agora和OpenAI API密钥
3. 重启服务以应用新的环境变量配置

### 测试流程
1. **启动服务**:
   ```bash
   cd ai_agents
   docker-compose up -d
   ```

2. **访问转录页面**:
   - 打开浏览器访问: `http://localhost:3001/transcription`

3. **进行长时间转录测试**:
   - 点击"连接 AI 助手"
   - 点击"开始录音"
   - 持续进行语音输入超过2分钟（之前会在1分钟后停止）
   - 观察转录是否持续工作
   - 检查浏览器控制台是否显示ping心跳日志

4. **验证修复效果**:
   - 转录应该能够持续工作超过1分钟
   - 在浏览器控制台中每30秒应该看到ping成功的日志
   - 服务器不应再因超时而自动停止worker

### 预期结果
- ✅ 转录功能可以持续工作超过1分钟
- ✅ 每30秒看到"Ping sent successfully"日志
- ✅ 没有worker超时错误
- ✅ AI助手保持连接状态

### 故障排除
如果仍然遇到超时问题：

1. **检查环境变量**:
   ```bash
   grep WORKER_QUIT_TIMEOUT_SECONDS ai_agents/.env
   ```
   应该显示: `WORKER_QUIT_TIMEOUT_SECONDS=3600`

2. **检查Docker容器是否使用了新配置**:
   ```bash
   docker-compose down && docker-compose up -d
   ```

3. **查看服务器日志**:
   ```bash
   docker logs ten_agent_dev
   ```

4. **检查浏览器控制台**:
   - 应该看到定期的ping日志
   - 检查是否有网络错误

## 技术细节

### Worker超时机制
- 服务器每5秒检查一次worker状态
- 如果worker的`UpdateTs + QuitTimeoutSeconds < 当前时间`，则终止worker
- Ping请求会更新worker的`UpdateTs`，重置超时计时器

### 心跳频率
- 心跳间隔: 30秒
- 超时时间: 3600秒（1小时）
- 安全边际: 120倍（3600/30 = 120），确保足够的缓冲时间

这个修复应该彻底解决转录功能的超时问题，允许用户进行长时间的会议转录。
