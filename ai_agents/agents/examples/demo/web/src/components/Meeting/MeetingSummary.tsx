"use client"

import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  FileText,
  CheckSquare,
  Calendar,
  Clock,
  User,
  AlertTriangle,
  Download,
  RefreshCw,
  Target,
  Users
} from "lucide-react"
import { cn } from "@/lib/utils"

interface ActionItem {
  id: string
  task: string
  assignee?: string
  deadline?: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'in_progress' | 'completed'
}

interface MeetingSummaryData {
  realTimeSummary?: string
  finalSummary?: string
  keyPoints: string[]
  actionItems: ActionItem[]
  participants: string[]
  duration: number
  nextMeeting?: {
    title: string
    date: string
    time: string
  }
}

interface MeetingSummaryProps {
  className?: string
  summaryData: MeetingSummaryData
  onGenerateSummary?: () => void
  onExportSummary?: () => void
  onUpdateActionItem?: (id: string, status: ActionItem['status']) => void
}

export default function MeetingSummary({
  className,
  summaryData,
  onGenerateSummary,
  onExportSummary,
  onUpdateActionItem
}: MeetingSummaryProps) {
  const getPriorityColor = (priority: ActionItem['priority']) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300'
      case 'low':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
    }
  }

  const getStatusIcon = (status: ActionItem['status']) => {
    switch (status) {
      case 'completed':
        return <CheckSquare className="h-4 w-4 text-green-500" />
      case 'in_progress':
        return <Clock className="h-4 w-4 text-yellow-500" />
      default:
        return <AlertTriangle className="h-4 w-4 text-gray-400" />
    }
  }

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)

    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }

  const pendingActions = summaryData.actionItems.filter(item => item.status === 'pending')
  const inProgressActions = summaryData.actionItems.filter(item => item.status === 'in_progress')
  const completedActions = summaryData.actionItems.filter(item => item.status === 'completed')

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">Meeting Summary</CardTitle>
          <div className="flex items-center space-x-2">
            <Button
              onClick={onGenerateSummary}
              variant="outline"
              size="sm"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Update
            </Button>
            <Button
              onClick={onExportSummary}
              variant="outline"
              size="sm"
            >
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="summary" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="actions">
              Actions ({summaryData.actionItems.length})
            </TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="space-y-4">
            {/* Key Statistics */}
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                <Clock className="h-5 w-5 mx-auto mb-1 text-blue-600" />
                <div className="text-lg font-semibold">{formatDuration(summaryData.duration)}</div>
                <div className="text-xs text-muted-foreground">Duration</div>
              </div>
              <div className="text-center p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                <Users className="h-5 w-5 mx-auto mb-1 text-green-600" />
                <div className="text-lg font-semibold">{summaryData.participants.length}</div>
                <div className="text-xs text-muted-foreground">Participants</div>
              </div>
              <div className="text-center p-3 bg-orange-50 dark:bg-orange-950/30 rounded-lg">
                <Target className="h-5 w-5 mx-auto mb-1 text-orange-600" />
                <div className="text-lg font-semibold">{pendingActions.length}</div>
                <div className="text-xs text-muted-foreground">Action Items</div>
              </div>
            </div>

            <Separator />

            {/* Real-time Summary */}
            {summaryData.realTimeSummary && (
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <FileText className="h-4 w-4 text-blue-600" />
                  <span className="font-medium">Real-time Summary</span>
                  <Badge variant="outline" className="text-xs">Live</Badge>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-gray-900/30 rounded-lg text-sm">
                  {summaryData.realTimeSummary}
                </div>
              </div>
            )}

            {/* Final Summary */}
            {summaryData.finalSummary && (
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <FileText className="h-4 w-4 text-green-600" />
                  <span className="font-medium">Final Summary</span>
                  <Badge variant="outline" className="text-xs">Complete</Badge>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-gray-900/30 rounded-lg text-sm">
                  {summaryData.finalSummary}
                </div>
              </div>
            )}

            {/* Key Points */}
            {summaryData.keyPoints.length > 0 && (
              <div className="space-y-2">
                <span className="font-medium">Key Points</span>
                <ul className="space-y-1">
                  {summaryData.keyPoints.map((point, index) => (
                    <li key={index} className="text-sm flex items-start space-x-2">
                      <span className="text-muted-foreground mt-0.5">•</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>

          <TabsContent value="actions" className="space-y-4">
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                {/* Pending Actions */}
                {pendingActions.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <AlertTriangle className="h-4 w-4 text-orange-600" />
                      <span className="font-medium">Pending ({pendingActions.length})</span>
                    </div>
                    <div className="space-y-2">
                      {pendingActions.map((action) => (
                        <div key={action.id} className="p-3 border rounded-lg">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-1">
                                {getStatusIcon(action.status)}
                                <span className="text-sm font-medium">{action.task}</span>
                              </div>
                              <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                                {action.assignee && (
                                  <span className="flex items-center space-x-1">
                                    <User className="h-3 w-3" />
                                    <span>{action.assignee}</span>
                                  </span>
                                )}
                                {action.deadline && (
                                  <span className="flex items-center space-x-1">
                                    <Calendar className="h-3 w-3" />
                                    <span>{action.deadline}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                            <Badge className={cn("text-xs", getPriorityColor(action.priority))}>
                              {action.priority}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* In Progress Actions */}
                {inProgressActions.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Clock className="h-4 w-4 text-yellow-600" />
                      <span className="font-medium">In Progress ({inProgressActions.length})</span>
                    </div>
                    <div className="space-y-2">
                      {inProgressActions.map((action) => (
                        <div key={action.id} className="p-3 border rounded-lg bg-yellow-50 dark:bg-yellow-950/30">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-1">
                                {getStatusIcon(action.status)}
                                <span className="text-sm font-medium">{action.task}</span>
                              </div>
                              <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                                {action.assignee && (
                                  <span className="flex items-center space-x-1">
                                    <User className="h-3 w-3" />
                                    <span>{action.assignee}</span>
                                  </span>
                                )}
                                {action.deadline && (
                                  <span className="flex items-center space-x-1">
                                    <Calendar className="h-3 w-3" />
                                    <span>{action.deadline}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                            <Badge className={cn("text-xs", getPriorityColor(action.priority))}>
                              {action.priority}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Completed Actions */}
                {completedActions.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <CheckSquare className="h-4 w-4 text-green-600" />
                      <span className="font-medium">Completed ({completedActions.length})</span>
                    </div>
                    <div className="space-y-2">
                      {completedActions.map((action) => (
                        <div key={action.id} className="p-3 border rounded-lg bg-green-50 dark:bg-green-950/30 opacity-75">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-1">
                                {getStatusIcon(action.status)}
                                <span className="text-sm font-medium line-through">{action.task}</span>
                              </div>
                              <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                                {action.assignee && (
                                  <span className="flex items-center space-x-1">
                                    <User className="h-3 w-3" />
                                    <span>{action.assignee}</span>
                                  </span>
                                )}
                                {action.deadline && (
                                  <span className="flex items-center space-x-1">
                                    <Calendar className="h-3 w-3" />
                                    <span>{action.deadline}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                            <Badge className={cn("text-xs", getPriorityColor(action.priority))}>
                              {action.priority}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {summaryData.actionItems.length === 0 && (
                  <div className="text-center text-muted-foreground py-8">
                    <CheckSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No action items detected</p>
                    <p className="text-xs mt-1">Action items will appear here as they are identified</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="details" className="space-y-4">
            {/* Participants */}
            <div className="space-y-2">
              <span className="font-medium">Participants</span>
              <div className="flex flex-wrap gap-2">
                {summaryData.participants.map((participant, index) => (
                  <Badge key={index} variant="outline">
                    <User className="h-3 w-3 mr-1" />
                    {participant}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Next Meeting */}
            {summaryData.nextMeeting && (
              <div className="space-y-2">
                <span className="font-medium">Next Meeting</span>
                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                  <div className="font-medium">{summaryData.nextMeeting.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {summaryData.nextMeeting.date} at {summaryData.nextMeeting.time}
                  </div>
                </div>
              </div>
            )}

            {/* Meeting Statistics */}
            <div className="space-y-2">
              <span className="font-medium">Statistics</span>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex justify-between">
                  <span>Duration:</span>
                  <span>{formatDuration(summaryData.duration)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Participants:</span>
                  <span>{summaryData.participants.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Action Items:</span>
                  <span>{summaryData.actionItems.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Key Points:</span>
                  <span>{summaryData.keyPoints.length}</span>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}