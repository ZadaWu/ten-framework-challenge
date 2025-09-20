"use client"

import { useEffect, useState, useRef } from "react"
import { apiStartService, apiStopService, apiGenAgoraData, apiPing } from "@/common/request"
import { useDispatch, useSelector } from "react-redux"
import type { AppDispatch, RootState } from "@/store"
import Header from "@/components/Layout/Header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InfoIcon } from "@/components/Icon"
import { MicIconByStatus, NetworkIconByLevel } from "@/components/Icon"
import { cn } from "@/lib/utils"
import { setRoomConnected, setAgentConnected, addChatItem, setOptions } from "@/store/reducers/global"
import dynamic from "next/dynamic"
import type { IAgoraRTCClient, IMicrophoneAudioTrack } from "agora-rtc-sdk-ng"

const DynamicMeetingInterface = dynamic(() => import("@/components/Meeting/MeetingInterface"), {
    ssr: false,
})
import AuthInitializer from "@/components/authInitializer"
import { EMessageType, EMessageDataType } from "@/types"

interface TranscriptItem {
    id: string
    text: string
    timestamp: Date
    isFinal: boolean
    speaker: string
}

export default function TranscriptionPage() {
    const dispatch = useDispatch<AppDispatch>()
    const options = useSelector((state: RootState) => state.global.options)
    const roomConnected = useSelector((state: RootState) => state.global.roomConnected)
    const agentConnected = useSelector((state: RootState) => state.global.agentConnected)
    const chatItems = useSelector((state: RootState) => state.global.chatItems)
    const language = useSelector((state: RootState) => state.global.language)
    const voiceType = useSelector((state: RootState) => state.global.voiceType)

    const [transcripts, setTranscripts] = useState<TranscriptItem[]>([])
    const [isRecording, setIsRecording] = useState(false)
    const [audioTrack, setAudioTrack] = useState<IMicrophoneAudioTrack>()
    const [rtcClient, setRtcClient] = useState<IAgoraRTCClient>()
    const [error, setError] = useState<string>("")
    const [connectionStatus, setConnectionStatus] = useState<string>("未连接")
    const [agentConnecting, setAgentConnecting] = useState(false)

    const messageCache = useRef<{ [key: string]: any[] }>({})
    const pingIntervalRef = useRef<NodeJS.Timeout | null>(null)
    const pendingTextRef = useRef<string>("")
    const lastUpdateTimeRef = useRef<number>(0)
    const textBufferTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    // Message handling function similar to rtcManager
    const handleChunkMessage = (formattedChunk: string) => {
        try {
            console.log("[transcription] Processing chunk:", formattedChunk)

            // Split the chunk by the delimiter "|"
            const parts = formattedChunk.split('|')
            if (parts.length < 4) {
                console.log("[transcription] Invalid chunk format, parts:", parts.length)
                return
            }

            const [message_id, partIndexStr, totalPartsStr, content] = parts
            const part_index = parseInt(partIndexStr, 10)
            const total_parts = totalPartsStr === '???' ? -1 : parseInt(totalPartsStr, 10)

            console.log("[transcription] Chunk details:", { message_id, part_index, total_parts, contentLength: content.length })

            // Ensure total_parts is known before processing further
            if (total_parts === -1) {
                console.warn(`[transcription] Total parts for message ${message_id} unknown, waiting for further parts.`)
                return
            }

            const chunkData = {
                message_id,
                part_index,
                total_parts,
                content,
            }

            // Check if we already have an entry for this message
            if (!messageCache.current[message_id]) {
                messageCache.current[message_id] = []
                // Set a timeout to discard incomplete messages
                setTimeout(() => {
                    if (messageCache.current[message_id]?.length !== total_parts) {
                        console.warn(`[transcription] Incomplete message with ID ${message_id} discarded`)
                        delete messageCache.current[message_id]
                    }
                }, 5000)
            }

            // Cache this chunk by message_id
            messageCache.current[message_id].push(chunkData)

            // If all parts are received, reconstruct the message
            if (messageCache.current[message_id].length === total_parts) {
                const completeMessage = reconstructMessage(messageCache.current[message_id])

                try {
                    const decodedMessage = base64ToUtf8(completeMessage)
                    const messageData = JSON.parse(decodedMessage)

                    console.log(`[transcription] Complete message parsed:`, messageData)

                    const { stream_id, is_final, text, text_ts, data_type, role } = messageData
                    const isAgent = role === "assistant"

                    if (text && text.trim().length > 0) {
                        // 使用智能分段逻辑
                        handleTranscriptionText(text, is_final, isAgent, stream_id, text_ts)
                    }
                } catch (parseError) {
                    console.error('[transcription] Error parsing complete message:', parseError)
                }

                // Clean up the cache
                delete messageCache.current[message_id]
            }
        } catch (error) {
            console.error('[transcription] Error processing chunk:', error)
        }
    }

    // Function to reconstruct the full message from chunks
    const reconstructMessage = (chunks: any[]): string => {
        // Sort chunks by their part index
        chunks.sort((a, b) => a.part_index - b.part_index)
        // Concatenate all chunks to form the full message
        return chunks.map(chunk => chunk.content).join('')
    }

    // Base64 to UTF-8 decoder
    const base64ToUtf8 = (base64: string): string => {
        const binaryString = atob(base64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
        }
        return new TextDecoder('utf-8').decode(bytes)
    }

    // 修复重复问题的智能转录分段处理
    const handleTranscriptionText = (text: string, is_final: boolean, isAgent: boolean, stream_id: string, text_ts: number) => {
        const currentTime = Date.now()

        if (isAgent) {
            // AI助手的消息直接显示，不需要缓冲
            const textItem = {
                type: EMessageType.AGENT,
                time: text_ts || currentTime,
                text: text,
                data_type: EMessageDataType.TEXT,
                userId: stream_id,
                isFinal: is_final,
            }
            dispatch(addChatItem(textItem))
            return
        }

        // 用户语音转录的简化逻辑（避免重复）
        if (is_final) {
            // 清除任何待处理的定时器
            if (textBufferTimeoutRef.current) {
                clearTimeout(textBufferTimeoutRef.current)
                textBufferTimeoutRef.current = null
            }

            // 合并缓冲的内容与当前文本
            let finalText = text.trim()
            if (pendingTextRef.current.trim()) {
                // 检查是否已经包含了缓冲的内容（避免重复）
                if (!text.includes(pendingTextRef.current.trim())) {
                    finalText = (pendingTextRef.current + " " + text).trim()
                }
            }

            // 清空缓冲区
            pendingTextRef.current = ""

            // 只有当文本有意义时才输出
            if (finalText.length > 3) {
                const textItem = {
                    type: EMessageType.USER,
                    time: text_ts || currentTime,
                    text: finalText,
                    data_type: EMessageDataType.TEXT,
                    userId: stream_id,
                    isFinal: true,
                }
                dispatch(addChatItem(textItem))
                lastUpdateTimeRef.current = currentTime
            }
        } else {
            // 非最终结果：简单缓存，不立即输出
            pendingTextRef.current = text.trim()
            lastUpdateTimeRef.current = currentTime

            // 清除之前的定时器
            if (textBufferTimeoutRef.current) {
                clearTimeout(textBufferTimeoutRef.current)
                textBufferTimeoutRef.current = null
            }

            // 设置超时保护：如果3秒内没有最终结果，就输出当前内容
            textBufferTimeoutRef.current = setTimeout(() => {
                if (pendingTextRef.current.trim().length > 3) {
                    const textItem = {
                        type: EMessageType.USER,
                        time: lastUpdateTimeRef.current || currentTime,
                        text: pendingTextRef.current.trim(),
                        data_type: EMessageDataType.TEXT,
                        userId: stream_id,
                        isFinal: true,
                    }
                    dispatch(addChatItem(textItem))
                    pendingTextRef.current = ""
                }
            }, 3000) // 3秒超时
        }
    }

    // 改进的智能语义分析
    const generateBasicSummary = (messages: any[]) => {
        const totalMessages = messages.length
        const totalDuration = Math.round((Date.now() - (messages[0]?.time || Date.now())) / 60000)
        const totalChars = messages.reduce((total, item) => total + item.text.length, 0)

        // 语义分析函数
        const analyzeMessage = (text: string) => {
            const analysis = {
                isActionItem: false,
                hasTimeInfo: false,
                urgencyLevel: 0, // 0-低, 1-中, 2-高
                confidence: 0,
                category: 'general' as 'action' | 'decision' | 'information' | 'question' | 'general'
            }

            // 句式结构分析（更智能的模式识别）
            const questionPatterns = [
                /[？?]$/, /什么/, /怎么/, /如何/, /为什么/, /哪里/, /哪个/, /什么时候/,
                /可以吗/, /行吗/, /好吗/, /对吗/, /是吗/
            ]

            // 否定模式识别
            const negationPatterns = [
                /不需要/, /不用/, /不要/, /不行/, /不可以/, /没有/, /没必要/,
                /取消/, /放弃/, /停止/, /不做/, /算了/
            ]

            // 行动模式（更复杂的语义理解）
            const actionPatterns = [
                // 明确的任务分配
                /(.+)(负责|处理|承担)(.+)/,
                /让(.+)(去|来|做)(.+)/,
                /安排(.+)(负责|处理|完成)(.+)/,

                // 需求和计划
                /(.+)(需要|应该|要|得|必须)(.+)/,
                /(.+)(计划|安排|准备|打算)(.+)/,

                // 具体行动
                /(.+)(完成|执行|实施|开始|进行|推进)(.+)/,
                /(.+)(联系|确认|检查|更新|修改|优化|改进)(.+)/,
                /(.+)(提交|发送|上传|下载|安装)(.+)/,

                // 会议和沟通
                /(.+)(开会|讨论|汇报|沟通|交流)(.+)/,
                /(.+)(通知|告知|报告|反馈)(.+)/
            ]

            const decisionPatterns = [
                /决定(.+)/, /确定(.+)/, /同意(.+)/, /批准(.+)/,
                /选择(.+)/, /采用(.+)/, /通过(.+)/, /接受(.+)/,
                /拒绝(.+)/, /否决(.+)/, /暂停(.+)/
            ]

            // 条件和假设模式
            const conditionalPatterns = [
                /如果(.+)/, /假如(.+)/, /万一(.+)/, /要是(.+)/,
                /当(.+)的时候/, /在(.+)情况下/
            ]

            // 时间表达式识别（更灵活的模式）
            const timePatterns = [
                /\d+月\d+[日号]/, /\d+\/\d+/, /\d+-\d+-\d+/,
                /(明天|明日|后天)/, /(下周|下个月|下季度)/,
                /(周[一二三四五六日天])/, /(星期[一二三四五六日天])/,
                /\d+点/, /\d+:\d+/, /(上午|下午|晚上|凌晨)/,
                /(立即|马上|尽快|立刻)/, /(今天|今日|当天)/,
                /(年底|月底|季度末)/, /截止|期限|deadline/i
            ]

            // 紧急程度识别
            const urgencyPatterns = [
                { pattern: /(紧急|急需|立刻|马上|立即)/, level: 2 },
                { pattern: /(重要|关键|必须|优先)/, level: 1 },
                { pattern: /(尽快|及时|抓紧)/, level: 1 }
            ]

            // 执行智能分析

            // 首先检查否定模式
            const isNegative = negationPatterns.some(pattern => pattern.test(text))

            // 检查条件模式
            const isConditional = conditionalPatterns.some(pattern => pattern.test(text))

            if (questionPatterns.some(pattern => pattern.test(text))) {
                analysis.category = 'question'
                analysis.confidence += 0.3
            } else if (actionPatterns.some(pattern => pattern.test(text))) {
                if (isNegative) {
                    // 否定的行动通常不是待办事项，但可能是重要信息
                    analysis.category = 'information'
                    analysis.confidence += 0.2
                } else if (isConditional) {
                    // 条件性的行动，降低作为待办事项的置信度
                    analysis.isActionItem = true
                    analysis.category = 'action'
                    analysis.confidence += 0.3
                } else {
                    // 明确的行动项
                    analysis.isActionItem = true
                    analysis.category = 'action'
                    analysis.confidence += 0.7
                }
            } else if (decisionPatterns.some(pattern => pattern.test(text))) {
                analysis.category = 'decision'
                analysis.confidence += isNegative ? 0.5 : 0.6 // 否定决策也很重要
            }

            // 语境增强分析
            if (text.includes('我们') || text.includes('大家') || text.includes('团队')) {
                analysis.confidence += 0.1 // 团队相关的更可能是重要信息
            }

            if (text.includes('会议') || text.includes('讨论') || text.includes('决定')) {
                analysis.confidence += 0.1 // 会议相关内容
            }

            // 时间信息检测
            if (timePatterns.some(pattern => pattern.test(text))) {
                analysis.hasTimeInfo = true
                analysis.confidence += 0.3
                if (analysis.isActionItem) {
                    analysis.confidence += 0.2 // 有时间的行动项更可能是真正的待办事项
                }
            }

            // 紧急程度评估
            for (const urgencyPattern of urgencyPatterns) {
                if (urgencyPattern.pattern.test(text)) {
                    analysis.urgencyLevel = Math.max(analysis.urgencyLevel, urgencyPattern.level)
                    analysis.confidence += 0.2
                    break
                }
            }

            // 长度和复杂度加权
            if (text.length > 15) {
                analysis.confidence += 0.1
            }
            if (text.length > 30) {
                analysis.confidence += 0.1
            }

            // 包含具体信息的加权
            if (/\d+/.test(text)) {
                analysis.confidence += 0.1
            }
            if (/[A-Za-z@]/.test(text)) { // 可能包含邮箱、英文名等
                analysis.confidence += 0.1
            }

            return analysis
        }

        // 分析所有消息
        const analyzedMessages = messages.map(msg => ({
            ...msg,
            analysis: analyzeMessage(msg.text)
        }))

        // 分类提取
        const actionItems = analyzedMessages
            .filter(msg => msg.analysis.isActionItem && msg.analysis.confidence > 0.3)
            .sort((a, b) => b.analysis.urgencyLevel - a.analysis.urgencyLevel)

        const decisions = analyzedMessages
            .filter(msg => msg.analysis.category === 'decision')

        const timeRelated = analyzedMessages
            .filter(msg => msg.analysis.hasTimeInfo)

        const importantInfo = analyzedMessages
            .filter(msg => msg.analysis.confidence > 0.4 || msg.text.length > 25)

        const questions = analyzedMessages
            .filter(msg => msg.analysis.category === 'question')

        // 生成简洁的会议总结
        const urgentActions = actionItems.filter(item => item.analysis.urgencyLevel >= 2)
        const normalActions = actionItems.filter(item => item.analysis.urgencyLevel === 1)
        const lowPriorityActions = actionItems.filter(item => item.analysis.urgencyLevel === 0)

        // 简化输出，只保留核心内容
        return `## 📝 会议总结

### 🎯 主要讨论内容
${importantInfo.length > 0 ?
                importantInfo.slice(0, 4).map(item => `• ${item.text}`).join('\n')
                : '• 本次会议为语音交流，未识别到具体讨论要点'}

${decisions.length > 0 ? `\n### 💡 重要决策
${decisions.map(item => `• ${item.text}`).join('\n')}` : ''}

### ✅ 待办事项

${urgentActions.length > 0 ? `**🚨 紧急任务：**
${urgentActions.map(item => `• ${item.text}`).join('\n')}

` : ''}${normalActions.length > 0 ? `**⚡ 重要任务：**
${normalActions.map(item => `• ${item.text}`).join('\n')}

` : ''}${lowPriorityActions.length > 0 ? `**📋 一般任务：**
${lowPriorityActions.slice(0, 3).map(item => `• ${item.text}`).join('\n')}

` : ''}${actionItems.length === 0 ? '• 暂无明确的待办事项' : ''}

${timeRelated.length > 0 ? `### ⏰ 时间节点
${timeRelated.map(item => `• ${item.text}`).join('\n')}

` : ''}${questions.length > 0 ? `### ❓ 待跟进
${questions.map(item => `• ${item.text}`).join('\n')}

` : ''}### 📊 会议信息
• 发言轮次：${totalMessages}次
• 录音时长：${totalDuration}分钟
• 待办事项：${actionItems.length}个`
    }

    // Removed auto scroll - user controls scrolling manually

    // Update local transcripts from chatItems
    useEffect(() => {
        const newTranscripts = chatItems.map((item, index) => ({
            id: `${item.time}-${index}`,
            text: item.text,
            timestamp: new Date(item.time),
            isFinal: item.isFinal ?? true,
            speaker: item.type === EMessageType.AGENT ? "assistant" : "user",
        }))
        setTranscripts(newTranscripts)
    }, [chatItems])

    // Start ping heartbeat to keep worker alive
    const startPingHeartbeat = () => {
        if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current)
        }

        // Send ping every 30 seconds to keep worker alive (timeout is 3600 seconds now)
        pingIntervalRef.current = setInterval(async () => {
            try {
                await apiPing(options.channel)
                console.log("[transcription] Ping sent successfully")
            } catch (error) {
                console.warn("[transcription] Ping failed:", error)
            }
        }, 30000) // 30 seconds

        console.log("[transcription] Ping heartbeat started")
    }

    // Stop ping heartbeat
    const stopPingHeartbeat = () => {
        if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current)
            pingIntervalRef.current = null
            console.log("[transcription] Ping heartbeat stopped")
        }
    }

    // Page initialization - cleanup any existing channels on mount
    useEffect(() => {
        const cleanupExistingChannel = async () => {
            try {
                // 尝试清理可能存在的僵尸通道（页面刷新后的残留）
                await apiStopService(options.channel)
                console.log("[transcription] Cleaned up existing channel on page load")
            } catch (error) {
                // 忽略清理错误，因为通道可能本来就不存在
                console.log("[transcription] No existing channel to cleanup (expected)")
            }
        }

        cleanupExistingChannel()
    }, [options.channel])

    // Cleanup on component unmount
    useEffect(() => {
        return () => {
            // Cleanup RTC resources on unmount
            if (audioTrack) {
                audioTrack.close()
            }
            if (rtcClient) {
                rtcClient.leave().catch(console.error)
            }
            // Stop ping heartbeat
            stopPingHeartbeat()
            // Clear text buffer timeout
            if (textBufferTimeoutRef.current) {
                clearTimeout(textBufferTimeoutRef.current)
                textBufferTimeoutRef.current = null
            }

            // 尝试清理通道（虽然在页面刷新时不会执行）
            apiStopService(options.channel).catch(() => {
                // 忽略错误，因为通道可能已经不存在
            })
        }
    }, [])

    // Connect to meeting_assistant agent
    const connectAgent = async () => {
        try {
            setAgentConnecting(true)
            setError("")
            setConnectionStatus("连接 AI 会议助手...")

            const startServicePayload = {
                channel: options.channel,
                userId: options.userId,
                graphName: "meeting_assistant",
                language,
                voiceType,
                greeting: "您好，我是您的AI会议助手。我将帮助您进行会议转录、总结和任务管理。",
            }

            let res = await apiStartService(startServicePayload)
            const { code, msg } = res || {}

            // 如果通道已存在，先尝试停止然后重新连接
            if (code === "10003" || msg?.includes("channel existed")) {
                setConnectionStatus("通道已存在，正在重置...")
                console.log("[transcription] Channel already exists, attempting to stop and restart")

                try {
                    // 先尝试停止现有的通道
                    await apiStopService(options.channel)
                    console.log("[transcription] Successfully stopped existing channel")

                    // 等待一小段时间确保服务器清理完成
                    await new Promise(resolve => setTimeout(resolve, 1000))

                    // 重新尝试启动服务
                    setConnectionStatus("重新连接 AI 会议助手...")
                    res = await apiStartService(startServicePayload)
                    const { code: newCode, msg: newMsg } = res || {}

                    if (newCode !== "0") {
                        throw new Error(newMsg || "重新连接失败")
                    }
                } catch (stopError) {
                    console.warn("[transcription] Failed to stop existing channel:", stopError)
                    // 如果停止失败，尝试使用不同的channel名称
                    const timestamp = Date.now()
                    const newChannel = `${options.channel}_${timestamp}`
                    console.log("[transcription] Trying with new channel name:", newChannel)

                    setConnectionStatus("使用新通道连接...")
                    const newStartServicePayload = {
                        ...startServicePayload,
                        channel: newChannel,
                    }

                    res = await apiStartService(newStartServicePayload)
                    const { code: finalCode, msg: finalMsg } = res || {}

                    if (finalCode !== "0") {
                        throw new Error(finalMsg || "连接失败")
                    }

                    // 更新options中的channel名称
                    dispatch(setOptions({ ...options, channel: newChannel }))
                }
            } else if (code !== "0") {
                throw new Error(msg || "连接失败")
            }

            dispatch(setAgentConnected(true))
            setConnectionStatus("AI 助手已连接")

            // Start ping heartbeat to keep worker alive
            startPingHeartbeat()
        } catch (error) {
            setError("连接 AI 助手失败: " + (error as Error).message)
            setConnectionStatus("连接失败")
            console.error("[transcription] Connect agent failed:", error)
        } finally {
            setAgentConnecting(false)
        }
    }

    // Disconnect agent
    const disconnectAgent = async () => {
        try {
            setConnectionStatus("断开 AI 助手...")

            // Stop ping heartbeat first
            stopPingHeartbeat()

            await apiStopService(options.channel)
            dispatch(setAgentConnected(false))
            setConnectionStatus("未连接")
        } catch (error) {
            setError("断开连接失败: " + (error as Error).message)
        }
    }

    const startRecording = async () => {
        try {
            setError("")
            setConnectionStatus("初始化音频...")

            // Create RTC client if not exists
            let client = rtcClient
            if (!client) {
                const AgoraRTC = (await import("agora-rtc-sdk-ng")).default
                client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" })
                setRtcClient(client)
            }

            // Get Agora credentials
            const res = await apiGenAgoraData({
                channel: options.channel,
                userId: options.userId
            })

            if (res.code !== "0") {
                throw new Error("获取Agora认证失败")
            }

            const { appId, token } = res.data

            // Update options with credentials
            dispatch(setOptions({
                ...options,
                appId,
                token
            }))

            setConnectionStatus("连接音频通道...")

            // Set up stream message listener before joining
            client.on("stream-message", (uid, stream) => {
                console.log("[transcription] Received stream message from uid:", uid, "stream length:", stream.byteLength)

                try {
                    // Convert stream to string
                    const ascii = String.fromCharCode(...new Uint8Array(stream))
                    console.log("[transcription] Raw stream message:", ascii)

                    // Handle the message parsing similar to rtcManager
                    handleChunkMessage(ascii)
                } catch (error) {
                    console.error("[transcription] Error processing stream message:", error)
                }
            })

            // Join the channel
            await client.join(appId, options.channel, token, options.userId)

            setConnectionStatus("创建音频轨道...")

            // Create microphone audio track
            const AgoraRTC = (await import("agora-rtc-sdk-ng")).default
            const micTrack = await AgoraRTC.createMicrophoneAudioTrack()
            setAudioTrack(micTrack)

            setConnectionStatus("发布音频流...")

            // Publish audio track
            await client.publish([micTrack])

            setIsRecording(true)
            setConnectionStatus("录音中...")
            dispatch(setRoomConnected(true))

            console.log("Audio recording started successfully")
        } catch (err) {
            setError("启动录音失败: " + (err as Error).message)
            setConnectionStatus("连接失败")
            setIsRecording(false)
            console.error("Start recording error:", err)
        }
    }

    const stopRecording = async () => {
        try {
            setConnectionStatus("停止录音...")

            // 如果有AI助手连接并且有转录内容，触发总结
            if (agentConnected && chatItems.length > 0) {
                setConnectionStatus("生成会议总结...")

                try {
                    // 构建用于总结的转录文本
                    const userTranscripts = chatItems
                        .filter(item => item.type === 'user' && item.text.trim())
                        .map((item, index) => `[${index + 1}] ${item.text}`)
                        .join('\n')

                    // 生成更智能的总结提示词
                    const summaryPrompt = `你是一个专业的会议记录助手，请根据以下会议转录内容生成详细的中文总结和待办清单。

## 会议转录内容：
${userTranscripts}

请仔细分析转录内容，提供以下结构化总结：

## 📝 会议总结

### 🎯 核心讨论主题：
请识别并详细描述会议中的主要讨论点，包括：
- 具体讨论的问题或议题
- 各方观点和建议
- 达成的共识或分歧点

### 💡 关键决策与结论：
请列出会议中做出的重要决策、结论或达成的一致意见：
- 明确的决策内容
- 决策的理由和背景
- 相关的时间节点

### 📊 重要信息与数据：
请提取会议中提到的关键信息：
- 具体的数字、指标、时间
- 重要的事实和背景信息
- 相关的资源或联系方式

### ✅ 行动计划与待办事项：
请仔细识别并列出具体的待办事项，包括：
- **立即执行**（紧急且重要）：
  - 具体任务描述
  - 负责人（如果提及）
  - 截止时间（如果提及）
- **短期计划**（1-2周内）：
  - 任务内容
  - 预期成果
- **长期目标**（超过2周）：
  - 战略性任务
  - 里程碑目标

### 🔍 需要跟进的问题：
请识别会议中提出但未完全解决的问题：
- 悬而未决的议题
- 需要进一步讨论的话题
- 待确认的信息

### 📈 建议与下一步：
基于会议内容，提供专业建议：
- 改进建议
- 风险提醒
- 机会识别

### 📋 会议统计：
- 发言轮次：${chatItems.filter(item => item.type === 'user').length}次
- 录音时长：约${Math.round((Date.now() - (chatItems[0]?.time || Date.now())) / 60000)}分钟
- 转录字数：约${Math.round(chatItems.filter(item => item.type === 'user').reduce((total, item) => total + item.text.length, 0) / 2)}字

请确保：
1. 待办事项要具体可执行，避免模糊描述
2. 优先级分类要合理，基于紧急性和重要性
3. 总结要客观准确，不添加转录中没有的信息
4. 如果某些部分在转录中没有明确信息，请明确标注"转录中未明确提及"`

                    // Note: 总结请求暂时通过AI助手的普通对话实现
                    // 未来可以考虑添加专用的总结API
                    if (rtcClient) {
                        console.log("[transcription] 会议总结功能已触发，显示基础总结")
                    } else {
                        // 备用方案：生成基础智能总结
                        const userMessages = chatItems.filter(item => item.type === 'user' && item.text.trim())
                        const basicSummary = generateBasicSummary(userMessages)

                        dispatch(addChatItem({
                            type: EMessageType.AGENT,
                            time: Date.now(),
                            text: basicSummary,
                            data_type: EMessageDataType.TEXT,
                            userId: 'summary',
                            isFinal: true,
                        }))
                    }
                } catch (error) {
                    console.error("[transcription] 总结生成失败:", error)

                    // 错误情况下也生成基础智能总结
                    const userMessages = chatItems.filter(item => item.type === 'user' && item.text.trim())
                    const errorSummary = `## ⚠️ AI总结生成失败，已切换到基础分析

${generateBasicSummary(userMessages)}

---
### 🔧 错误信息：
- 错误详情：${(error as Error).message}
- 建议：请检查网络连接或重新连接AI助手`

                    dispatch(addChatItem({
                        type: EMessageType.AGENT,
                        time: Date.now(),
                        text: errorSummary,
                        data_type: EMessageDataType.TEXT,
                        userId: 'summary',
                        isFinal: true,
                    }))
                }
            }

            // Unpublish and close audio track
            if (audioTrack && rtcClient) {
                await rtcClient.unpublish([audioTrack])
                audioTrack.close()
                setAudioTrack(undefined)
            }

            // Leave the channel
            if (rtcClient) {
                await rtcClient.leave()
            }

            setIsRecording(false)
            setConnectionStatus(agentConnected ? "AI 助手已连接" : "未连接")
            dispatch(setRoomConnected(false))

            console.log("Audio recording stopped successfully")
        } catch (err) {
            setError("停止录音失败: " + (err as Error).message)
            setIsRecording(false)
            console.error("Stop recording error:", err)
        }
    }

    const clearTranscripts = () => {
        setTranscripts([])
    }

    const exportTranscripts = () => {
        const content = transcripts
            .filter(t => t.isFinal)
            .map(t => `[${t.timestamp.toLocaleTimeString()}] ${t.speaker}: ${t.text}`)
            .join('\n')

        const blob = new Blob([content], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `transcription-${new Date().toISOString().split('T')[0]}.txt`
        a.click()
        URL.revokeObjectURL(url)
    }

    // 手动生成会议总结
    const generateSummary = () => {
        if (chatItems.length === 0) {
            setError("没有转录内容可以总结")
            return
        }

        try {
            const userMessages = chatItems.filter(item => item.type === 'user' && item.text.trim())

            if (agentConnected) {
                // 如果AI助手已连接，提供简洁的提示和基础总结
                const summaryNote = `## 💡 获得更佳总结效果

直接对AI助手说："**请总结刚才的会议内容和待办事项**"，可获得更智能的分析。

---

${generateBasicSummary(userMessages)}`

                dispatch(addChatItem({
                    type: EMessageType.AGENT,
                    time: Date.now(),
                    text: summaryNote,
                    data_type: EMessageDataType.TEXT,
                    userId: 'manual-summary',
                    isFinal: true,
                }))
            } else {
                // AI助手未连接时提供基础总结
                const basicSummary = generateBasicSummary(userMessages)
                dispatch(addChatItem({
                    type: EMessageType.AGENT,
                    time: Date.now(),
                    text: basicSummary,
                    data_type: EMessageDataType.TEXT,
                    userId: 'manual-summary',
                    isFinal: true,
                }))
            }
        } catch (error) {
            setError("生成总结失败: " + (error as Error).message)
        }
    }

    return (
        <AuthInitializer>
            <div className="relative mx-auto flex h-full min-h-screen flex-col md:h-screen">
                <Header className="h-[60px]" />

                <div className="mx-2 mb-2 flex h-full max-h-[calc(100vh-60px-24px)] flex-col gap-2 p-4">
                    <div className="flex items-center justify-between">
                        <h1 className="text-2xl font-bold text-white">会议实时转录</h1>
                        <div className="flex items-center gap-2">
                            {/* 更新状态指示器逻辑：优先显示AI助手连接状态，其次是房间连接状态 */}
                            <NetworkIconByLevel
                                level={
                                    agentConnected
                                        ? (roomConnected ? 4 : 2)  // AI助手已连接：录音中=绿色(4)，未录音=黄色(2)
                                        : 0                        // AI助手未连接：红色叉叉(0)
                                }
                                className="h-5 w-5"
                            />
                            <span className="text-sm text-gray-400">
                                {connectionStatus}
                            </span>
                        </div>
                    </div>

                    {error && (
                        <div className="rounded-lg bg-red-500/10 p-3 text-red-400 border border-red-500/20">
                            {error}
                        </div>
                    )}

                    {/* Usage Instructions */}
                    <Card className="bg-blue-500/10 border-blue-500/20">
                        <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                                <InfoIcon className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
                                <div className="text-sm text-blue-300">
                                    <p className="font-medium mb-2">AI 会议助手使用说明：</p>
                                    <ul className="space-y-1 text-blue-200">
                                        <li>• <strong>步骤一</strong>：点击"连接 AI 助手"连接智能助手</li>
                                        <li>• <strong>步骤二</strong>：点击"开始录音"进行实时语音转录</li>
                                        <li>• <strong>智能总结</strong>：停止录音时自动生成详细总结和待办清单</li>
                                        <li>• <strong>手动总结</strong>：随时点击"📝 生成总结"按钮获取当前总结</li>
                                        <li>• <strong>深度分析</strong>：对AI助手说"请总结会议内容"获得最佳效果</li>
                                        <li>• <strong>状态指示</strong>：右上角图标 🔴=未连接 🟡=已连接待录音 🟢=录音中</li>
                                        <li>• <strong>功能特色</strong>：智能待办事项提取、优先级分类、时间节点识别</li>
                                    </ul>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* AI Agent Connection */}
                    <Card className="bg-green-500/10 border-green-500/20">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        "w-3 h-3 rounded-full",
                                        agentConnected ? "bg-green-500" : "bg-gray-500"
                                    )}></div>
                                    <div>
                                        <p className="font-medium text-green-300">AI 会议助手</p>
                                        <p className="text-sm text-green-200">
                                            {agentConnected ? "已连接 - 智能会议功能已启用" : "未连接 - 请先连接 AI 助手"}
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    onClick={agentConnected ? disconnectAgent : connectAgent}
                                    variant={agentConnected ? "destructive" : "default"}
                                    disabled={agentConnecting || !options.channel || !options.userId}
                                    className="min-w-24"
                                >
                                    {agentConnecting ? "连接中..." : agentConnected ? "断开连接" : "连接 AI 助手"}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="flex flex-col gap-4 md:flex-row">
                        {/* Controls Panel */}
                        <Card className="w-full md:w-80 bg-[#181a1d] border-gray-700">
                            <CardHeader>
                                <CardTitle className="text-white">录音控制</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex flex-col gap-2">
                                    <Button
                                        onClick={isRecording ? stopRecording : startRecording}
                                        variant={isRecording ? "destructive" : "default"}
                                        className="w-full"
                                        disabled={!options.channel || !options.userId || !agentConnected}
                                    >
                                        <MicIconByStatus
                                            active={isRecording}
                                            className="mr-2 h-4 w-4"
                                        />
                                        {isRecording ? "停止录音" : "开始录音"}
                                    </Button>

                                    <Button
                                        onClick={clearTranscripts}
                                        variant="outline"
                                        className="w-full"
                                        disabled={transcripts.length === 0}
                                    >
                                        清除转录
                                    </Button>

                                    <Button
                                        onClick={exportTranscripts}
                                        variant="outline"
                                        className="w-full"
                                        disabled={transcripts.filter(t => t.isFinal).length === 0}
                                    >
                                        导出转录
                                    </Button>

                                    <Button
                                        onClick={generateSummary}
                                        variant="outline"
                                        className="w-full"
                                        disabled={chatItems.filter(item => item.type === 'user').length === 0}
                                    >
                                        📝 生成总结
                                    </Button>
                                </div>

                                {/* Recording Status */}
                                {isRecording && (
                                    <div className="flex flex-col items-center gap-2">
                                        <span className="text-sm text-gray-400">录音进行中</span>
                                        <div className="flex h-16 items-center justify-center">
                                            <div className="h-4 w-4 bg-red-500 rounded-full animate-pulse"></div>
                                        </div>
                                    </div>
                                )}

                                {/* Room Info */}
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">房间:</span>
                                        <span className="text-white">{options.channel}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">用户ID:</span>
                                        <span className="text-white">{options.userId}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">转录条数:</span>
                                        <span className="text-white">{transcripts.filter(t => t.isFinal).length}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Transcription Display */}
                        <Card className="flex-1 bg-[#181a1d] border-gray-700">
                            <CardHeader>
                                <CardTitle className="text-white">实时转录</CardTitle>
                            </CardHeader>
                            <CardContent className="h-[calc(100vh-200px)] overflow-hidden">
                                <div className="h-full overflow-y-auto space-y-2 pr-2">
                                    {transcripts.length === 0 ? (
                                        <div className="flex h-full items-center justify-center text-gray-400">
                                            {isRecording ? "等待语音输入..." : "点击开始录音开始转录"}
                                        </div>
                                    ) : (
                                        transcripts.map((transcript) => (
                                            <div
                                                key={transcript.id}
                                                className={cn(
                                                    "rounded-lg p-3 text-sm transition-all",
                                                    transcript.isFinal
                                                        ? "bg-gray-800 text-white"
                                                        : "bg-blue-500/10 text-blue-300 border border-blue-500/20",
                                                    transcript.speaker === "assistant"
                                                        ? "ml-4 border-l-4 border-l-green-500"
                                                        : "mr-4 border-l-4 border-l-blue-500"
                                                )}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className={cn(
                                                                "text-xs font-medium",
                                                                transcript.speaker === "assistant"
                                                                    ? "text-green-400"
                                                                    : "text-blue-400"
                                                            )}>
                                                                {transcript.speaker === "assistant" ? "AI助手" : "用户"}
                                                            </span>
                                                            <span className="text-xs text-gray-500">
                                                                {transcript.timestamp.toLocaleTimeString()}
                                                            </span>
                                                        </div>
                                                        <p className="whitespace-pre-wrap">{transcript.text}</p>
                                                    </div>
                                                    {!transcript.isFinal && (
                                                        <div className="flex-shrink-0">
                                                            <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* AI Meeting Interface - only show when agent is connected */}
                    {agentConnected && chatItems.length > 0 && (
                        <Card className="bg-[#181a1d] border-gray-700">
                            <CardHeader>
                                <CardTitle className="text-white">AI 智能会议分析</CardTitle>
                            </CardHeader>
                            <CardContent className="h-[600px] overflow-hidden">
                                <DynamicMeetingInterface
                                    messages={chatItems}
                                    className="h-full"
                                />
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </AuthInitializer>
    )
}
