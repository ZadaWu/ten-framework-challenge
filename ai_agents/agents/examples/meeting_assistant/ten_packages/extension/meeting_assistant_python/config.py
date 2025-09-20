from pydantic import BaseModel
from typing import Dict, List, Optional


class MeetingConfig(BaseModel):
    """Meeting-specific configuration."""
    auto_summary_interval: int = 300  # seconds
    max_meeting_duration: int = 7200  # 2 hours in seconds
    enable_action_detection: bool = True
    enable_speaker_identification: bool = True
    enable_real_time_summary: bool = True
    enable_auto_scheduling: bool = True
    summary_trigger_threshold: int = 5  # minimum turns before summary


class CalendarIntegrationConfig(BaseModel):
    """Calendar integration configuration."""
    google_calendar: Dict = {
        "enabled": False,
        "credentials_path": "",
        "calendar_id": "primary"
    }
    outlook_calendar: Dict = {
        "enabled": False,
        "client_id": "",
        "client_secret": "",
        "tenant_id": ""
    }
    webhook_calendar: Dict = {
        "enabled": False,
        "webhook_url": "",
        "headers": {},
        "auth_token": ""
    }


class LLMPromptsConfig(BaseModel):
    """LLM prompts configuration."""
    summary_prompt_template: str = """
请根据以下会议内容生成总结：

{content}

请提取：
1. 主要讨论的话题
2. 关键观点或结论
3. 需要关注的要点

总结："""

    action_extraction_prompt: str = """
请从以下会议对话中提取具体的行动项：

{content}

请识别：
1. 具体的行动项或任务
2. 负责人（如果提到）
3. 截止时间（如果提到）
4. 优先级（高/中/低）

行动项："""

    meeting_phase_detection_prompt: str = """
请分析以下对话，判断当前会议阶段：

{content}

可能的阶段：opening（开场）、discussion（讨论）、decision_making（决策）、action_planning（行动计划）、closing（结束）

当前阶段："""


class NotificationConfig(BaseModel):
    """Notification configuration."""
    enable_email_notifications: bool = False
    email_settings: Dict = {
        "smtp_server": "",
        "smtp_port": 587,
        "username": "",
        "password": "",
        "from_email": ""
    }
    enable_slack_notifications: bool = False
    slack_settings: Dict = {
        "webhook_url": "",
        "channel": "#meetings",
        "bot_token": ""
    }
    enable_webhook_notifications: bool = False
    webhook_settings: Dict = {
        "url": "",
        "headers": {},
        "auth_token": ""
    }


class ExportConfig(BaseModel):
    """Export configuration."""
    default_export_format: str = "markdown"
    supported_formats: List[str] = ["markdown", "json", "txt", "pdf"]
    auto_export_on_meeting_end: bool = True
    export_location: str = "./meeting_exports"
    include_timestamps: bool = True
    include_speaker_info: bool = True


class SecurityConfig(BaseModel):
    """Security configuration."""
    enable_recording_encryption: bool = False
    encryption_key: Optional[str] = None
    enable_participant_verification: bool = False
    max_participants: int = 50
    meeting_timeout: int = 14400  # 4 hours in seconds
    enable_meeting_passwords: bool = False


class MeetingAssistantConfig(BaseModel):
    """Main configuration for Meeting Assistant."""

    # Basic settings
    greeting: str = "Hello, I am your AI Meeting Assistant. I will help you with meeting transcription, summary, and task management."
    agent_name: str = "AI Meeting Assistant"
    version: str = "1.0.0"

    # Core functionality
    meeting: MeetingConfig = MeetingConfig()
    calendar_integration: CalendarIntegrationConfig = CalendarIntegrationConfig()
    llm_prompts: LLMPromptsConfig = LLMPromptsConfig()
    notifications: NotificationConfig = NotificationConfig()
    export: ExportConfig = ExportConfig()
    security: SecurityConfig = SecurityConfig()

    # Language settings
    default_language: str = "zh-CN"
    supported_languages: List[str] = ["zh-CN", "en-US", "ja-JP", "ko-KR"]

    # UI settings
    enable_real_time_display: bool = True
    display_confidence_scores: bool = False
    highlight_action_items: bool = True
    show_speaker_indicators: bool = True

    # Storage settings
    enable_meeting_history: bool = True
    history_retention_days: int = 90
    enable_cloud_backup: bool = False
    cloud_backup_settings: Dict = {
        "provider": "aws_s3",
        "bucket": "",
        "region": "",
        "access_key": "",
        "secret_key": ""
    }

    # Performance settings
    max_concurrent_meetings: int = 5
    asr_buffer_size: int = 1024
    llm_timeout: int = 120  # 2 minutes timeout - sufficient for most API calls
    summary_batch_size: int = 10

    # Debug settings
    enable_debug_logging: bool = True
    log_level: str = "DEBUG"
    log_to_file: bool = True
    log_file_path: str = "./logs/meeting_assistant.log"


# For backward compatibility
MainControlConfig = MeetingAssistantConfig
