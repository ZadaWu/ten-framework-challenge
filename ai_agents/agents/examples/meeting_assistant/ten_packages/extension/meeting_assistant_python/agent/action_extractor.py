import re
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from ten_runtime import AsyncTenEnv
from .events import ActionItem, ActionItemEvent
from .llm_exec import LLMExec


class ActionExtractor:
    """Extractor for identifying and processing action items from meeting content."""

    def __init__(self, ten_env: AsyncTenEnv, llm_exec: LLMExec):
        self.ten_env = ten_env
        self.llm_exec = llm_exec
        self.action_items: Dict[str, List[ActionItem]] = {}
        self.action_patterns = self._compile_action_patterns()
        self.priority_keywords = {
            "high": ["urgent", "紧急", "立即", "马上", "高优先级", "critical", "asap"],
            "medium": ["important", "重要", "需要", "should", "建议"],
            "low": ["可以", "later", "稍后", "有时间", "low priority", "optional"]
        }
        self.time_patterns = self._compile_time_patterns()

    def _compile_action_patterns(self) -> List[re.Pattern]:
        """Compile regex patterns for action item detection."""
        patterns = [
            # Direct action assignments
            re.compile(r'(.+?)(负责|will\s+do|needs?\s+to|should|要|需要)(.+)', re.IGNORECASE),
            # Task descriptions
            re.compile(r'(任务|task|action|行动项)[:：](.+)', re.IGNORECASE),
            # Follow-up items
            re.compile(r'(跟进|follow.?up|next\s+step|下一步)[:：]?(.+)', re.IGNORECASE),
            # Assignments with names
            re.compile(r'(@\w+|[A-Za-z\u4e00-\u9fa5]+)\s+(负责|will|needs?\s+to|要)(.+)', re.IGNORECASE),
            # Todo items
            re.compile(r'(todo|待办|需要做的?)[:：](.+)', re.IGNORECASE),
            # Deadline patterns
            re.compile(r'(.+?)(在|by|before|until|截止|deadline)(.+?)(完成|finish|done)', re.IGNORECASE),
        ]
        return patterns

    def _compile_time_patterns(self) -> List[Tuple[re.Pattern, int]]:
        """Compile patterns for deadline extraction."""
        patterns = [
            # Specific dates
            (re.compile(r'(\d{1,2})[月/\-](\d{1,2})[日号]?'), 0),
            (re.compile(r'(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})[日]?'), 0),
            # Relative time
            (re.compile(r'明天|tomorrow'), 1),
            (re.compile(r'后天|day\s+after\s+tomorrow'), 2),
            (re.compile(r'下周|next\s+week'), 7),
            (re.compile(r'下个?月|next\s+month'), 30),
            (re.compile(r'(\d+)\s*天[后内]?|in\s+(\d+)\s+days?'), None),  # Variable days
            (re.compile(r'(\d+)\s*周[后内]?|in\s+(\d+)\s+weeks?'), None),  # Variable weeks
            (re.compile(r'这周[内末]?|this\s+week'), 7),
            (re.compile(r'本月[内末]?|this\s+month'), 30),
        ]
        return patterns

    async def extract_action_items(self, text: str, meeting_id: str, speaker_id: Optional[str] = None) -> List[ActionItemEvent]:
        """Extract action items from meeting text."""
        try:
            action_events = []

            # First, try pattern-based extraction
            pattern_actions = self._extract_with_patterns(text, meeting_id, speaker_id)
            action_events.extend(pattern_actions)

            # Then, try LLM-based extraction for more complex cases
            llm_actions = await self._extract_with_llm(text, meeting_id, speaker_id)
            action_events.extend(llm_actions)

            # Store extracted actions
            if meeting_id not in self.action_items:
                self.action_items[meeting_id] = []

            for event in action_events:
                action_item = ActionItem(
                    id=str(uuid.uuid4()),
                    action=event.action,
                    assignee=event.assignee,
                    deadline=event.deadline,
                    priority=event.priority,
                    status="pending",
                    created_at=datetime.now(),
                    meeting_id=meeting_id,
                    source_text=text
                )
                self.action_items[meeting_id].append(action_item)

            return action_events

        except Exception as e:
            self.ten_env.log_error(f"Failed to extract action items: {e}")
            return []

    def _extract_with_patterns(self, text: str, meeting_id: str, speaker_id: Optional[str] = None) -> List[ActionItemEvent]:
        """Extract action items using regex patterns."""
        actions = []

        try:
            for pattern in self.action_patterns:
                matches = pattern.finditer(text)

                for match in matches:
                    groups = match.groups()

                    # Extract action description
                    action_text = ""
                    assignee = None

                    if len(groups) >= 2:
                        # Try to identify the action part
                        for group in groups:
                            if group and len(group.strip()) > 3:  # Valid action text
                                if not any(keyword in group.lower() for keyword in ["负责", "will", "needs", "should", "要", "需要"]):
                                    action_text = group.strip()
                                    break

                    if not action_text:
                        continue

                    # Extract assignee
                    assignee = self._extract_assignee(text, speaker_id)

                    # Extract deadline
                    deadline = self._extract_deadline(text)

                    # Determine priority
                    priority = self._determine_priority(text)

                    action_event = ActionItemEvent(
                        action=action_text,
                        assignee=assignee,
                        deadline=deadline,
                        priority=priority,
                        meeting_id=meeting_id,
                        source_text=text
                    )

                    actions.append(action_event)

        except Exception as e:
            self.ten_env.log_error(f"Pattern extraction failed: {e}")

        return actions

    async def _extract_with_llm(self, text: str, meeting_id: str, speaker_id: Optional[str] = None) -> List[ActionItemEvent]:
        """Extract action items using LLM."""
        try:
            prompt = f"""
请从以下会议对话中提取具体的行动项或任务：

对话内容：
{text}

请识别：
1. 具体的行动项或任务
2. 负责人（如果提到）
3. 截止时间（如果提到）
4. 优先级（高/中/低）

要求：
- 只提取明确的行动项，不要推测
- 如果没有明确的行动项，请返回"无"
- 格式：[行动项] | [负责人] | [截止时间] | [优先级]

行动项："""

            # This is a simplified version - in practice, you'd implement proper LLM interaction
            # For now, return empty list
            return []

        except Exception as e:
            self.ten_env.log_error(f"LLM extraction failed: {e}")
            return []

    def _extract_assignee(self, text: str, default_speaker: Optional[str] = None) -> Optional[str]:
        """Extract assignee from text."""
        # Look for explicit name mentions
        name_patterns = [
            re.compile(r'(@\w+)'),  # @username
            re.compile(r'([A-Za-z\u4e00-\u9fa5]{2,})\s*负责'),  # Name + 负责
            re.compile(r'([A-Za-z\u4e00-\u9fa5]{2,})\s*will\s+do', re.IGNORECASE),
            re.compile(r'([A-Za-z\u4e00-\u9fa5]{2,})\s*needs?\s+to', re.IGNORECASE),
        ]

        for pattern in name_patterns:
            match = pattern.search(text)
            if match:
                return match.group(1).replace('@', '')

        # If no explicit assignee found, use the speaker
        return default_speaker

    def _extract_deadline(self, text: str) -> Optional[datetime]:
        """Extract deadline from text."""
        for pattern, days_offset in self.time_patterns:
            match = pattern.search(text)
            if match:
                if days_offset is not None:
                    return datetime.now() + timedelta(days=days_offset)
                else:
                    # Variable time patterns
                    groups = match.groups()
                    if groups and groups[0]:
                        try:
                            days = int(groups[0])
                            if "周" in match.group() or "week" in match.group():
                                days *= 7
                            return datetime.now() + timedelta(days=days)
                        except (ValueError, IndexError):
                            continue

        return None

    def _determine_priority(self, text: str) -> str:
        """Determine action item priority from text."""
        text_lower = text.lower()

        for priority, keywords in self.priority_keywords.items():
            if any(keyword in text_lower for keyword in keywords):
                return priority

        return "medium"  # Default priority

    async def categorize_actions(self, meeting_id: str) -> Dict[str, List[ActionItem]]:
        """Categorize action items by type, priority, or assignee."""
        try:
            if meeting_id not in self.action_items:
                return {}

            actions = self.action_items[meeting_id]
            categorized = {
                "by_priority": {"high": [], "medium": [], "low": []},
                "by_assignee": {},
                "by_deadline": {"overdue": [], "this_week": [], "next_week": [], "later": [], "no_deadline": []}
            }

            now = datetime.now()
            week_from_now = now + timedelta(days=7)
            two_weeks_from_now = now + timedelta(days=14)

            for action in actions:
                # By priority
                categorized["by_priority"][action.priority].append(action)

                # By assignee
                assignee = action.assignee or "unassigned"
                if assignee not in categorized["by_assignee"]:
                    categorized["by_assignee"][assignee] = []
                categorized["by_assignee"][assignee].append(action)

                # By deadline
                if action.deadline:
                    if action.deadline < now:
                        categorized["by_deadline"]["overdue"].append(action)
                    elif action.deadline <= week_from_now:
                        categorized["by_deadline"]["this_week"].append(action)
                    elif action.deadline <= two_weeks_from_now:
                        categorized["by_deadline"]["next_week"].append(action)
                    else:
                        categorized["by_deadline"]["later"].append(action)
                else:
                    categorized["by_deadline"]["no_deadline"].append(action)

            return categorized

        except Exception as e:
            self.ten_env.log_error(f"Failed to categorize actions: {e}")
            return {}

    async def update_action_status(self, meeting_id: str, action_id: str, status: str) -> bool:
        """Update the status of an action item."""
        try:
            if meeting_id in self.action_items:
                for action in self.action_items[meeting_id]:
                    if action.id == action_id:
                        action.status = status
                        self.ten_env.log_info(f"Updated action {action_id} status to {status}")
                        return True
            return False

        except Exception as e:
            self.ten_env.log_error(f"Failed to update action status: {e}")
            return False

    def get_action_items(self, meeting_id: str) -> List[ActionItem]:
        """Get all action items for a meeting."""
        return self.action_items.get(meeting_id, [])

    def get_pending_actions(self, meeting_id: str) -> List[ActionItem]:
        """Get pending action items for a meeting."""
        actions = self.action_items.get(meeting_id, [])
        return [action for action in actions if action.status == "pending"]

    def get_overdue_actions(self, meeting_id: str) -> List[ActionItem]:
        """Get overdue action items for a meeting."""
        actions = self.action_items.get(meeting_id, [])
        now = datetime.now()
        return [
            action for action in actions
            if action.deadline and action.deadline < now and action.status == "pending"
        ]

    async def export_action_items(self, meeting_id: str, format: str = "markdown") -> Optional[str]:
        """Export action items in specified format."""
        try:
            if meeting_id not in self.action_items:
                return None

            actions = self.action_items[meeting_id]

            if format == "markdown":
                lines = [f"# 行动项清单 - {meeting_id}", ""]

                # Group by status
                statuses = {}
                for action in actions:
                    if action.status not in statuses:
                        statuses[action.status] = []
                    statuses[action.status].append(action)

                for status, action_list in statuses.items():
                    lines.append(f"## {status.upper()}")
                    lines.append("")

                    for action in action_list:
                        checkbox = "- [x]" if status == "completed" else "- [ ]"
                        assignee_str = f" (@{action.assignee})" if action.assignee else ""
                        deadline_str = f" (截止: {action.deadline.strftime('%Y-%m-%d')})" if action.deadline else ""
                        priority_str = f" [{action.priority.upper()}]"

                        lines.append(f"{checkbox} {action.action}{assignee_str}{deadline_str}{priority_str}")

                    lines.append("")

                return "\n".join(lines)

            elif format == "json":
                import json
                actions_dict = [
                    {
                        "id": action.id,
                        "action": action.action,
                        "assignee": action.assignee,
                        "deadline": action.deadline.isoformat() if action.deadline else None,
                        "priority": action.priority,
                        "status": action.status,
                        "created_at": action.created_at.isoformat(),
                        "meeting_id": action.meeting_id
                    }
                    for action in actions
                ]
                return json.dumps(actions_dict, ensure_ascii=False, indent=2)

            return None

        except Exception as e:
            self.ten_env.log_error(f"Failed to export action items: {e}")
            return None

    def get_action_stats(self, meeting_id: str) -> Dict:
        """Get statistics about action items."""
        if meeting_id not in self.action_items:
            return {"status": "no_actions"}

        actions = self.action_items[meeting_id]

        stats = {
            "total": len(actions),
            "pending": len([a for a in actions if a.status == "pending"]),
            "completed": len([a for a in actions if a.status == "completed"]),
            "overdue": len([a for a in actions if a.deadline and a.deadline < datetime.now() and a.status == "pending"]),
            "high_priority": len([a for a in actions if a.priority == "high"]),
            "with_assignee": len([a for a in actions if a.assignee]),
            "with_deadline": len([a for a in actions if a.deadline])
        }

        return stats