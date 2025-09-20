"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MicIconByStatus } from "@/components/Icon"
import { cn } from "@/lib/utils"

interface TranscriptItem {
    id: string
    text: string
    timestamp: Date
    isFinal: boolean
    speaker: "user" | "assistant"
    confidence?: number
}

interface ClientSideRecordingProps {
    onTranscriptUpdate?: (transcripts: TranscriptItem[]) => void
    onSummaryGenerated?: (summary: string) => void
    className?: string
}

export default function ClientSideRecording({
    onTranscriptUpdate,
    onSummaryGenerated,
    className
}: ClientSideRecordingProps) {
    const [isRecording, setIsRecording] = useState(false)
    const [transcripts, setTranscripts] = useState<TranscriptItem[]>([])
    const [error, setError] = useState<string>("")
    const [isSupported, setIsSupported] = useState(false)
    const [connectionStatus, setConnectionStatus] = useState<string>("未初始化")

    const recognitionRef = useRef<SpeechRecognition | null>(null)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const streamRef = useRef<MediaStream | null>(null)

    // Check for Web Speech API support
    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
        if (SpeechRecognition) {
            setIsSupported(true)
            setConnectionStatus("Web Speech API 支持")
        } else {
            setIsSupported(false)
            setConnectionStatus("浏览器不支持 Web Speech API")
            setError("您的浏览器不支持语音识别功能。请使用 Chrome 或 Edge 浏览器。")
        }
    }, [])

    // Setup speech recognition
    const setupSpeechRecognition = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
        if (!SpeechRecognition) return null

        const recognition = new SpeechRecognition()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = 'zh-CN' // Chinese language
        recognition.maxAlternatives = 1

        recognition.onstart = () => {
            console.log('[ClientSideRecording] Speech recognition started')
            setConnectionStatus("语音识别已启动")
        }

        recognition.onresult = (event) => {
            let interimTranscript = ''
            let finalTranscript = ''

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript
                const confidence = event.results[i][0].confidence

                if (event.results[i].isFinal) {
                    finalTranscript += transcript
                } else {
                    interimTranscript += transcript
                }
            }

            if (finalTranscript) {
                const newTranscript: TranscriptItem = {
                    id: `${Date.now()}-${Math.random()}`,
                    text: finalTranscript.trim(),
                    timestamp: new Date(),
                    isFinal: true,
                    speaker: "user",
                    confidence: event.results[event.resultIndex]?.[0]?.confidence || 1
                }

                setTranscripts(prev => {
                    const updated = [...prev, newTranscript]
                    onTranscriptUpdate?.(updated)
                    return updated
                })

                console.log('[ClientSideRecording] Final transcript:', finalTranscript)
            }

            if (interimTranscript) {
                // Update or add interim transcript
                setTranscripts(prev => {
                    const withoutInterim = prev.filter(t => t.isFinal)
                    const interimItem: TranscriptItem = {
                        id: 'interim',
                        text: interimTranscript.trim(),
                        timestamp: new Date(),
                        isFinal: false,
                        speaker: "user"
                    }
                    const updated = [...withoutInterim, interimItem]
                    onTranscriptUpdate?.(updated)
                    return updated
                })
            }
        }

        recognition.onerror = (event) => {
            console.error('[ClientSideRecording] Speech recognition error:', event.error)
            setError(`语音识别错误: ${event.error}`)

            if (event.error === 'no-speech') {
                setConnectionStatus("未检测到语音")
            } else if (event.error === 'network') {
                setConnectionStatus("网络连接问题")
            } else {
                setConnectionStatus(`识别错误: ${event.error}`)
            }
        }

        recognition.onend = () => {
            console.log('[ClientSideRecording] Speech recognition ended')
            if (isRecording) {
                // Restart recognition if still recording
                setTimeout(() => {
                    try {
                        recognition.start()
                    } catch (e) {
                        console.log('[ClientSideRecording] Recognition restart failed:', e)
                    }
                }, 100)
            }
        }

        return recognition
    }

    // Setup audio recording for backup
    const setupAudioRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            })
            streamRef.current = stream

            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            })

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data)
                }
            }

            mediaRecorder.onstop = () => {
                console.log('[ClientSideRecording] Audio recording stopped')
            }

            mediaRecorderRef.current = mediaRecorder
            return mediaRecorder
        } catch (error) {
            console.error('[ClientSideRecording] Audio setup failed:', error)
            throw error
        }
    }

    const startRecording = async () => {
        try {
            setError("")
            setConnectionStatus("初始化录音...")

            // Setup speech recognition
            const recognition = setupSpeechRecognition()
            if (!recognition) {
                throw new Error("无法初始化语音识别")
            }
            recognitionRef.current = recognition

            // Setup audio recording as backup
            await setupAudioRecording()

            setConnectionStatus("启动语音识别...")

            // Start speech recognition
            recognition.start()

            // Start audio recording
            if (mediaRecorderRef.current) {
                mediaRecorderRef.current.start(1000) // Record in 1-second chunks
            }

            setIsRecording(true)
            setConnectionStatus("录音中 - 请开始说话")

            console.log('[ClientSideRecording] Recording started successfully')
        } catch (error) {
            console.error('[ClientSideRecording] Start recording failed:', error)
            setError(`启动录音失败: ${(error as Error).message}`)
            setConnectionStatus("启动失败")
            setIsRecording(false)
        }
    }

    const stopRecording = async () => {
        try {
            setConnectionStatus("停止录音...")

            // Stop speech recognition
            if (recognitionRef.current) {
                recognitionRef.current.stop()
                recognitionRef.current = null
            }

            // Stop audio recording
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.stop()
            }

            // Stop media stream
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop())
                streamRef.current = null
            }

            setIsRecording(false)
            setConnectionStatus("录音已停止")

            // Generate summary
            if (transcripts.filter(t => t.isFinal).length > 0) {
                generateSummary()
            }

            console.log('[ClientSideRecording] Recording stopped successfully')
        } catch (error) {
            console.error('[ClientSideRecording] Stop recording failed:', error)
            setError(`停止录音失败: ${(error as Error).message}`)
            setIsRecording(false)
        }
    }

    const generateSummary = async () => {
        try {
            setConnectionStatus("生成会议总结...")

            const finalTranscripts = transcripts.filter(t => t.isFinal && t.text.trim())

            if (finalTranscripts.length === 0) {
                setConnectionStatus("无转录内容，跳过总结")
                return
            }

            // Create a client-side summary
            const transcriptText = finalTranscripts
                .map((item, index) => `[${index + 1}] ${item.text}`)
                .join('\n')

            const totalWords = finalTranscripts.reduce((total, item) => total + item.text.length, 0)
            const duration = finalTranscripts.length > 0
                ? Math.round((Date.now() - finalTranscripts[0].timestamp.getTime()) / 60000)
                : 0

            // Basic client-side analysis
            const keyWords = extractKeywords(finalTranscripts.map(t => t.text).join(' '))
            const actionItems = extractActionItems(finalTranscripts.map(t => t.text).join(' '))

            const summary = `## 📝 会议总结报告

### 📊 会议统计
- 📅 会议时间: ${new Date().toLocaleString()}
- ⏱️ 会议时长: 约 ${duration} 分钟
- 💬 发言轮次: ${finalTranscripts.length} 次
- 📝 转录字数: ${totalWords} 字符
- 🎯 平均置信度: ${Math.round((finalTranscripts.reduce((sum, t) => sum + (t.confidence || 1), 0) / finalTranscripts.length) * 100)}%

### 🔑 关键词汇
${keyWords.length > 0 ? keyWords.map(word => `• ${word}`).join('\n') : '• 未识别到关键词汇'}

### ✅ 可能的行动项
${actionItems.length > 0 ? actionItems.map(item => `• ${item}`).join('\n') : '• 未识别到明确的行动项'}

### 📄 完整记录
${finalTranscripts.map((item, index) =>
    `**[${index + 1}]** [${item.timestamp.toLocaleTimeString()}] ${item.text}`
).join('\n\n')}

---
*此总结由客户端智能分析生成，基于浏览器语音识别技术*`

            // Add summary as assistant message
            const summaryItem: TranscriptItem = {
                id: `summary-${Date.now()}`,
                text: summary,
                timestamp: new Date(),
                isFinal: true,
                speaker: "assistant"
            }

            setTranscripts(prev => {
                const updated = [...prev, summaryItem]
                onTranscriptUpdate?.(updated)
                return updated
            })

            onSummaryGenerated?.(summary)
            setConnectionStatus("总结生成完成")

        } catch (error) {
            console.error('[ClientSideRecording] Summary generation failed:', error)
            setError(`总结生成失败: ${(error as Error).message}`)
            setConnectionStatus("总结生成失败")
        }
    }

    // Simple keyword extraction
    const extractKeywords = (text: string): string[] => {
        const keywords: string[] = []
        const commonWords = ['的', '了', '是', '在', '我', '你', '他', '她', '我们', '这', '那', '有', '没有', '就是', '然后', '所以', '但是', '如果', '因为']

        // Split by punctuation and filter
        const words = text.replace(/[。，！？；：""''（）【】]/g, ' ').split(/\s+/)
        const wordCount: { [key: string]: number } = {}

        words.forEach(word => {
            word = word.trim()
            if (word.length > 1 && !commonWords.includes(word)) {
                wordCount[word] = (wordCount[word] || 0) + 1
            }
        })

        // Get top keywords
        Object.entries(wordCount)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 8)
            .forEach(([word, count]) => {
                if (count > 1) {
                    keywords.push(`${word} (${count}次)`)
                }
            })

        return keywords
    }

    // Simple action item extraction
    const extractActionItems = (text: string): string[] => {
        const actionItems: string[] = []
        const actionPatterns = [
            /需要.{1,20}[做处理完成]/g,
            /要.{1,20}[做处理完成]/g,
            /应该.{1,20}[做处理完成]/g,
            /计划.{1,20}/g,
            /安排.{1,20}/g,
            /准备.{1,20}/g,
            /负责.{1,20}/g,
            /跟进.{1,20}/g,
            /确认.{1,20}/g,
            /联系.{1,20}/g
        ]

        actionPatterns.forEach(pattern => {
            const matches = text.match(pattern)
            if (matches) {
                matches.forEach(match => {
                    if (match.length > 3 && match.length < 50) {
                        actionItems.push(match)
                    }
                })
            }
        })

        return [...new Set(actionItems)].slice(0, 10) // Remove duplicates and limit
    }

    const clearTranscripts = () => {
        setTranscripts([])
        onTranscriptUpdate?.([])
    }

    const exportTranscripts = () => {
        const finalTranscripts = transcripts.filter(t => t.isFinal)
        const content = finalTranscripts
            .map(t => `[${t.timestamp.toLocaleTimeString()}] ${t.speaker === 'assistant' ? 'AI助手' : '用户'}: ${t.text}`)
            .join('\n')

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `会议记录-${new Date().toISOString().split('T')[0]}.txt`
        a.click()
        URL.revokeObjectURL(url)
    }

    if (!isSupported) {
        return (
            <Card className={cn("bg-red-500/10 border-red-500/20", className)}>
                <CardContent className="p-6 text-center">
                    <p className="text-red-400 mb-4">您的浏览器不支持Web Speech API</p>
                    <p className="text-red-300 text-sm">
                        请使用 Chrome 或 Edge 浏览器获得最佳体验
                    </p>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className={cn("space-y-4", className)}>
            {/* Status and Controls */}
            <Card className="bg-[#181a1d] border-gray-700">
                <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                        客户端录音系统
                        <div className={cn(
                            "w-3 h-3 rounded-full",
                            isRecording ? "bg-red-500 animate-pulse" : "bg-gray-500"
                        )}></div>
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {error && (
                        <div className="rounded-lg bg-red-500/10 p-3 text-red-400 border border-red-500/20">
                            {error}
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-400">{connectionStatus}</span>
                        <span className="text-sm text-gray-400">
                            转录: {transcripts.filter(t => t.isFinal).length} 条
                        </span>
                    </div>

                    <div className="flex gap-2">
                        <Button
                            onClick={isRecording ? stopRecording : startRecording}
                            variant={isRecording ? "destructive" : "default"}
                            className="flex-1"
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
                            disabled={transcripts.length === 0}
                        >
                            清除
                        </Button>

                        <Button
                            onClick={exportTranscripts}
                            variant="outline"
                            disabled={transcripts.filter(t => t.isFinal).length === 0}
                        >
                            导出
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Transcripts Display */}
            <Card className="bg-[#181a1d] border-gray-700">
                <CardHeader>
                    <CardTitle className="text-white">实时转录</CardTitle>
                </CardHeader>
                <CardContent className="h-[500px] overflow-hidden">
                    <div className="h-full overflow-y-auto space-y-2 pr-2">
                        {transcripts.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-gray-400">
                                {isRecording ? "等待语音输入..." : "点击开始录音"}
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
                                                {transcript.confidence && (
                                                    <span className="text-xs text-gray-500">
                                                        ({Math.round(transcript.confidence * 100)}%)
                                                    </span>
                                                )}
                                            </div>
                                            <div className="whitespace-pre-wrap">{transcript.text}</div>
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
    )
}

// Extend Window interface for TypeScript
declare global {
    interface Window {
        SpeechRecognition: typeof SpeechRecognition
        webkitSpeechRecognition: typeof SpeechRecognition
    }
}