"use client"

import { useEffect, useState, useRef } from "react"
import { apiStartService, apiStopService, apiGenAgoraData } from "@/common/request"
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
import AgoraRTC, { IAgoraRTCClient, IMicrophoneAudioTrack } from "agora-rtc-sdk-ng"

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
                        const textItem = {
                            type: isAgent ? EMessageType.AGENT : EMessageType.USER,
                            time: text_ts || Date.now(),
                            text: text,
                            data_type: EMessageDataType.TEXT,
                            userId: stream_id,
                            isFinal: is_final,
                        }

                        dispatch(addChatItem(textItem))
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

    // Removed auto scroll - user controls scrolling manually

    // Update local transcripts from chatItems
    useEffect(() => {
        const newTranscripts = chatItems.map((item, index) => ({
            id: `${item.time}-${index}`,
            text: item.text,
            timestamp: new Date(item.time),
            isFinal: item.isFinal,
            speaker: item.type === EMessageType.AGENT ? "assistant" : "user",
        }))
        setTranscripts(newTranscripts)
    }, [chatItems])

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

            const res = await apiStartService(startServicePayload)
            const { code, msg } = res || {}

            if (code !== "0") {
                throw new Error(msg || "连接失败")
            }

            dispatch(setAgentConnected(true))
            setConnectionStatus("AI 助手已连接")
        } catch (error) {
            setError("连接 AI 助手失败: " + (error as Error).message)
            setConnectionStatus("连接失败")
        } finally {
            setAgentConnecting(false)
        }
    }

    // Disconnect agent
    const disconnectAgent = async () => {
        try {
            setConnectionStatus("断开 AI 助手...")
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

    return (
        <AuthInitializer>
            <div className="relative mx-auto flex h-full min-h-screen flex-col md:h-screen">
                <Header className="h-[60px]" />

                <div className="mx-2 mb-2 flex h-full max-h-[calc(100vh-60px-24px)] flex-col gap-2 p-4">
                    <div className="flex items-center justify-between">
                        <h1 className="text-2xl font-bold text-white">会议实时转录</h1>
                        <div className="flex items-center gap-2">
                            <NetworkIconByLevel level={roomConnected ? 4 : 0} className="h-5 w-5" />
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
                                        <li>• 第一步：点击"连接 AI 助手"连接到会议助手</li>
                                        <li>• 第二步：点击"开始录音"开始实时语音转文字</li>
                                        <li>• AI 助手会自动生成会议总结、提取行动项</li>
                                        <li>• 支持实时总结、智能任务识别、会议纪要导出</li>
                                        <li>• 可以查看实时转录和智能会议分析</li>
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
