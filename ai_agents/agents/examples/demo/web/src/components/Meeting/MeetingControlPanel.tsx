"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Play,
  Square,
  Users,
  Clock,
  FileText,
  CheckSquare,
  Calendar,
  Download
} from "lucide-react"
import { cn } from "@/lib/utils"

interface MeetingControlPanelProps {
  className?: string
  isConnected?: boolean
  isMeetingActive?: boolean
  participants?: string[]
  meetingDuration?: number
  onStartMeeting?: () => void
  onEndMeeting?: () => void
  onGenerateSummary?: () => void
  onExportMeeting?: () => void
}

export default function MeetingControlPanel({
  className,
  isConnected = false,
  isMeetingActive = false,
  participants = [],
  meetingDuration = 0,
  onStartMeeting,
  onEndMeeting,
  onGenerateSummary,
  onExportMeeting
}: MeetingControlPanelProps) {
  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">Meeting Control</CardTitle>
          <Badge variant={isMeetingActive ? "default" : "secondary"}>
            {isMeetingActive ? "Active" : "Inactive"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Meeting Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Duration:</span>
          </div>
          <span className="text-sm text-muted-foreground">
            {formatDuration(meetingDuration)}
          </span>
        </div>

        {/* Participants */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Participants:</span>
          </div>
          <span className="text-sm text-muted-foreground">
            {participants.length}
          </span>
        </div>

        {participants.length > 0 && (
          <div className="space-y-1">
            {participants.map((participant, index) => (
              <div key={index} className="text-xs text-muted-foreground pl-6">
                • {participant}
              </div>
            ))}
          </div>
        )}

        <Separator />

        {/* Control Buttons */}
        <div className="space-y-2">
          {!isMeetingActive ? (
            <Button
              onClick={onStartMeeting}
              disabled={!isConnected}
              className="w-full"
              size="sm"
            >
              <Play className="h-4 w-4 mr-2" />
              Start Meeting
            </Button>
          ) : (
            <Button
              onClick={onEndMeeting}
              variant="destructive"
              className="w-full"
              size="sm"
            >
              <Square className="h-4 w-4 mr-2" />
              End Meeting
            </Button>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={onGenerateSummary}
              disabled={!isMeetingActive}
              variant="outline"
              size="sm"
            >
              <FileText className="h-4 w-4 mr-1" />
              Summary
            </Button>

            <Button
              onClick={onExportMeeting}
              disabled={!isMeetingActive}
              variant="outline"
              size="sm"
            >
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
          </div>
        </div>

        {/* Meeting Features */}
        <div className="pt-2 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            AI Features Active:
          </div>
          <div className="space-y-1">
            <div className="flex items-center space-x-2 text-xs">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>Real-time Transcription</span>
            </div>
            <div className="flex items-center space-x-2 text-xs">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>Action Item Detection</span>
            </div>
            <div className="flex items-center space-x-2 text-xs">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>Auto Summary (5min)</span>
            </div>
            <div className="flex items-center space-x-2 text-xs">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>Smart Scheduling</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}