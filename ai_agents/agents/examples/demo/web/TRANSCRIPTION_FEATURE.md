# 会议实时语音转文字功能

## 功能概述

新增了一个专门的会议实时语音转文字页面，利用现有的TEN Framework和RTC技术栈，为用户提供高质量的实时语音转录服务。

## 功能特性

### 🎤 实时语音识别
- 基于Agora RTC技术实现低延迟音频传输
- 实时语音转文字，支持中文和英文
- 可视化音频输入指示器

### 📝 智能转录显示
- 实时显示转录进度（临时结果和最终结果）
- 区分不同说话人（用户/AI助手）
- 时间戳标记每条转录记录
- 自动滚动到最新转录内容

### 💾 导出功能
- 支持导出转录内容为文本文件
- 包含时间戳和说话人信息
- 文件名自动包含日期

### 🎨 用户界面
- 响应式设计，支持桌面和移动端
- 暗色主题，护眼舒适
- 直观的控制面板
- 实时连接状态显示

## 技术实现

### 核心技术栈
- **前端框架**: Next.js 15 + React 18 + TypeScript
- **UI组件**: shadcn/ui + Tailwind CSS
- **实时通信**: Agora RTC SDK
- **状态管理**: Redux Toolkit
- **音频处理**: Web Audio API

### 代码结构
```
src/app/transcription/
├── page.tsx              # 主页面组件
├── layout.tsx            # 布局组件
└── ...

src/components/
├── Icon/index.tsx         # 新增TranscriptionIcon
└── Layout/HeaderComponents.tsx  # 头部导航按钮
```

### 关键组件

#### TranscriptionPage
- 主要的转录页面组件
- 管理录音状态和转录数据
- 处理RTC连接和音频流

#### TranscriptionIcon
- 新设计的转录图标
- SVG格式，支持主题色彩
- 麦克风和文档的组合设计

## 使用方法

### 1. 访问转录页面
点击页面顶部导航栏中的"转录"按钮，或直接访问 `/transcription` 路径。

### 2. 开始录音
1. 确保麦克风权限已授权
2. 点击"开始录音"按钮
3. 系统会自动连接RTC服务并开始音频采集

### 3. 实时转录
- 开始说话，系统会实时显示转录结果
- 临时结果显示为蓝色边框，最终结果为灰色
- 可以看到音频输入的可视化指示器

### 4. 管理转录
- 点击"清除转录"可以清空当前所有转录记录
- 点击"导出转录"可以下载转录内容为文本文件
- 点击"停止录音"结束转录会话

## 配置说明

### 环境变量
转录功能使用与主应用相同的环境配置：
- `AGORA_APP_ID`: Agora应用ID
- `AGORA_APP_CERTIFICATE`: Agora应用证书（可选）

### RTC设置
- 使用与主应用相同的频道和用户ID设置
- 自动创建和管理音频轨道
- 支持多人会议场景

## 扩展功能

### 未来可能的改进
1. **多语言支持**: 支持更多语言的语音识别
2. **说话人识别**: 自动识别和区分不同的说话人
3. **关键词高亮**: 高亮显示重要关键词
4. **搜索功能**: 在转录历史中搜索特定内容
5. **实时翻译**: 将转录内容实时翻译为其他语言
6. **会议总结**: AI自动生成会议纪要和总结

### 自定义选项
- 转录语言选择
- 音频质量设置
- 导出格式选择（TXT、PDF、Word等）
- 自定义转录模板

## 故障排除

### 常见问题
1. **无法开始录音**: 检查麦克风权限和网络连接
2. **转录不准确**: 确保音频输入清晰，减少背景噪音
3. **连接失败**: 检查Agora服务配置和网络状态

### 调试信息
页面会显示详细的连接状态信息，包括：
- 连接进度（连接中、创建音频轨道、发布音频等）
- 房间信息（频道名、用户ID）
- 转录统计（转录条数）

## 技术细节

### RTC集成
```typescript
// 使用现有的RtcManager
const [rtcManager] = useState(() => new RtcManager())

// 监听转录事件
rtcManager.on("textChanged", handleTextChanged)
```

### 状态管理
```typescript
// 转录数据结构
interface TranscriptItem {
  id: string
  text: string
  timestamp: Date
  isFinal: boolean
  speaker: string
}
```

### 音频可视化
```typescript
// 使用现有的音频可视化组件
const frequencies = useMultibandTrackVolume(audioTrack, 5, 100, 600)
```

这个功能完全基于现有的代码架构，重用了TEN Framework的RTC管理器、音频处理和UI组件，确保了代码的一致性和可维护性。



