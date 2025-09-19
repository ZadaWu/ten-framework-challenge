import asyncio
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set, Tuple
from ten_runtime import AsyncTenEnv
from .events import *


class MeetingProcessor:
    """Core processor for handling meeting-specific logic."""

    def __init__(self, ten_env: AsyncTenEnv):
        self.ten_env = ten_env
        self.current_meeting: Optional[str] = None
        self.meeting_data: Dict[str, Dict] = {}
        self.participants: Dict[str, MeetingParticipant] = {}
        self.transcript_buffer: List[Tuple[str, str, datetime]] = []
        self.current_phase: str = "not_started"
        self.last_activity: datetime = datetime.now()
        self.summary_interval: int = 300  # 5 minutes
        self.auto_summary_task: Optional[asyncio.Task] = None

        # Meeting phases
        self.phases = {
            "not_started": "会议未开始",
            "opening": "会议开场",
            "discussion": "讨论阶段",
            "decision_making": "决策阶段",
            "action_planning": "行动计划",
            "closing": "会议结束"
        }

    async def start_meeting(self, meeting_id: str, participants: List[str], agenda: Optional[str] = None) -> bool:
        """Start a new meeting session."""
        try:
            if self.current_meeting:
                await self.end_meeting(self.current_meeting)

            self.current_meeting = meeting_id
            self.current_phase = "opening"
            self.last_activity = datetime.now()

            # Initialize meeting data
            self.meeting_data[meeting_id] = {
                "id": meeting_id,
                "start_time": datetime.now(),
                "agenda": agenda,
                "transcript": [],
                "key_points": [],
                "decisions": [],
                "action_items": [],
                "participants": participants,
                "phase_history": [{"phase": "opening", "timestamp": datetime.now()}]
            }

            # Initialize participants
            for participant_id in participants:
                self.participants[participant_id] = MeetingParticipant(
                    id=participant_id,
                    name=participant_id,
                    speaking_time=0,
                    contributions=0
                )

            # Start auto summary task
            self.auto_summary_task = asyncio.create_task(self._auto_summary_loop())

            self.ten_env.log_info(f"Meeting {meeting_id} started with {len(participants)} participants")
            return True

        except Exception as e:
            self.ten_env.log_error(f"Failed to start meeting: {e}")
            return False

    async def end_meeting(self, meeting_id: str) -> Optional[MeetingSummary]:
        """End the current meeting and generate final summary."""
        try:
            if meeting_id not in self.meeting_data:
                return None

            meeting = self.meeting_data[meeting_id]
            meeting["end_time"] = datetime.now()
            meeting["duration"] = int((meeting["end_time"] - meeting["start_time"]).total_seconds())

            # Cancel auto summary task
            if self.auto_summary_task and not self.auto_summary_task.done():
                self.auto_summary_task.cancel()

            # Generate final summary
            summary = await self._generate_final_summary(meeting_id)

            # Update phase
            await self._change_phase("closing")

            self.current_meeting = None
            self.current_phase = "not_started"

            self.ten_env.log_info(f"Meeting {meeting_id} ended, duration: {meeting['duration']} seconds")
            return summary

        except Exception as e:
            self.ten_env.log_error(f"Failed to end meeting: {e}")
            return None

    async def process_asr_result(self, event: ASRResultEvent) -> None:
        """Process ASR results and update meeting state."""
        try:
            if not self.current_meeting:
                return

            meeting = self.meeting_data[self.current_meeting]
            timestamp = datetime.now()

            # Add to transcript buffer
            if event.final:
                self.transcript_buffer.append((event.text, event.speaker_id or "unknown", timestamp))
                meeting["transcript"].append({
                    "text": event.text,
                    "speaker": event.speaker_id or "unknown",
                    "timestamp": timestamp,
                    "final": True
                })

                # Update participant stats
                if event.speaker_id and event.speaker_id in self.participants:
                    self.participants[event.speaker_id].contributions += 1
                    # Estimate speaking time (rough approximation)
                    estimated_time = len(event.text.split()) * 0.5  # ~0.5 seconds per word
                    self.participants[event.speaker_id].speaking_time += int(estimated_time)

                # Detect meeting phase changes
                await self._detect_phase_change(event.text)

                # Process for key information
                await self._process_for_key_information(event.text, timestamp)

            self.last_activity = timestamp

        except Exception as e:
            self.ten_env.log_error(f"Failed to process ASR result: {e}")

    async def _detect_phase_change(self, text: str) -> None:
        """Detect if the meeting phase should change based on the content."""
        text_lower = text.lower()

        # Phase detection keywords
        phase_keywords = {
            "opening": ["开始", "开会", "欢迎", "agenda", "议程"],
            "discussion": ["讨论", "discuss", "think about", "认为", "观点"],
            "decision_making": ["决定", "decide", "确定", "同意", "agree"],
            "action_planning": ["行动", "action", "下一步", "next step", "安排", "plan"],
            "closing": ["结束", "end", "总结", "summary", "散会"]
        }

        # Find potential new phase
        for phase, keywords in phase_keywords.items():
            if phase != self.current_phase and any(keyword in text_lower for keyword in keywords):
                # Don't go backwards unless it's closing
                phase_order = ["opening", "discussion", "decision_making", "action_planning", "closing"]
                current_index = phase_order.index(self.current_phase) if self.current_phase in phase_order else -1
                new_index = phase_order.index(phase)

                if new_index > current_index or phase == "closing":
                    await self._change_phase(phase)
                    break

    async def _change_phase(self, new_phase: str) -> None:
        """Change the current meeting phase."""
        if new_phase != self.current_phase and self.current_meeting:
            previous_phase = self.current_phase
            self.current_phase = new_phase

            # Record phase change
            self.meeting_data[self.current_meeting]["phase_history"].append({
                "phase": new_phase,
                "timestamp": datetime.now()
            })

            self.ten_env.log_info(f"Meeting phase changed from {previous_phase} to {new_phase}")

    async def _process_for_key_information(self, text: str, timestamp: datetime) -> None:
        """Process text for key information like decisions and action items."""
        if not self.current_meeting:
            return

        meeting = self.meeting_data[self.current_meeting]
        text_lower = text.lower()

        # Decision keywords
        decision_keywords = ["决定", "decide", "确定", "同意", "agree", "resolved", "concluded"]
        if any(keyword in text_lower for keyword in decision_keywords):
            meeting["decisions"].append({
                "decision": text,
                "timestamp": timestamp,
                "phase": self.current_phase
            })

        # Action item keywords
        action_keywords = ["需要", "should", "will do", "负责", "安排", "plan to", "action"]
        if any(keyword in text_lower for keyword in action_keywords):
            # This is a candidate for action item, will be processed by ActionExtractor
            pass

        # Key point keywords
        key_keywords = ["重要", "important", "关键", "key", "crucial", "主要"]
        if any(keyword in text_lower for keyword in key_keywords):
            meeting["key_points"].append({
                "point": text,
                "timestamp": timestamp,
                "phase": self.current_phase
            })

    async def _auto_summary_loop(self) -> None:
        """Auto-generate summaries at regular intervals."""
        try:
            while self.current_meeting:
                await asyncio.sleep(self.summary_interval)

                if self.current_meeting and self.transcript_buffer:
                    # Generate real-time summary
                    recent_text = " ".join([item[0] for item in self.transcript_buffer[-10:]])
                    if recent_text.strip():
                        # This would trigger summary generation
                        await self._emit_summary_request("real_time", recent_text)

        except asyncio.CancelledError:
            pass
        except Exception as e:
            self.ten_env.log_error(f"Auto summary loop error: {e}")

    async def _emit_summary_request(self, summary_type: str, content: str) -> None:
        """Emit a request for summary generation."""
        # This would be handled by the SummaryGenerator
        pass

    async def _generate_final_summary(self, meeting_id: str) -> Optional[MeetingSummary]:
        """Generate final meeting summary."""
        try:
            if meeting_id not in self.meeting_data:
                return None

            meeting = self.meeting_data[meeting_id]

            # Create action items from collected data
            action_items = []
            for item in meeting.get("action_items", []):
                action_items.append(ActionItem(
                    id=str(uuid.uuid4()),
                    action=item.get("action", ""),
                    assignee=item.get("assignee"),
                    deadline=item.get("deadline"),
                    priority=item.get("priority", "medium"),
                    status="pending",
                    created_at=datetime.now(),
                    meeting_id=meeting_id,
                    source_text=item.get("source_text", "")
                ))

            # Create participant list
            participants = [
                self.participants.get(p_id, MeetingParticipant(id=p_id, name=p_id))
                for p_id in meeting.get("participants", [])
            ]

            summary = MeetingSummary(
                meeting_id=meeting_id,
                title=f"Meeting {meeting_id}",
                date=meeting["start_time"],
                duration=meeting.get("duration", 0),
                participants=participants,
                agenda=meeting.get("agenda"),
                key_points=[item["point"] for item in meeting.get("key_points", [])],
                decisions=[item["decision"] for item in meeting.get("decisions", [])],
                action_items=action_items,
                next_steps=[],  # Would be generated by AI
                summary=""  # Would be generated by AI
            )

            return summary

        except Exception as e:
            self.ten_env.log_error(f"Failed to generate final summary: {e}")
            return None

    async def get_meeting_status(self) -> Dict:
        """Get current meeting status."""
        if not self.current_meeting:
            return {"status": "no_meeting"}

        meeting = self.meeting_data[self.current_meeting]
        return {
            "status": "active",
            "meeting_id": self.current_meeting,
            "phase": self.current_phase,
            "phase_description": self.phases.get(self.current_phase, "未知阶段"),
            "duration": int((datetime.now() - meeting["start_time"]).total_seconds()),
            "participants": len(self.participants),
            "transcript_items": len(meeting.get("transcript", [])),
            "key_points": len(meeting.get("key_points", [])),
            "decisions": len(meeting.get("decisions", [])),
            "action_items": len(meeting.get("action_items", []))
        }

    async def export_meeting_data(self, meeting_id: str, format: str = "json") -> Optional[str]:
        """Export meeting data in specified format."""
        try:
            if meeting_id not in self.meeting_data:
                return None

            meeting = self.meeting_data[meeting_id]

            if format == "txt":
                # Generate text format
                lines = [
                    f"会议记录 - {meeting_id}",
                    f"开始时间: {meeting['start_time']}",
                    f"议程: {meeting.get('agenda', '无')}",
                    "",
                    "== 会议转录 ==",
                ]

                for item in meeting.get("transcript", []):
                    lines.append(f"[{item['timestamp']}] {item['speaker']}: {item['text']}")

                lines.extend([
                    "",
                    "== 关键要点 ==",
                ])

                for item in meeting.get("key_points", []):
                    lines.append(f"- {item['point']}")

                lines.extend([
                    "",
                    "== 决策事项 ==",
                ])

                for item in meeting.get("decisions", []):
                    lines.append(f"- {item['decision']}")

                return "\n".join(lines)

            elif format == "json":
                import json
                return json.dumps(meeting, default=str, ensure_ascii=False, indent=2)

            return None

        except Exception as e:
            self.ten_env.log_error(f"Failed to export meeting data: {e}")
            return None