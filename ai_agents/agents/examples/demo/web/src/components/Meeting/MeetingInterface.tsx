"use client"

import * as React from "react"
import { useAppSelector } from "@/common"
import { IChatItem } from "@/types"
import MeetingControlPanel from "./MeetingControlPanel"
import MeetingTranscript from "./MeetingTranscript"
import MeetingSummary from "./MeetingSummary"
import { cn } from "@/lib/utils"

interface MeetingInterfaceProps {
  className?: string
  messages: IChatItem[]
}

export default function MeetingInterface({
  className,
  messages = []
}: MeetingInterfaceProps) {
  const agentConnected = useAppSelector((state) => state.global.agentConnected)
  const channel = useAppSelector((state) => state.global.options.channel)
  const userId = useAppSelector((state) => state.global.options.userId)

  // Meeting state
  const [isMeetingActive, setIsMeetingActive] = React.useState(false)
  const [meetingDuration, setMeetingDuration] = React.useState(0)
  const [meetingStartTime, setMeetingStartTime] = React.useState<number | null>(null)

  // Meeting data extracted from messages
  const meetingData = React.useMemo(() => {
    // Extract participants from messages
    const participantIds = new Set<string>()
    messages.forEach(msg => {
      if (msg.userId) {
        participantIds.add(`User ${msg.userId}`)
      }
    })

    // Add AI Assistant
    participantIds.add("AI Assistant")

    const participants = Array.from(participantIds)

    // Extract summaries and action items from system messages
    const summaryMessages = messages.filter(msg =>
      msg.text.includes('总结') || msg.text.includes('Summary') ||
      msg.text.includes('📝')
    )

    const actionMessages = messages.filter(msg =>
      msg.text.includes('🎯') || msg.text.includes('行动项') ||
      msg.text.includes('Action')
    )

    // Generate mock action items based on action messages
    const actionItems = actionMessages.map((msg, index) => ({
      id: `action-${index}`,
      task: msg.text.replace(/🎯|行动项:|Action Item:|\[.*?\]/g, '').trim(),
      assignee: participants[Math.floor(Math.random() * participants.length)],
      deadline: new Date(Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000).toLocaleDateString(),
      priority: (['high', 'medium', 'low'] as const)[Math.floor(Math.random() * 3)],
      status: (['pending', 'in_progress'] as const)[Math.floor(Math.random() * 2)]
    }))

    // Extract key points from messages
    const keyPoints: string[] = []
    messages.forEach(msg => {
      if (msg.text.length > 50 && !msg.text.includes('[') && msg.text.trim().length > 0) {
        keyPoints.push(msg.text.substring(0, 100) + (msg.text.length > 100 ? '...' : ''))
      }
    })

    // Get latest summary
    const latestSummary = summaryMessages.length > 0 ? summaryMessages[summaryMessages.length - 1].text : ''

    return {
      realTimeSummary: latestSummary || "Meeting is in progress. Summary will be generated automatically every 5 minutes.",
      finalSummary: isMeetingActive ? undefined : latestSummary,
      keyPoints: keyPoints.slice(-5), // Last 5 key points
      actionItems,
      participants,
      duration: meetingDuration,
      nextMeeting: actionItems.length > 0 ? {
        title: "Follow-up Meeting",
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(),
        time: "14:00"
      } : undefined
    }
  }, [messages, meetingDuration, isMeetingActive])

  // Update meeting duration
  React.useEffect(() => {
    let interval: NodeJS.Timeout | null = null

    if (isMeetingActive && meetingStartTime) {
      interval = setInterval(() => {
        setMeetingDuration(Math.floor((Date.now() - meetingStartTime) / 1000))
      }, 1000)
    }

    return () => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [isMeetingActive, meetingStartTime])

  // Auto-start meeting when agent connects and messages start flowing
  React.useEffect(() => {
    if (agentConnected && messages.length > 0 && !isMeetingActive) {
      handleStartMeeting()
    }
  }, [agentConnected, messages.length])

  const handleStartMeeting = () => {
    setIsMeetingActive(true)
    setMeetingStartTime(Date.now())
    console.log("Meeting started")
  }

  const handleEndMeeting = () => {
    setIsMeetingActive(false)
    setMeetingStartTime(null)
    console.log("Meeting ended")
  }

  const handleGenerateSummary = () => {
    console.log("Generating summary...")
    // In a real implementation, this would trigger the backend to generate a summary
  }

  const handleExportMeeting = () => {
    console.log("Exporting meeting data...")
    // In a real implementation, this would export the meeting data
  }

  const handleUpdateActionItem = (id: string, status: any) => {
    console.log(`Updating action item ${id} to ${status}`)
    // In a real implementation, this would update the action item status
  }

  return (
    <div className={cn("grid grid-cols-1 lg:grid-cols-3 gap-4 h-full", className)}>
      {/* Left Column - Control Panel */}
      <div className="lg:col-span-1 space-y-4">
        <MeetingControlPanel
          isConnected={agentConnected}
          isMeetingActive={isMeetingActive}
          participants={meetingData.participants}
          meetingDuration={meetingDuration}
          onStartMeeting={handleStartMeeting}
          onEndMeeting={handleEndMeeting}
          onGenerateSummary={handleGenerateSummary}
          onExportMeeting={handleExportMeeting}
        />

        {/* Summary Panel - shown on smaller screens or as secondary panel */}
        <div className="lg:hidden">
          <MeetingSummary
            summaryData={meetingData}
            onGenerateSummary={handleGenerateSummary}
            onExportSummary={handleExportMeeting}
            onUpdateActionItem={handleUpdateActionItem}
          />
        </div>
      </div>

      {/* Center Column - Transcript */}
      <div className="lg:col-span-1">
        <MeetingTranscript
          messages={messages}
          autoScroll={true}
          className="h-full"
        />
      </div>

      {/* Right Column - Summary (Desktop only) */}
      <div className="hidden lg:block lg:col-span-1">
        <MeetingSummary
          summaryData={meetingData}
          onGenerateSummary={handleGenerateSummary}
          onExportSummary={handleExportMeeting}
          onUpdateActionItem={handleUpdateActionItem}
        />
      </div>
    </div>
  )
}