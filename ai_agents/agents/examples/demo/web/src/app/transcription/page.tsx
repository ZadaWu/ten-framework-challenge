"use client"

import { useEffect, useState, useRef } from "react"
import { apiStartService, apiStopService } from "@/common/request"
import { useDispatch, useSelector } from "react-redux"
import type { AppDispatch, RootState } from "@/store"
import Header from "@/components/Layout/Header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InfoIcon } from "@/components/Icon"
import { MicIconByStatus, NetworkIconByLevel } from "@/components/Icon"
import { cn } from "@/lib/utils"
import { setRoomConnected, setAgentConnected, addChatItem } from "@/store/reducers/global"
import dynamic from "next/dynamic"

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

    // const [rtcManager] = useState(() => new RtcManager())
    const [transcripts, setTranscripts] = useState<TranscriptItem[]>([])
    const [isRecording, setIsRecording] = useState(false)
    // const [audioTrack, setAudioTrack] = useState<IMicrophoneAudioTrack>()
    const [error, setError] = useState<string>("")
    const [connectionStatus, setConnectionStatus] = useState<string>("未连接")
    const [agentConnecting, setAgentConnecting] = useState(false)

    const transcriptsEndRef = useRef<HTMLDivElement>(null)

    // Auto scroll to bottom - custom implementation
    useEffect(() => {
        if (transcriptsEndRef.current) {
            transcriptsEndRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [transcripts])

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
            setIsRecording(true)
            setConnectionStatus("录音中...")
            dispatch(setRoomConnected(true))
        } catch (err) {
            setError("启动录音失败: " + (err as Error).message)
            setConnectionStatus("连接失败")
            console.error("Start recording error:", err)
        }
    }

    const stopRecording = async () => {
        try {
            setIsRecording(false)
            setConnectionStatus(agentConnected ? "AI 助手已连接" : "未连接")
            dispatch(setRoomConnected(false))
        } catch (err) {
            setError("停止录音失败: " + (err as Error).message)
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
                                    <div ref={transcriptsEndRef} />
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
