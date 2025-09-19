# AI Meeting Assistant

一个基于 TEN Framework 的智能会议助手，提供实时语音转文字、会议总结、行动项提取和智能日程安排功能。

## 功能特性

### 🎤 实时语音转录
- 高精度语音识别，支持中英文
- 实时转录显示，区分说话人
- 支持临时结果和最终结果
- 音频质量检测和优化建议

### 📝 智能会议总结
- **实时总结**: 每 5 分钟自动生成关键要点
- **阶段总结**: 根据会议阶段（开场、讨论、决策、行动计划）生成专项总结
- **最终总结**: 会议结束后生成完整的会议纪要
- **自定义总结**: 支持手动触发特定类型的总结

### 🎯 行动项管理
- 自动识别会议中的任务和行动项
- 智能提取负责人、截止时间和优先级
- 支持任务状态跟踪和更新
- 生成结构化的任务清单

### 📅 智能日程安排
- 自动安排后续会议和检查会议
- 基于行动项截止时间的提醒设置
- 支持多种日历服务集成（Google Calendar、Outlook、Webhook）
- 智能时间冲突检测和建议

### 🔄 会议阶段识别
- 自动识别会议当前阶段
- 阶段包括：开场、讨论、决策制定、行动计划、结束
- 针对不同阶段提供定制化的处理逻辑

## 系统架构

```
Meeting Assistant
├── Core Components
│   ├── MeetingProcessor     # 会议核心处理器
│   ├── SummaryGenerator     # 智能总结生成器
│   ├── ActionExtractor      # 行动项提取器
│   └── CalendarManager      # 日程管理器
├── Event System
│   ├── Meeting Events       # 会议相关事件
│   ├── ASR Events          # 语音识别事件
│   └── LLM Events          # 语言模型事件
└── Integration Layer
    ├── TEN Framework       # 核心框架集成
    ├── External APIs       # 外部服务集成
    └── UI Interface        # 用户界面接口
```

## 配置说明

### 基础配置
```json
{
  "greeting": "Hello, I am your AI Meeting Assistant.",
  "agent_name": "AI Meeting Assistant",
  "default_language": "zh-CN"
}
```

### 会议设置
```json
{
  "meeting": {
    "auto_summary_interval": 300,
    "enable_action_detection": true,
    "enable_speaker_identification": true,
    "enable_real_time_summary": true,
    "enable_auto_scheduling": true
  }
}
```

### 日历集成
```json
{
  "calendar_integration": {
    "google_calendar": {
      "enabled": true,
      "credentials_path": "/path/to/credentials.json",
      "calendar_id": "primary"
    },
    "outlook_calendar": {
      "enabled": false,
      "client_id": "your_client_id",
      "client_secret": "your_client_secret"
    }
  }
}
```

## 快速开始

### 1. 安装依赖
```bash
cd ai_agents/agents/examples/meeting-assistant
pip install -r requirements.txt
```

### 2. 配置环境
```bash
# 设置必要的环境变量
export OPENAI_API_KEY="your_openai_api_key"
export GOOGLE_CALENDAR_CREDENTIALS_PATH="/path/to/credentials.json"
```

### 3. 启动服务
```bash
# 构建和运行
ten build meeting-assistant
ten run meeting-assistant
```

### 4. 使用示例
```python
# 基本使用
agent = MeetingAgent(ten_env)

# 开始会议
meeting_id = await agent.start_meeting(
    participants=["Alice", "Bob", "Charlie"],
    agenda="项目进度讨论"
)

# 手动生成总结
await agent.generate_summary("real_time")

# 结束会议
await agent.end_current_meeting()
```

## API 接口

### 会议控制
- `start_meeting(participants, agenda)`: 开始新会议
- `end_current_meeting()`: 结束当前会议
- `get_meeting_status()`: 获取会议状态

### 总结管理
- `generate_summary(type)`: 手动生成总结
- `export_meeting_data(format)`: 导出会议数据

### 行动项管理
- `get_action_items(meeting_id)`: 获取行动项列表
- `update_action_status(action_id, status)`: 更新行动项状态

## 核心组件

### MeetingProcessor
处理会议的核心逻辑，包括：
- 会议状态管理
- 转录数据处理
- 会议阶段识别
- 参与者统计

### SummaryGenerator
智能总结生成器，支持：
- 实时总结（每5分钟）
- 阶段性总结
- 最终会议总结
- 自定义总结模板

### ActionExtractor
行动项提取器，能够：
- 识别会议中的任务
- 提取负责人信息
- 解析截止时间
- 确定任务优先级

### CalendarManager
日程管理器，提供：
- 后续会议安排
- 截止日期提醒
- 多日历平台集成
- 智能时间调度

## 配置文件结构

```python
class MeetingAssistantConfig:
    # 基础设置
    greeting: str
    agent_name: str
    version: str

    # 功能模块配置
    meeting: MeetingConfig
    calendar_integration: CalendarIntegrationConfig
    llm_prompts: LLMPromptsConfig
    notifications: NotificationConfig
    export: ExportConfig
    security: SecurityConfig
```

## 事件系统

### 会议生命周期事件
- `MeetingStartEvent`: 会议开始时触发
- `MeetingEndEvent`: 会议结束时触发
- `MeetingPhaseChangeEvent`: 会议阶段变更时触发

### 内容处理事件
- `ASRResultEvent`: 语音识别结果
- `ActionItemEvent`: 识别到行动项
- `SummaryGeneratedEvent`: 生成总结
- `CalendarEventEvent`: 创建日程安排

## 集成说明

### TEN Framework 集成
本项目完全基于 TEN Framework 构建，复用了：
- ASR 扩展（语音识别）
- LLM 扩展（语言模型）
- TTS 扩展（语音合成，可选）
- RTC 扩展（实时通信）

### 外部服务集成
支持集成多种外部服务：
- **Google Calendar**: Google 日历同步
- **Outlook Calendar**: Microsoft 日历集成
- **Slack**: 通知推送
- **Email**: 邮件提醒
- **Webhook**: 自定义集成

## 部署配置

### 环境要求
- Python 3.8+
- TEN Framework
- 足够的内存用于语音处理
- 稳定的网络连接

### 生产环境配置
```json
{
  "performance": {
    "max_concurrent_meetings": 10,
    "asr_buffer_size": 2048,
    "llm_timeout": 45,
    "summary_batch_size": 20
  },
  "security": {
    "enable_recording_encryption": true,
    "max_participants": 100,
    "meeting_timeout": 14400
  }
}
```

## 故障排除

### 常见问题

1. **会议无法开始**
   - 检查 ASR 服务是否正常
   - 验证麦克风权限
   - 确认网络连接

2. **总结生成失败**
   - 检查 LLM API 配置
   - 验证 API 密钥
   - 检查请求频率限制

3. **日历同步问题**
   - 验证 OAuth 认证
   - 检查 API 权限范围
   - 确认时区设置

### 调试模式
启用详细日志：
```json
{
  "debug": {
    "enable_debug_logging": true,
    "log_level": "DEBUG",
    "log_to_file": true,
    "log_file_path": "./logs/meeting_assistant.log"
  }
}
```

## 扩展开发

### 自定义处理器
```python
class CustomProcessor(MeetingProcessor):
    async def custom_analysis(self, content):
        # 自定义分析逻辑
        pass
```

### 新增事件类型
```python
class CustomMeetingEvent(AgentEventBase):
    type: Literal["data"] = "data"
    name: Literal["custom_meeting"] = "custom_meeting"
    custom_field: str
```

### 第三方服务集成
```python
class CustomIntegration:
    async def sync_to_service(self, data):
        # 集成第三方服务
        pass
```

## 许可证

本项目采用 Apache License 2.0 开源许可证。

## 贡献

欢迎提交 Issue 和 Pull Request！

## 技术支持

如有问题，请查看：
- 项目文档
- GitHub Issues
- TEN Framework 官方文档