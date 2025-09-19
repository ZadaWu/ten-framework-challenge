"use client"

import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { IChatItem, EMessageType, EMessageDataType } from "@/types"
import { cn } from "@/lib/utils"
import {
  User,
  Bot,
  Clock,
  Volume2,
  VolumeX,
  Users,
  AlertCircle,
  Calendar,
  FileText
} from "lucide-react"

interface MeetingTranscriptProps {
  className?: string
  messages: IChatItem[]
  autoScroll?: boolean
}

interface TranscriptItem {
  id: string
  timestamp: number
  speaker: string
  content: string
  type: 'user' | 'assistant' | 'system'
  isFinal: boolean
  messageType?: 'transcript' | 'summary' | 'action' | 'notification'
}

export default function MeetingTranscript({
  className,
  messages = [],
  autoScroll = true
}: MeetingTranscriptProps) {
  const scrollAreaRef = React.useRef<HTMLDivElement>(null)

  // Convert IChatItem to TranscriptItem format
  const transcriptItems: TranscriptItem[] = React.useMemo(() => {
    return messages.map((msg, index) => {
      let messageType: 'transcript' | 'summary' | 'action' | 'notification' = 'transcript'

      // Detect message type based on content
      if (msg.text.includes('[') && (msg.text.includes('总结') || msg.text.includes('Summary'))) {
        messageType = 'summary'
      } else if (msg.text.includes('🎯') || msg.text.includes('行动项') || msg.text.includes('Action')) {
        messageType = 'action'
      } else if (msg.text.includes('[') && (msg.text.includes('会议') || msg.text.includes('Meeting'))) {
        messageType = 'notification'
      }

      return {
        id: `${msg.time}-${index}`,
        timestamp: msg.time,
        speaker: msg.type === EMessageType.AGENT ? 'AI Assistant' : `User ${msg.userId}`,
        content: msg.text,
        type: msg.type === EMessageType.AGENT ? 'assistant' :
              msg.type === EMessageType.USER ? 'user' : 'system',
        isFinal: msg.isFinal,
        messageType
      }
    })
  }, [messages])

  // Auto scroll to bottom
  React.useEffect(() => {
    if (autoScroll && scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight
      }
    }
  }, [transcriptItems, autoScroll])

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const getMessageIcon = (type: string, messageType: string) => {
    if (messageType === 'summary') return <FileText className="h-4 w-4" />
    if (messageType === 'action') return <AlertCircle className="h-4 w-4" />
    if (messageType === 'notification') return <Calendar className="h-4 w-4" />

    switch (type) {
      case 'user':
        return <User className="h-4 w-4" />
      case 'assistant':
        return <Bot className="h-4 w-4" />
      case 'system':
        return <Users className="h-4 w-4" />
      default:
        return <User className="h-4 w-4" />
    }
  }

  const getMessageBadgeColor = (messageType: string) => {
    switch (messageType) {
      case 'summary':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
      case 'action':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300'
      case 'notification':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
    }
  }

  return (
    <Card className={cn("flex flex-col h-full", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">Meeting Transcript</CardTitle>
          <div className="flex items-center space-x-2">
            <Badge variant="outline" className="text-xs">
              {transcriptItems.length} messages
            </Badge>
            {autoScroll && (
              <Volume2 className="h-4 w-4 text-green-500" />
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea ref={scrollAreaRef} className="h-full px-4 pb-4">
          <div className="space-y-3">
            {transcriptItems.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <VolumeX className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No transcript available</p>
                <p className="text-xs mt-1">Start speaking to see live transcription</p>
              </div>
            ) : (
              transcriptItems.map((item, index) => (
                <div key={item.id} className="space-y-2">
                  <div className={cn(
                    "flex items-start space-x-3 p-3 rounded-lg",
                    item.type === 'user'
                      ? "bg-blue-50 dark:bg-blue-950/30"
                      : item.type === 'assistant'
                      ? "bg-gray-50 dark:bg-gray-900/30"
                      : "bg-yellow-50 dark:bg-yellow-950/30",
                    !item.isFinal && "opacity-70 border-l-4 border-yellow-400"
                  )}>
                    <div className="flex-shrink-0 mt-1">
                      {getMessageIcon(item.type, item.messageType)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-medium">
                            {item.speaker}
                          </span>
                          {item.messageType !== 'transcript' && (
                            <Badge
                              variant="secondary"
                              className={cn("text-xs", getMessageBadgeColor(item.messageType))}
                            >
                              {item.messageType.charAt(0).toUpperCase() + item.messageType.slice(1)}
                            </Badge>
                          )}
                          {!item.isFinal && (
                            <Badge variant="outline" className="text-xs">
                              Interim
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>{formatTimestamp(item.timestamp)}</span>
                        </div>
                      </div>

                      <p className={cn(
                        "text-sm whitespace-pre-wrap",
                        !item.isFinal && "italic"
                      )}>
                        {item.content}
                      </p>
                    </div>
                  </div>

                  {index < transcriptItems.length - 1 && (
                    <Separator className="my-2" />
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}