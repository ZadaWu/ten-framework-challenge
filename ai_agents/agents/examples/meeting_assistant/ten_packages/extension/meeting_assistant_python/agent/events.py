from pydantic import BaseModel
from typing import Literal, Union, Dict, Any, List, Optional
from datetime import datetime
from ten_ai_base.types import LLMToolMetadata


# ==== Base Event ====


class AgentEventBase(BaseModel):
    """Base class for all agent-level events."""

    type: Literal["cmd", "data"]
    name: str


# ==== CMD Events ====


class UserJoinedEvent(AgentEventBase):
    """Event triggered when a user joins the session."""

    type: Literal["cmd"] = "cmd"
    name: Literal["on_user_joined"] = "on_user_joined"


class UserLeftEvent(AgentEventBase):
    """Event triggered when a user leaves the session."""

    type: Literal["cmd"] = "cmd"
    name: Literal["on_user_left"] = "on_user_left"


class ToolRegisterEvent(AgentEventBase):
    """Event triggered when a tool is registered by the user."""

    type: Literal["cmd"] = "cmd"
    name: Literal["tool_register"] = "tool_register"
    tool: LLMToolMetadata
    source: str


# ==== Meeting Specific CMD Events ====


class MeetingStartEvent(AgentEventBase):
    """Event triggered when a meeting starts."""

    type: Literal["cmd"] = "cmd"
    name: Literal["meeting_start"] = "meeting_start"
    meeting_id: str
    participants: List[str]
    agenda: Optional[str] = None
    meeting_type: str = "general"


class MeetingEndEvent(AgentEventBase):
    """Event triggered when a meeting ends."""

    type: Literal["cmd"] = "cmd"
    name: Literal["meeting_end"] = "meeting_end"
    meeting_id: str
    duration: int
    summary: str


class MeetingPhaseChangeEvent(AgentEventBase):
    """Event triggered when meeting phase changes."""

    type: Literal["cmd"] = "cmd"
    name: Literal["meeting_phase_change"] = "meeting_phase_change"
    meeting_id: str
    previous_phase: str
    current_phase: str
    timestamp: datetime


# ==== DATA Events ====


class ASRResultEvent(AgentEventBase):
    """Event triggered when ASR result is received (partial or final)."""

    type: Literal["data"] = "data"
    name: Literal["asr_result"] = "asr_result"
    text: str
    final: bool
    metadata: Dict[str, Any]
    speaker_id: Optional[str] = None
    confidence: Optional[float] = None


class LLMResponseEvent(AgentEventBase):
    """Event triggered when LLM returns a streaming response."""

    type: Literal["message", "reasoning"] = "message"
    name: Literal["llm_response"] = "llm_response"
    delta: str
    text: str
    is_final: bool


# ==== Meeting Specific DATA Events ====


class ActionItemEvent(AgentEventBase):
    """Event triggered when an action item is identified."""

    type: Literal["data"] = "data"
    name: Literal["action_item"] = "action_item"
    action: str
    assignee: Optional[str] = None
    deadline: Optional[datetime] = None
    priority: str = "medium"
    meeting_id: str
    source_text: str


class SummaryGeneratedEvent(AgentEventBase):
    """Event triggered when a summary is generated."""

    type: Literal["data"] = "data"
    name: Literal["summary_generated"] = "summary_generated"
    summary_type: Literal["real_time", "final", "section"]
    content: str
    timestamp: datetime
    meeting_id: str
    section: Optional[str] = None


class KeyPointEvent(AgentEventBase):
    """Event triggered when a key point is identified."""

    type: Literal["data"] = "data"
    name: Literal["key_point"] = "key_point"
    point: str
    category: str
    importance: str = "medium"
    timestamp: datetime
    meeting_id: str
    speaker_id: Optional[str] = None


class DecisionEvent(AgentEventBase):
    """Event triggered when a decision is made."""

    type: Literal["data"] = "data"
    name: Literal["decision"] = "decision"
    decision: str
    decision_maker: Optional[str] = None
    related_topic: str
    timestamp: datetime
    meeting_id: str
    confidence: Optional[float] = None


class CalendarEventEvent(AgentEventBase):
    """Event triggered when a calendar event should be created."""

    type: Literal["data"] = "data"
    name: Literal["calendar_event"] = "calendar_event"
    event_title: str
    event_time: datetime
    duration: int
    participants: List[str]
    description: str
    meeting_id: str
    action_item_id: Optional[str] = None


# ==== Data Models ====


class ActionItem(BaseModel):
    """Action item data model."""

    id: str
    action: str
    assignee: Optional[str] = None
    deadline: Optional[datetime] = None
    priority: str = "medium"
    status: str = "pending"
    created_at: datetime
    meeting_id: str
    source_text: str


class MeetingParticipant(BaseModel):
    """Meeting participant data model."""

    id: str
    name: str
    role: Optional[str] = None
    speaking_time: int = 0
    contributions: int = 0


class MeetingSummary(BaseModel):
    """Meeting summary data model."""

    meeting_id: str
    title: str
    date: datetime
    duration: int
    participants: List[MeetingParticipant]
    agenda: Optional[str] = None
    key_points: List[str]
    decisions: List[str]
    action_items: List[ActionItem]
    next_steps: List[str]
    summary: str


# ==== Unified Event Union ====

AgentEvent = Union[
    UserJoinedEvent,
    UserLeftEvent,
    ToolRegisterEvent,
    ASRResultEvent,
    LLMResponseEvent,
    MeetingStartEvent,
    MeetingEndEvent,
    MeetingPhaseChangeEvent,
    ActionItemEvent,
    SummaryGeneratedEvent,
    KeyPointEvent,
    DecisionEvent,
    CalendarEventEvent,
]
