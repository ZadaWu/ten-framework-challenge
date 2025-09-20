import asyncio
import json
import time
from typing import Literal

from .agent.decorators import agent_event_handler
from ten_runtime import (
    AsyncExtension,
    AsyncTenEnv,
    Cmd,
    Data,
)

from .agent.agent import MeetingAgent
from .agent.events import (
    ASRResultEvent,
    LLMResponseEvent,
    ToolRegisterEvent,
    UserJoinedEvent,
    UserLeftEvent,
    MeetingStartEvent,
    MeetingEndEvent,
    ActionItemEvent,
    SummaryGeneratedEvent,
    CalendarEventEvent,
)
from .helper import _send_cmd, _send_data, parse_sentences
from .config import MeetingAssistantConfig

import uuid


class MeetingAssistantExtension(AsyncExtension):
    """
    The entry point of the meeting assistant module.
    Handles meeting transcription, summary generation, action item extraction,
    and calendar scheduling.
    """

    def __init__(self, name: str):
        super().__init__(name)
        self.ten_env: AsyncTenEnv = None
        self.agent: MeetingAgent = None
        self.config: MeetingAssistantConfig = None

        self.stopped: bool = False
        self._rtc_user_count: int = 0
        self.sentence_fragment: str = ""
        self.turn_id: int = 0
        self.session_id: str = "0"
        self.meeting_active: bool = False

    def _current_metadata(self) -> dict:
        return {"session_id": self.session_id, "turn_id": self.turn_id}

    async def on_init(self, ten_env: AsyncTenEnv):
        self.ten_env = ten_env

        # Load config from runtime properties
        config_json, _ = await ten_env.get_property_to_json(None)
        self.config = MeetingAssistantConfig.model_validate_json(config_json)

        self.agent = MeetingAgent(ten_env)

        # Now auto-register decorated methods
        for attr_name in dir(self):
            fn = getattr(self, attr_name)
            event_type = getattr(fn, "_agent_event_type", None)
            if event_type:
                self.agent.on(event_type, fn)

    # === Register handlers with decorators ===
    @agent_event_handler(UserJoinedEvent)
    async def _on_user_joined(self, event: UserJoinedEvent):
        self._rtc_user_count += 1
        # 禁用初始问候语，静默模式
        # if self._rtc_user_count == 1 and self.config and self.config.greeting:
        #     await self._send_to_tts(self.config.greeting, True)
        #     await self._send_transcript(
        #         "assistant", self.config.greeting, True, 100
        #     )

        # Auto-start meeting if configured
        if not self.meeting_active:
            await self._start_meeting()
            self.ten_env.log_info("[MeetingAssistant] User joined - silent mode activated")

    @agent_event_handler(UserLeftEvent)
    async def _on_user_left(self, event: UserLeftEvent):
        self._rtc_user_count -= 1

        # Auto-end meeting if all users left (with delay to avoid interruptions)
        if self._rtc_user_count == 0 and self.meeting_active:
            # 添加延迟，避免暂停时误触发
            import asyncio
            await asyncio.sleep(10)  # 等待10秒
            # 再次检查用户数量，如果仍然为0才结束会议
            if self._rtc_user_count == 0 and self.meeting_active:
                self.ten_env.log_info("All users left for 10 seconds, ending meeting")
                await self._end_meeting()
            else:
                self.ten_env.log_info("User rejoined, continuing meeting")

    @agent_event_handler(ToolRegisterEvent)
    async def _on_tool_register(self, event: ToolRegisterEvent):
        await self.agent.register_llm_tool(event.tool, event.source)

    @agent_event_handler(ASRResultEvent)
    async def _on_asr_result(self, event: ASRResultEvent):
        self.session_id = event.metadata.get("session_id", "100")
        stream_id = int(self.session_id)
        if not event.text:
            return
        if event.final or len(event.text) > 2:
            await self._interrupt()
        if event.final:
            self.turn_id += 1
            # 禁用LLM输入，实现完全静默模式
            # await self.agent.queue_llm_input(event.text)

            # 存储转录内容用于后续总结
            if not hasattr(self, 'stored_transcripts'):
                self.stored_transcripts = []
            self.stored_transcripts.append({
                'text': event.text,
                'timestamp': time.time(),
                'turn_id': self.turn_id
            })

        await self._send_transcript("user", event.text, event.final, stream_id)

    @agent_event_handler(LLMResponseEvent)
    async def _on_llm_response(self, event: LLMResponseEvent):
        # 检查是否为总结模式
        is_summary_mode = getattr(self, '_summary_mode', False)

        if is_summary_mode:
            # 总结模式下启用输出
            if not event.is_final and event.type == "message":
                sentences, self.sentence_fragment = parse_sentences(
                    self.sentence_fragment, event.delta
                )
                for s in sentences:
                    await self._send_to_tts(s, False)

            if event.is_final and event.type == "message":
                remaining_text = self.sentence_fragment or ""
                self.sentence_fragment = ""
                await self._send_to_tts(remaining_text, True)

                # 总结完成后重置模式
                self._summary_mode = False

            await self._send_transcript(
                "assistant",
                event.text,
                event.is_final,
                100,
                data_type=("reasoning" if event.type == "reasoning" else "text"),
            )

            self.ten_env.log_info(f"[MeetingAssistant] Summary output: {event.text}")
        else:
            # 静默模式，记录但不输出
            self.ten_env.log_info(f"[MeetingAssistant] LLM response stored (silent mode): {event.text}")

    # === Meeting-specific event handlers ===
    @agent_event_handler(MeetingStartEvent)
    async def _on_meeting_start(self, event: MeetingStartEvent):
        self.meeting_active = True
        await self._send_meeting_notification(
            f"会议开始: {event.meeting_id}",
            f"参与者: {', '.join(event.participants)}"
        )

    @agent_event_handler(MeetingEndEvent)
    async def _on_meeting_end(self, event: MeetingEndEvent):
        self.meeting_active = False
        await self._send_meeting_notification(
            "会议结束",
            f"会议时长: {event.duration // 60}分钟"
        )

    @agent_event_handler(ActionItemEvent)
    async def _on_action_item(self, event: ActionItemEvent):
        action_text = f"🎯 行动项: {event.action}"
        if event.assignee:
            action_text += f" (负责人: {event.assignee})"
        if event.deadline:
            action_text += f" (截止: {event.deadline.strftime('%m/%d')})"

        await self._send_meeting_notification("新的行动项", action_text)

    @agent_event_handler(SummaryGeneratedEvent)
    async def _on_summary_generated(self, event: SummaryGeneratedEvent):
        summary_title = {
            "real_time": "实时总结",
            "final": "最终总结",
            "section": "阶段总结"
        }.get(event.summary_type, "总结")

        await self._send_meeting_notification(
            f"📝 {summary_title}",
            event.content[:200] + "..." if len(event.content) > 200 else event.content
        )

    @agent_event_handler(CalendarEventEvent)
    async def _on_calendar_event(self, event: CalendarEventEvent):
        await self._send_meeting_notification(
            "📅 日程安排",
            f"{event.event_title} - {event.event_time.strftime('%Y/%m/%d %H:%M')}"
        )

    async def on_start(self, ten_env: AsyncTenEnv):
        ten_env.log_info("[MainControlExtension] on_start")

    async def on_stop(self, ten_env: AsyncTenEnv):
        ten_env.log_info("[MainControlExtension] on_stop")
        self.stopped = True
        await self.agent.stop()

    async def on_cmd(self, ten_env: AsyncTenEnv, cmd: Cmd):
        await self.agent.on_cmd(cmd)

    async def on_data(self, ten_env: AsyncTenEnv, data: Data):
        await self.agent.on_data(data)

    # === helpers ===
    async def _send_transcript(
        self,
        role: str,
        text: str,
        final: bool,
        stream_id: int,
        data_type: Literal["text", "reasoning"] = "text",
    ):
        """
        Sends the transcript (ASR or LLM output) to the message collector.
        """
        if data_type == "text":
            await _send_data(
                self.ten_env,
                "message",
                "message_collector",
                {
                    "data_type": "transcribe",
                    "role": role,
                    "text": text,
                    "text_ts": int(time.time() * 1000),
                    "is_final": final,
                    "stream_id": stream_id,
                },
            )
        elif data_type == "reasoning":
            await _send_data(
                self.ten_env,
                "message",
                "message_collector",
                {
                    "data_type": "raw",
                    "role": role,
                    "text": json.dumps(
                        {
                            "type": "reasoning",
                            "data": {
                                "text": text,
                            },
                        }
                    ),
                    "text_ts": int(time.time() * 1000),
                    "is_final": final,
                    "stream_id": stream_id,
                },
            )
        self.ten_env.log_info(
            f"[MainControlExtension] Sent transcript: {role}, final={final}, text={text}"
        )

    async def _send_to_tts(self, text: str, is_final: bool):
        """
        Sends a sentence to the TTS system.
        """
        request_id = f"tts-request-{self.turn_id}"
        await _send_data(
            self.ten_env,
            "tts_text_input",
            "tts",
            {
                "request_id": request_id,
                "text": text,
                "text_input_end": is_final,
                "metadata": self._current_metadata(),
            },
        )
        self.ten_env.log_info(
            f"[MainControlExtension] Sent to TTS: is_final={is_final}, text={text}"
        )

    async def _interrupt(self):
        """
        Interrupts ongoing LLM and TTS generation. Typically called when user speech is detected.
        """
        self.sentence_fragment = ""
        await self.agent.flush_llm()
        await _send_data(
            self.ten_env, "tts_flush", "tts", {"flush_id": str(uuid.uuid4())}
        )
        await _send_cmd(self.ten_env, "flush", "agora_rtc")
        self.ten_env.log_info("[MainControlExtension] Interrupt signal sent")

    # === Meeting control methods ===
    async def _start_meeting(self):
        """Start a new meeting session."""
        if not self.meeting_active:
            meeting_id = await self.agent.start_meeting(
                participants=[f"user_{self.session_id}"],
                agenda="AI辅助会议"
            )
            self.meeting_active = True
            self.ten_env.log_info(f"Meeting started: {meeting_id}")

    async def _end_meeting(self):
        """End the current meeting session."""
        if self.meeting_active:
            # 在会议结束前生成最终总结
            await self._generate_meeting_summary()

            success = await self.agent.end_current_meeting()
            if success:
                self.meeting_active = False
                self.ten_env.log_info("Meeting ended")

    async def _generate_meeting_summary(self):
        """生成会议总结并发送TTS和转录"""
        try:
            # 检查是否有存储的转录内容
            if hasattr(self, 'stored_transcripts') and self.stored_transcripts:
                # 整理转录内容
                transcript_text = "\n".join([
                    f"[{i+1}] {item['text']}"
                    for i, item in enumerate(self.stored_transcripts)
                ])

                # 构建总结请求
                summary_prompt = f"""请根据以下会议转录内容生成简洁的总结：

{transcript_text}

请按以下格式输出：
1. 主要讨论点：
2. 关键决策：
3. 行动项目：
4. 会议时长：约{len(self.stored_transcripts)}个发言轮次"""

                # 单次请求生成总结
                await self.agent.queue_llm_input(summary_prompt)

                # 临时启用LLM输出，仅用于总结
                self._summary_mode = True

                # 发送初始通知
                initial_text = f"会议已结束，共记录{len(self.stored_transcripts)}条发言。正在生成总结报告..."
            else:
                initial_text = "会议已结束，但未记录到发言内容。"

            await self._send_to_tts(initial_text, True)
            await self._send_transcript("assistant", initial_text, True, 100)

            self.ten_env.log_info(f"[MeetingAssistant] Meeting summary generation triggered with {len(getattr(self, 'stored_transcripts', []))} transcripts")
        except Exception as e:
            self.ten_env.log_error(f"[MeetingAssistant] Error generating summary: {e}")

    async def _send_meeting_notification(self, title: str, content: str):
        """Send meeting notification to the UI."""
        notification_text = f"[{title}] {content}"

        # Send as transcript message
        await self._send_transcript(
            "system",
            notification_text,
            True,
            200,  # Different stream ID for system messages
            data_type="text"
        )

        # Also send as raw data for UI handling
        await _send_data(
            self.ten_env,
            "meeting_notification",
            "message_collector",
            {
                "notification_type": "meeting",
                "title": title,
                "content": content,
                "timestamp": int(time.time() * 1000),
                "meeting_active": self.meeting_active,
            },
        )

# For backward compatibility
MainControlExtension = MeetingAssistantExtension
