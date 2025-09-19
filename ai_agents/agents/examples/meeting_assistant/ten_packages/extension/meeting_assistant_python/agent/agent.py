import asyncio
import json
import uuid
from datetime import datetime
from typing import Awaitable, Callable, Optional
from .llm_exec import LLMExec
from .meeting_processor import MeetingProcessor
from .summary_generator import SummaryGenerator
from .action_extractor import ActionExtractor
from .calendar_manager import CalendarManager
from ten_runtime import AsyncTenEnv, Cmd, CmdResult, Data, StatusCode
from ten_ai_base.types import LLMToolMetadata
from .events import *


class MeetingAgent:
    def __init__(self, ten_env: AsyncTenEnv):
        self.ten_env: AsyncTenEnv = ten_env
        self.stopped = False

        # Callback registry
        self._callbacks: dict[
            AgentEvent, list[Callable[[AgentEvent], Awaitable]]
        ] = {}

        # Queues for ordered processing
        self._asr_queue: asyncio.Queue[ASRResultEvent] = asyncio.Queue()
        self._llm_queue: asyncio.Queue[LLMResponseEvent] = asyncio.Queue()
        self._meeting_queue: asyncio.Queue[AgentEvent] = asyncio.Queue()

        # Current consumer tasks
        self._asr_consumer: Optional[asyncio.Task] = None
        self._llm_consumer: Optional[asyncio.Task] = None
        self._meeting_consumer: Optional[asyncio.Task] = None
        self._llm_active_task: Optional[asyncio.Task] = (
            None  # currently running handler
        )

        # Core components
        self.llm_exec = LLMExec(ten_env)
        self.meeting_processor = MeetingProcessor(ten_env)
        self.summary_generator = SummaryGenerator(ten_env, self.llm_exec)
        self.action_extractor = ActionExtractor(ten_env, self.llm_exec)
        self.calendar_manager = CalendarManager(ten_env)

        # Setup LLM callbacks
        self.llm_exec.on_response = self._on_llm_response
        self.llm_exec.on_reasoning_response = self._on_llm_reasoning_response

        # Meeting state
        self.current_meeting_id: Optional[str] = None
        self.meeting_active = False

        # Start consumers
        self._asr_consumer = asyncio.create_task(self._consume_asr())
        self._llm_consumer = asyncio.create_task(self._consume_llm())
        self._meeting_consumer = asyncio.create_task(self._consume_meeting_events())

        # Register default meeting handlers
        self._register_default_handlers()

    # === Register handlers ===
    def on(
        self,
        event_type: AgentEvent,
        handler: Callable[[AgentEvent], Awaitable] = None,
    ):
        """
        Register a callback for a given event type.

        Can be used in two ways:
        1) agent.on(EventType, handler)
        2) @agent.on(EventType)
           async def handler(event: EventType): ...
        """

        def decorator(func: Callable[[AgentEvent], Awaitable]):
            self._callbacks.setdefault(event_type, []).append(func)
            return func

        if handler is None:
            return decorator
        else:
            return decorator(handler)

    async def _dispatch(self, event: AgentEvent):
        """Dispatch event to registered handlers sequentially."""
        for etype, handlers in self._callbacks.items():
            if isinstance(event, etype):
                for h in handlers:
                    try:
                        await h(event)
                    except asyncio.CancelledError:
                        raise
                    except Exception as e:
                        self.ten_env.log_error(
                            f"Handler error for {etype}: {e}"
                        )

    # === Consumers ===
    async def _consume_asr(self):
        while not self.stopped:
            event = await self._asr_queue.get()
            await self._dispatch(event)

    async def _consume_llm(self):
        while not self.stopped:
            event = await self._llm_queue.get()
            # Run handler as a task so we can cancel mid-flight
            self._llm_active_task = asyncio.create_task(self._dispatch(event))
            try:
                await self._llm_active_task
            except asyncio.CancelledError:
                self.ten_env.log_info("[Agent] Active LLM task cancelled")
            finally:
                self._llm_active_task = None

    async def _consume_meeting_events(self):
        """Consumer for meeting-specific events."""
        while not self.stopped:
            event = await self._meeting_queue.get()
            await self._dispatch(event)

    # === Emit events ===
    async def _emit_asr(self, event: ASRResultEvent):
        await self._asr_queue.put(event)

    async def _emit_llm(self, event: LLMResponseEvent):
        await self._llm_queue.put(event)

    async def _emit_meeting(self, event: AgentEvent):
        await self._meeting_queue.put(event)

    async def _emit_direct(self, event: AgentEvent):
        await self._dispatch(event)

    # === Incoming from runtime ===
    async def on_cmd(self, cmd: Cmd):
        try:
            name = cmd.get_name()
            if name == "on_user_joined":
                await self._emit_direct(UserJoinedEvent())
            elif name == "on_user_left":
                await self._emit_direct(UserLeftEvent())
            elif name == "tool_register":
                tool_json, err = cmd.get_property_to_json("tool")
                if err:
                    raise RuntimeError(f"Invalid tool metadata: {err}")
                tool = LLMToolMetadata.model_validate_json(tool_json)
                await self._emit_direct(
                    ToolRegisterEvent(
                        tool=tool, source=cmd.get_source().extension_name
                    )
                )
            elif name == "start_meeting":
                participants_json, _ = cmd.get_property_to_json("participants")
                participants = json.loads(participants_json) if participants_json else []
                agenda = cmd.get_property_string("agenda")
                meeting_type = cmd.get_property_string("meeting_type") or "general"

                meeting_id = str(uuid.uuid4())
                await self._emit_meeting(MeetingStartEvent(
                    meeting_id=meeting_id,
                    participants=participants,
                    agenda=agenda,
                    meeting_type=meeting_type
                ))
            elif name == "end_meeting":
                if self.current_meeting_id:
                    await self._emit_meeting(MeetingEndEvent(
                        meeting_id=self.current_meeting_id,
                        duration=0,  # Will be calculated
                        summary=""  # Will be generated
                    ))
            else:
                self.ten_env.log_warn(f"Unhandled cmd: {name}")

            await self.ten_env.return_result(
                CmdResult.create(StatusCode.OK, cmd)
            )
        except Exception as e:
            self.ten_env.log_error(f"on_cmd error: {e}")
            await self.ten_env.return_result(
                CmdResult.create(StatusCode.ERROR, cmd)
            )

    async def on_data(self, data: Data):
        try:
            if data.get_name() == "asr_result":
                asr_json, _ = data.get_property_to_json(None)
                asr = json.loads(asr_json)
                await self._emit_asr(
                    ASRResultEvent(
                        text=asr.get("text", ""),
                        final=asr.get("final", False),
                        metadata=asr.get("metadata", {}),
                        speaker_id=asr.get("speaker_id"),
                        confidence=asr.get("confidence")
                    )
                )
            else:
                self.ten_env.log_warn(f"Unhandled data: {data.get_name()}")
        except Exception as e:
            self.ten_env.log_error(f"on_data error: {e}")

    async def _on_llm_response(
        self, ten_env: AsyncTenEnv, delta: str, text: str, is_final: bool
    ):
        await self._emit_llm(
            LLMResponseEvent(delta=delta, text=text, is_final=is_final)
        )

    async def _on_llm_reasoning_response(
        self, ten_env: AsyncTenEnv, delta: str, text: str, is_final: bool
    ):
        """
        Internal callback for streaming LLM output, wrapped as an AgentEvent.
        """
        await self._emit_llm(
            LLMResponseEvent(
                delta=delta, text=text, is_final=is_final, type="reasoning"
            )
        )

    # === LLM control ===
    async def register_llm_tool(self, tool: LLMToolMetadata, source: str):
        """
        Register tools with the LLM.
        This method sends a command to register the provided tools.
        """
        await self.llm_exec.register_tool(tool, source)

    async def queue_llm_input(self, text: str):
        """
        Queue a new message to the LLM context.
        This method sends the text input to the LLM for processing.
        """
        await self.llm_exec.queue_input(text)

    async def flush_llm(self):
        """
        Flush the LLM input queue.
        This will ensure that all queued inputs are processed.
        """
        await self.llm_exec.flush()

        # Clear queue
        while not self._llm_queue.empty():
            try:
                self._llm_queue.get_nowait()
                self._llm_queue.task_done()
            except asyncio.QueueEmpty:
                break

        # Cancel active LLM task
        if self._llm_active_task and not self._llm_active_task.done():
            self._llm_active_task.cancel()
            try:
                await self._llm_active_task
            except asyncio.CancelledError:
                pass
            self._llm_active_task = None

    def _register_default_handlers(self):
        """Register default handlers for meeting events."""

        @self.on(ASRResultEvent)
        async def handle_asr_result(event: ASRResultEvent):
            if self.meeting_active:
                await self.meeting_processor.process_asr_result(event)

                # Extract action items from final ASR results
                if event.final and event.text.strip():
                    action_events = await self.action_extractor.extract_action_items(
                        event.text, self.current_meeting_id, event.speaker_id
                    )
                    for action_event in action_events:
                        await self._emit_meeting(action_event)

        @self.on(MeetingStartEvent)
        async def handle_meeting_start(event: MeetingStartEvent):
            success = await self.meeting_processor.start_meeting(
                event.meeting_id, event.participants, event.agenda
            )
            if success:
                self.current_meeting_id = event.meeting_id
                self.meeting_active = True
                self.ten_env.log_info(f"Meeting {event.meeting_id} started successfully")

                # Send greeting message
                greeting = f"会议已开始。参与者：{', '.join(event.participants)}。"
                if event.agenda:
                    greeting += f" 议程：{event.agenda}"
                await self._send_text_data(greeting, is_final=True)

        @self.on(MeetingEndEvent)
        async def handle_meeting_end(event: MeetingEndEvent):
            if self.current_meeting_id:
                summary = await self.meeting_processor.end_meeting(self.current_meeting_id)
                if summary:
                    # Generate final summary
                    summary_event = await self.summary_generator.generate_final_summary(summary)
                    if summary_event:
                        await self._emit_meeting(summary_event)

                    # Schedule follow-up meetings
                    action_items = self.action_extractor.get_action_items(self.current_meeting_id)
                    if action_items:
                        calendar_events = await self.calendar_manager.schedule_follow_up_meetings(action_items)
                        for cal_event in calendar_events:
                            await self._emit_meeting(cal_event)

                        # Schedule deadline reminders
                        reminder_events = await self.calendar_manager.schedule_deadline_reminders(action_items)
                        for reminder_event in reminder_events:
                            await self._emit_meeting(reminder_event)

                self.meeting_active = False
                self.current_meeting_id = None
                self.ten_env.log_info("Meeting ended and post-processing completed")

        @self.on(SummaryGeneratedEvent)
        async def handle_summary_generated(event: SummaryGeneratedEvent):
            # Send summary to UI
            summary_text = f"[{event.summary_type.upper()} 总结] {event.content}"
            await self._send_text_data(summary_text, is_final=True)

        @self.on(ActionItemEvent)
        async def handle_action_item(event: ActionItemEvent):
            # Send action item notification
            action_text = f"[行动项] {event.action}"
            if event.assignee:
                action_text += f" (负责人: {event.assignee})"
            if event.deadline:
                action_text += f" (截止: {event.deadline.strftime('%Y-%m-%d')})"
            await self._send_text_data(action_text, is_final=True)

        @self.on(CalendarEventEvent)
        async def handle_calendar_event(event: CalendarEventEvent):
            # Send calendar event notification
            calendar_text = f"[日程安排] {event.event_title} - {event.event_time.strftime('%Y-%m-%d %H:%M')}"
            await self._send_text_data(calendar_text, is_final=True)

    async def _send_text_data(self, text: str, is_final: bool = False, stream_id: int = 0):
        """Send text data back to the client."""
        try:
            from ten_runtime import Data

            text_data = Data.create("text_data")
            text_data.set_property_string("text", text)
            text_data.set_property_bool("is_final", is_final)
            text_data.set_property_bool("end_of_segment", is_final)
            text_data.set_property_int("stream_id", stream_id)

            await self.ten_env.send_data(text_data)

        except Exception as e:
            self.ten_env.log_error(f"Failed to send text data: {e}")

    # === Meeting Control Methods ===

    async def start_meeting(self, participants: list = None, agenda: str = None) -> str:
        """Start a new meeting programmatically."""
        meeting_id = str(uuid.uuid4())
        await self._emit_meeting(MeetingStartEvent(
            meeting_id=meeting_id,
            participants=participants or [],
            agenda=agenda,
            meeting_type="programmatic"
        ))
        return meeting_id

    async def end_current_meeting(self) -> bool:
        """End the current meeting."""
        if self.current_meeting_id:
            await self._emit_meeting(MeetingEndEvent(
                meeting_id=self.current_meeting_id,
                duration=0,
                summary=""
            ))
            return True
        return False

    async def get_meeting_status(self) -> dict:
        """Get current meeting status."""
        if self.meeting_active and self.current_meeting_id:
            return await self.meeting_processor.get_meeting_status()
        return {"status": "no_meeting", "meeting_active": False}

    async def generate_summary(self, summary_type: str = "real_time") -> bool:
        """Manually trigger summary generation."""
        if not self.meeting_active or not self.current_meeting_id:
            return False

        try:
            meeting_status = await self.meeting_processor.get_meeting_status()
            if meeting_status.get("transcript_items", 0) > 0:
                # Get recent transcript for summary
                # This is a simplified version - in practice, you'd get actual transcript
                recent_text = "Recent meeting discussion content"

                if summary_type == "real_time":
                    summary_event = await self.summary_generator.generate_real_time_summary(
                        recent_text, self.current_meeting_id
                    )
                elif summary_type == "section":
                    current_phase = meeting_status.get("phase", "discussion")
                    summary_event = await self.summary_generator.generate_section_summary(
                        recent_text, current_phase, self.current_meeting_id
                    )

                if summary_event:
                    await self._emit_meeting(summary_event)
                    return True

        except Exception as e:
            self.ten_env.log_error(f"Failed to generate summary: {e}")

        return False

    async def export_meeting_data(self, format: str = "markdown") -> str:
        """Export current meeting data."""
        if not self.current_meeting_id:
            return ""

        try:
            # Export meeting transcript and data
            meeting_data = await self.meeting_processor.export_meeting_data(
                self.current_meeting_id, format
            )

            # Export action items
            action_data = await self.action_extractor.export_action_items(
                self.current_meeting_id, format
            )

            # Export summaries
            summary_data = await self.summary_generator.export_summaries(
                self.current_meeting_id, format
            )

            # Combine all data
            if format == "markdown":
                combined = f"{meeting_data}\n\n{action_data}\n\n{summary_data}"
            else:
                combined = meeting_data  # For other formats, return meeting data

            return combined

        except Exception as e:
            self.ten_env.log_error(f"Failed to export meeting data: {e}")
            return ""

    async def stop(self):
        """
        Stop the agent processing.
        This will stop the event queue and any ongoing tasks.
        """
        self.stopped = True

        # End current meeting if active
        if self.meeting_active:
            await self.end_current_meeting()

        await self.llm_exec.stop()
        await self.flush_llm()

        # Cancel all consumers
        if self._asr_consumer:
            self._asr_consumer.cancel()
        if self._llm_consumer:
            self._llm_consumer.cancel()
        if self._meeting_consumer:
            self._meeting_consumer.cancel()

# For backward compatibility, keep the Agent class name
Agent = MeetingAgent
