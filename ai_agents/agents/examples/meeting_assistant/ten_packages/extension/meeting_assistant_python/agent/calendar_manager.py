import asyncio
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Union
from ten_runtime import AsyncTenEnv
from .events import ActionItem, CalendarEventEvent, MeetingSummary


class CalendarEvent:
    """Calendar event data model."""

    def __init__(
        self,
        id: str,
        title: str,
        start_time: datetime,
        end_time: datetime,
        description: str = "",
        participants: List[str] = None,
        location: str = "",
        meeting_type: str = "follow_up",
        related_meeting_id: Optional[str] = None,
        related_action_id: Optional[str] = None,
        recurrence: Optional[str] = None
    ):
        self.id = id
        self.title = title
        self.start_time = start_time
        self.end_time = end_time
        self.description = description
        self.participants = participants or []
        self.location = location
        self.meeting_type = meeting_type
        self.related_meeting_id = related_meeting_id
        self.related_action_id = related_action_id
        self.recurrence = recurrence
        self.created_at = datetime.now()
        self.status = "scheduled"


class CalendarManager:
    """Manager for creating and managing calendar events based on meeting outcomes."""

    def __init__(self, ten_env: AsyncTenEnv):
        self.ten_env = ten_env
        self.scheduled_events: Dict[str, List[CalendarEvent]] = {}
        self.calendar_apis = {}  # Will store different calendar API clients
        self.auto_scheduling = True
        self.default_meeting_duration = 60  # minutes
        self.business_hours = {"start": 9, "end": 18}  # 9 AM to 6 PM
        self.excluded_days = [5, 6]  # Saturday, Sunday (0=Monday)

    async def initialize_calendar_apis(self, config: Dict):
        """Initialize calendar API clients."""
        try:
            # Google Calendar API
            if config.get("google_calendar", {}).get("enabled"):
                await self._init_google_calendar(config["google_calendar"])

            # Outlook Calendar API
            if config.get("outlook_calendar", {}).get("enabled"):
                await self._init_outlook_calendar(config["outlook_calendar"])

            # Custom calendar webhook
            if config.get("webhook_calendar", {}).get("enabled"):
                await self._init_webhook_calendar(config["webhook_calendar"])

            self.ten_env.log_info("Calendar APIs initialized successfully")

        except Exception as e:
            self.ten_env.log_error(f"Failed to initialize calendar APIs: {e}")

    async def schedule_follow_up_meetings(self, action_items: List[ActionItem]) -> List[CalendarEventEvent]:
        """Schedule follow-up meetings based on action items."""
        try:
            calendar_events = []

            # Group action items by assignee and deadline
            grouped_actions = self._group_actions_for_scheduling(action_items)

            for group_key, actions in grouped_actions.items():
                if len(actions) > 1:  # Multiple related actions
                    event = await self._create_follow_up_meeting(actions)
                    if event:
                        calendar_events.append(event)

            return calendar_events

        except Exception as e:
            self.ten_env.log_error(f"Failed to schedule follow-up meetings: {e}")
            return []

    async def schedule_review_meeting(self, meeting_summary: MeetingSummary, days_ahead: int = 7) -> Optional[CalendarEventEvent]:
        """Schedule a review meeting based on the original meeting outcomes."""
        try:
            review_time = datetime.now() + timedelta(days=days_ahead)
            review_time = self._adjust_to_business_hours(review_time)

            title = f"Review Meeting: {meeting_summary.title}"
            description = f"""
Review meeting for: {meeting_summary.title}
Original meeting date: {meeting_summary.date.strftime('%Y-%m-%d')}

Key items to review:
{chr(10).join([f"- {point}" for point in meeting_summary.key_points[:5]])}

Action items to check:
{chr(10).join([f"- {item.action}" for item in meeting_summary.action_items[:5]])}
"""

            event = CalendarEvent(
                id=str(uuid.uuid4()),
                title=title,
                start_time=review_time,
                end_time=review_time + timedelta(minutes=self.default_meeting_duration),
                description=description,
                participants=[p.id for p in meeting_summary.participants],
                meeting_type="review",
                related_meeting_id=meeting_summary.meeting_id
            )

            # Store the event
            if meeting_summary.meeting_id not in self.scheduled_events:
                self.scheduled_events[meeting_summary.meeting_id] = []
            self.scheduled_events[meeting_summary.meeting_id].append(event)

            # Create calendar event
            calendar_event = CalendarEventEvent(
                event_title=event.title,
                event_time=event.start_time,
                duration=self.default_meeting_duration,
                participants=event.participants,
                description=event.description,
                meeting_id=meeting_summary.meeting_id
            )

            # Sync to external calendars
            await self._sync_to_external_calendars(event)

            return calendar_event

        except Exception as e:
            self.ten_env.log_error(f"Failed to schedule review meeting: {e}")
            return None

    async def schedule_deadline_reminders(self, action_items: List[ActionItem]) -> List[CalendarEventEvent]:
        """Schedule reminder events for action item deadlines."""
        try:
            reminder_events = []

            for action in action_items:
                if action.deadline:
                    # Schedule reminder 1 day before deadline
                    reminder_time = action.deadline - timedelta(days=1)
                    if reminder_time > datetime.now():
                        reminder_event = await self._create_reminder_event(action, reminder_time)
                        if reminder_event:
                            reminder_events.append(reminder_event)

                    # Schedule reminder 1 week before deadline (for longer-term tasks)
                    if action.deadline > datetime.now() + timedelta(days=7):
                        week_reminder = action.deadline - timedelta(days=7)
                        if week_reminder > datetime.now():
                            reminder_event = await self._create_reminder_event(action, week_reminder, "week")
                            if reminder_event:
                                reminder_events.append(reminder_event)

            return reminder_events

        except Exception as e:
            self.ten_env.log_error(f"Failed to schedule deadline reminders: {e}")
            return []

    async def _create_follow_up_meeting(self, actions: List[ActionItem]) -> Optional[CalendarEventEvent]:
        """Create a follow-up meeting for related action items."""
        try:
            if not actions:
                return None

            # Find the earliest deadline
            earliest_deadline = min([a.deadline for a in actions if a.deadline], default=None)
            if earliest_deadline:
                meeting_time = earliest_deadline - timedelta(days=2)  # 2 days before deadline
            else:
                meeting_time = datetime.now() + timedelta(days=3)  # 3 days from now

            meeting_time = self._adjust_to_business_hours(meeting_time)

            # Get all assignees
            assignees = list(set([a.assignee for a in actions if a.assignee]))

            title = f"Follow-up: {actions[0].action[:50]}..."
            if len(actions) > 1:
                title = f"Follow-up Meeting ({len(actions)} items)"

            description = f"""
Follow-up meeting to discuss progress on action items:

{chr(10).join([f"- {action.action} (Assignee: {action.assignee or 'TBD'})" for action in actions])}

Original meeting: {actions[0].meeting_id}
"""

            event = CalendarEvent(
                id=str(uuid.uuid4()),
                title=title,
                start_time=meeting_time,
                end_time=meeting_time + timedelta(minutes=self.default_meeting_duration),
                description=description,
                participants=assignees,
                meeting_type="follow_up",
                related_meeting_id=actions[0].meeting_id
            )

            calendar_event = CalendarEventEvent(
                event_title=event.title,
                event_time=event.start_time,
                duration=self.default_meeting_duration,
                participants=event.participants,
                description=event.description,
                meeting_id=actions[0].meeting_id,
                action_item_id=actions[0].id
            )

            # Store and sync
            if actions[0].meeting_id not in self.scheduled_events:
                self.scheduled_events[actions[0].meeting_id] = []
            self.scheduled_events[actions[0].meeting_id].append(event)

            await self._sync_to_external_calendars(event)

            return calendar_event

        except Exception as e:
            self.ten_env.log_error(f"Failed to create follow-up meeting: {e}")
            return None

    async def _create_reminder_event(self, action: ActionItem, reminder_time: datetime, reminder_type: str = "day") -> Optional[CalendarEventEvent]:
        """Create a reminder event for an action item."""
        try:
            title = f"Reminder: {action.action[:50]}..."
            description = f"""
Reminder for action item: {action.action}

Assignee: {action.assignee or 'TBD'}
Deadline: {action.deadline.strftime('%Y-%m-%d %H:%M') if action.deadline else 'No deadline'}
Priority: {action.priority}
Meeting: {action.meeting_id}

This is a {reminder_type} reminder.
"""

            event = CalendarEvent(
                id=str(uuid.uuid4()),
                title=title,
                start_time=reminder_time,
                end_time=reminder_time + timedelta(minutes=15),  # 15-minute reminder
                description=description,
                participants=[action.assignee] if action.assignee else [],
                meeting_type="reminder",
                related_meeting_id=action.meeting_id,
                related_action_id=action.id
            )

            calendar_event = CalendarEventEvent(
                event_title=event.title,
                event_time=event.start_time,
                duration=15,
                participants=event.participants,
                description=event.description,
                meeting_id=action.meeting_id,
                action_item_id=action.id
            )

            # Store and sync
            if action.meeting_id not in self.scheduled_events:
                self.scheduled_events[action.meeting_id] = []
            self.scheduled_events[action.meeting_id].append(event)

            await self._sync_to_external_calendars(event)

            return calendar_event

        except Exception as e:
            self.ten_env.log_error(f"Failed to create reminder event: {e}")
            return None

    def _group_actions_for_scheduling(self, actions: List[ActionItem]) -> Dict[str, List[ActionItem]]:
        """Group action items for efficient scheduling."""
        groups = {}

        for action in actions:
            # Group by assignee and deadline proximity
            assignee = action.assignee or "unassigned"
            deadline_week = action.deadline.isocalendar()[1] if action.deadline else "no_deadline"
            group_key = f"{assignee}_{deadline_week}"

            if group_key not in groups:
                groups[group_key] = []
            groups[group_key].append(action)

        # Only return groups with multiple items or high-priority single items
        return {k: v for k, v in groups.items() if len(v) > 1 or (len(v) == 1 and v[0].priority == "high")}

    def _adjust_to_business_hours(self, dt: datetime) -> datetime:
        """Adjust datetime to fall within business hours."""
        # Skip weekends
        while dt.weekday() in self.excluded_days:
            dt += timedelta(days=1)

        # Adjust to business hours
        if dt.hour < self.business_hours["start"]:
            dt = dt.replace(hour=self.business_hours["start"], minute=0, second=0)
        elif dt.hour >= self.business_hours["end"]:
            dt = dt.replace(hour=self.business_hours["start"], minute=0, second=0) + timedelta(days=1)
            # Check again for weekends
            while dt.weekday() in self.excluded_days:
                dt += timedelta(days=1)

        return dt

    async def _sync_to_external_calendars(self, event: CalendarEvent) -> bool:
        """Sync event to external calendar services."""
        try:
            success = True

            # Google Calendar
            if "google" in self.calendar_apis:
                google_success = await self._sync_to_google_calendar(event)
                success &= google_success

            # Outlook Calendar
            if "outlook" in self.calendar_apis:
                outlook_success = await self._sync_to_outlook_calendar(event)
                success &= outlook_success

            # Webhook
            if "webhook" in self.calendar_apis:
                webhook_success = await self._sync_to_webhook(event)
                success &= webhook_success

            return success

        except Exception as e:
            self.ten_env.log_error(f"Failed to sync to external calendars: {e}")
            return False

    async def _init_google_calendar(self, config: Dict):
        """Initialize Google Calendar API client."""
        try:
            # This is a placeholder for Google Calendar API initialization
            # In practice, you would use the Google Calendar API client library
            self.calendar_apis["google"] = {
                "client": None,  # Google Calendar API client
                "calendar_id": config.get("calendar_id", "primary"),
                "credentials": config.get("credentials_path")
            }
            self.ten_env.log_info("Google Calendar API initialized")

        except Exception as e:
            self.ten_env.log_error(f"Failed to initialize Google Calendar: {e}")

    async def _init_outlook_calendar(self, config: Dict):
        """Initialize Outlook Calendar API client."""
        try:
            # Placeholder for Outlook Calendar API initialization
            self.calendar_apis["outlook"] = {
                "client": None,  # Outlook API client
                "client_id": config.get("client_id"),
                "client_secret": config.get("client_secret"),
                "tenant_id": config.get("tenant_id")
            }
            self.ten_env.log_info("Outlook Calendar API initialized")

        except Exception as e:
            self.ten_env.log_error(f"Failed to initialize Outlook Calendar: {e}")

    async def _init_webhook_calendar(self, config: Dict):
        """Initialize webhook-based calendar integration."""
        try:
            self.calendar_apis["webhook"] = {
                "url": config.get("webhook_url"),
                "headers": config.get("headers", {}),
                "auth_token": config.get("auth_token")
            }
            self.ten_env.log_info("Webhook calendar integration initialized")

        except Exception as e:
            self.ten_env.log_error(f"Failed to initialize webhook calendar: {e}")

    async def _sync_to_google_calendar(self, event: CalendarEvent) -> bool:
        """Sync event to Google Calendar."""
        try:
            # Placeholder implementation
            # In practice, you would use the Google Calendar API
            self.ten_env.log_info(f"Synced event '{event.title}' to Google Calendar")
            return True

        except Exception as e:
            self.ten_env.log_error(f"Failed to sync to Google Calendar: {e}")
            return False

    async def _sync_to_outlook_calendar(self, event: CalendarEvent) -> bool:
        """Sync event to Outlook Calendar."""
        try:
            # Placeholder implementation
            self.ten_env.log_info(f"Synced event '{event.title}' to Outlook Calendar")
            return True

        except Exception as e:
            self.ten_env.log_error(f"Failed to sync to Outlook Calendar: {e}")
            return False

    async def _sync_to_webhook(self, event: CalendarEvent) -> bool:
        """Sync event via webhook."""
        try:
            import json
            import aiohttp

            webhook_config = self.calendar_apis.get("webhook", {})
            if not webhook_config.get("url"):
                return False

            payload = {
                "event": {
                    "id": event.id,
                    "title": event.title,
                    "start_time": event.start_time.isoformat(),
                    "end_time": event.end_time.isoformat(),
                    "description": event.description,
                    "participants": event.participants,
                    "location": event.location,
                    "meeting_type": event.meeting_type,
                    "related_meeting_id": event.related_meeting_id,
                    "related_action_id": event.related_action_id
                }
            }

            headers = webhook_config.get("headers", {})
            if webhook_config.get("auth_token"):
                headers["Authorization"] = f"Bearer {webhook_config['auth_token']}"

            async with aiohttp.ClientSession() as session:
                async with session.post(
                    webhook_config["url"],
                    json=payload,
                    headers=headers
                ) as response:
                    if response.status == 200:
                        self.ten_env.log_info(f"Synced event '{event.title}' via webhook")
                        return True
                    else:
                        self.ten_env.log_error(f"Webhook sync failed with status {response.status}")
                        return False

        except Exception as e:
            self.ten_env.log_error(f"Failed to sync via webhook: {e}")
            return False

    async def get_scheduled_events(self, meeting_id: str) -> List[CalendarEvent]:
        """Get all scheduled events for a meeting."""
        return self.scheduled_events.get(meeting_id, [])

    async def cancel_event(self, event_id: str, meeting_id: str) -> bool:
        """Cancel a scheduled event."""
        try:
            events = self.scheduled_events.get(meeting_id, [])
            for event in events:
                if event.id == event_id:
                    event.status = "cancelled"
                    # Cancel in external calendars
                    await self._cancel_in_external_calendars(event)
                    return True
            return False

        except Exception as e:
            self.ten_env.log_error(f"Failed to cancel event: {e}")
            return False

    async def _cancel_in_external_calendars(self, event: CalendarEvent) -> bool:
        """Cancel event in external calendar services."""
        try:
            # Implementation for cancelling in external calendars
            self.ten_env.log_info(f"Cancelled event '{event.title}' in external calendars")
            return True

        except Exception as e:
            self.ten_env.log_error(f"Failed to cancel in external calendars: {e}")
            return False

    def get_calendar_stats(self, meeting_id: str) -> Dict:
        """Get statistics about scheduled events."""
        events = self.scheduled_events.get(meeting_id, [])

        stats = {
            "total_events": len(events),
            "follow_up_meetings": len([e for e in events if e.meeting_type == "follow_up"]),
            "review_meetings": len([e for e in events if e.meeting_type == "review"]),
            "reminders": len([e for e in events if e.meeting_type == "reminder"]),
            "scheduled": len([e for e in events if e.status == "scheduled"]),
            "cancelled": len([e for e in events if e.status == "cancelled"]),
            "upcoming": len([e for e in events if e.start_time > datetime.now() and e.status == "scheduled"])
        }

        return stats