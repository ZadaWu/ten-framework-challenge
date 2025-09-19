import asyncio
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from ten_runtime import AsyncTenEnv
from .events import SummaryGeneratedEvent, MeetingSummary
from .llm_exec import LLMExec


class SummaryGenerator:
    """Generator for meeting summaries at different levels."""

    def __init__(self, ten_env: AsyncTenEnv, llm_exec: LLMExec):
        self.ten_env = ten_env
        self.llm_exec = llm_exec
        self.summary_cache: Dict[str, Dict] = {}
        self.summary_prompts = {
            "real_time": """
请根据以下会议对话内容，生成一个简洁的实时总结（不超过100字）：

对话内容：
{content}

请提取：
1. 主要讨论的话题
2. 关键观点或结论
3. 需要关注的要点

总结：""",

            "section": """
请根据以下会议片段内容，生成一个详细的阶段总结：

会议阶段：{section}
对话内容：
{content}

请提取：
1. 该阶段的主要议题
2. 讨论的关键内容
3. 达成的共识或结论
4. 待解决的问题

总结：""",

            "final": """
请根据以下完整的会议内容，生成一个全面的会议总结：

会议信息：
- 会议时长：{duration}分钟
- 参与人员：{participants}
- 会议议程：{agenda}

完整转录：
{content}

关键要点：
{key_points}

决策事项：
{decisions}

请生成包含以下内容的总结：
1. 会议概述
2. 主要讨论内容
3. 重要决策和结论
4. 关键成果
5. 遗留问题

总结：""",

            "action_summary": """
请根据以下会议内容，总结所有的行动项和待办事项：

会议内容：
{content}

请识别并列出：
1. 具体的行动项或任务
2. 负责人（如果明确提到）
3. 截止时间或时间要求
4. 任务优先级

格式要求：
- 每个行动项单独一行
- 格式：[任务] - [负责人] - [截止时间] - [优先级]
- 如果信息不明确，请标注"待确认"

行动项清单："""
        }

    async def generate_real_time_summary(self, content: str, meeting_id: str) -> Optional[SummaryGeneratedEvent]:
        """Generate real-time summary from recent conversation."""
        try:
            if not content.strip():
                return None

            prompt = self.summary_prompts["real_time"].format(content=content)
            summary = await self._call_llm_for_summary(prompt)

            if summary:
                event = SummaryGeneratedEvent(
                    summary_type="real_time",
                    content=summary,
                    timestamp=datetime.now(),
                    meeting_id=meeting_id
                )

                # Cache the summary
                if meeting_id not in self.summary_cache:
                    self.summary_cache[meeting_id] = {"real_time": []}
                self.summary_cache[meeting_id]["real_time"].append({
                    "content": summary,
                    "timestamp": datetime.now(),
                    "source_content": content[:200] + "..." if len(content) > 200 else content
                })

                return event

        except Exception as e:
            self.ten_env.log_error(f"Failed to generate real-time summary: {e}")

        return None

    async def generate_section_summary(self, content: str, section: str, meeting_id: str) -> Optional[SummaryGeneratedEvent]:
        """Generate summary for a specific meeting section/phase."""
        try:
            if not content.strip():
                return None

            prompt = self.summary_prompts["section"].format(
                section=section,
                content=content
            )
            summary = await self._call_llm_for_summary(prompt)

            if summary:
                event = SummaryGeneratedEvent(
                    summary_type="section",
                    content=summary,
                    timestamp=datetime.now(),
                    meeting_id=meeting_id,
                    section=section
                )

                # Cache the summary
                if meeting_id not in self.summary_cache:
                    self.summary_cache[meeting_id] = {}
                if "sections" not in self.summary_cache[meeting_id]:
                    self.summary_cache[meeting_id]["sections"] = {}

                self.summary_cache[meeting_id]["sections"][section] = {
                    "content": summary,
                    "timestamp": datetime.now(),
                    "source_length": len(content)
                }

                return event

        except Exception as e:
            self.ten_env.log_error(f"Failed to generate section summary: {e}")

        return None

    async def generate_final_summary(self, meeting_summary: MeetingSummary) -> Optional[SummaryGeneratedEvent]:
        """Generate comprehensive final meeting summary."""
        try:
            # Prepare content
            transcript_content = "\n".join([
                f"[{item.get('timestamp', '')}] {item.get('speaker', 'Unknown')}: {item.get('text', '')}"
                for item in getattr(meeting_summary, 'transcript', [])
            ])

            participants_str = ", ".join([p.name for p in meeting_summary.participants])
            key_points_str = "\n".join([f"- {point}" for point in meeting_summary.key_points])
            decisions_str = "\n".join([f"- {decision}" for decision in meeting_summary.decisions])

            prompt = self.summary_prompts["final"].format(
                duration=meeting_summary.duration // 60,
                participants=participants_str,
                agenda=meeting_summary.agenda or "未指定议程",
                content=transcript_content,
                key_points=key_points_str,
                decisions=decisions_str
            )

            summary = await self._call_llm_for_summary(prompt)

            if summary:
                event = SummaryGeneratedEvent(
                    summary_type="final",
                    content=summary,
                    timestamp=datetime.now(),
                    meeting_id=meeting_summary.meeting_id
                )

                # Cache the final summary
                if meeting_summary.meeting_id not in self.summary_cache:
                    self.summary_cache[meeting_summary.meeting_id] = {}

                self.summary_cache[meeting_summary.meeting_id]["final"] = {
                    "content": summary,
                    "timestamp": datetime.now(),
                    "meeting_duration": meeting_summary.duration,
                    "participants_count": len(meeting_summary.participants)
                }

                return event

        except Exception as e:
            self.ten_env.log_error(f"Failed to generate final summary: {e}")

        return None

    async def generate_action_summary(self, content: str, meeting_id: str) -> Optional[str]:
        """Generate action items summary from meeting content."""
        try:
            prompt = self.summary_prompts["action_summary"].format(content=content)
            action_summary = await self._call_llm_for_summary(prompt)

            if action_summary:
                # Cache action summary
                if meeting_id not in self.summary_cache:
                    self.summary_cache[meeting_id] = {}

                self.summary_cache[meeting_id]["actions"] = {
                    "content": action_summary,
                    "timestamp": datetime.now(),
                    "source_length": len(content)
                }

                return action_summary

        except Exception as e:
            self.ten_env.log_error(f"Failed to generate action summary: {e}")

        return None

    async def get_progressive_summary(self, meeting_id: str) -> Optional[str]:
        """Get a progressive summary combining all previous summaries."""
        try:
            if meeting_id not in self.summary_cache:
                return None

            cache = self.summary_cache[meeting_id]
            summary_parts = []

            # Add real-time summaries
            if "real_time" in cache:
                summary_parts.append("## 实时总结要点")
                for item in cache["real_time"][-3:]:  # Last 3 real-time summaries
                    summary_parts.append(f"- {item['content']}")

            # Add section summaries
            if "sections" in cache:
                summary_parts.append("\n## 阶段总结")
                for section, data in cache["sections"].items():
                    summary_parts.append(f"### {section}")
                    summary_parts.append(data["content"])

            # Add action items if available
            if "actions" in cache:
                summary_parts.append("\n## 行动项总结")
                summary_parts.append(cache["actions"]["content"])

            return "\n".join(summary_parts) if summary_parts else None

        except Exception as e:
            self.ten_env.log_error(f"Failed to get progressive summary: {e}")
            return None

    async def _call_llm_for_summary(self, prompt: str) -> Optional[str]:
        """Call LLM to generate summary."""
        try:
            # Store current context
            original_context = self.llm_exec.get_context().copy() if hasattr(self.llm_exec, 'get_context') else []

            # Clear context for summary generation
            if hasattr(self.llm_exec, 'clear_context'):
                self.llm_exec.clear_context()

            # Add summary prompt
            await self.llm_exec.queue_input(prompt)
            await self.llm_exec.flush()

            # Wait for response (this is a simplified approach)
            # In a real implementation, this would be handled through the event system
            await asyncio.sleep(2)  # Give time for LLM to process

            # Get the last response
            # This is a placeholder - actual implementation would capture the LLM response
            summary = "摘要生成完成，请查看详细内容。"  # Placeholder

            # Restore original context
            if hasattr(self.llm_exec, 'set_context') and original_context:
                for msg in original_context:
                    await self.llm_exec.queue_input(msg.get('content', ''))

            return summary

        except Exception as e:
            self.ten_env.log_error(f"LLM summary generation failed: {e}")
            return None

    async def export_summaries(self, meeting_id: str, format: str = "markdown") -> Optional[str]:
        """Export all summaries for a meeting in specified format."""
        try:
            if meeting_id not in self.summary_cache:
                return None

            cache = self.summary_cache[meeting_id]

            if format == "markdown":
                lines = [f"# 会议总结 - {meeting_id}", ""]

                # Real-time summaries
                if "real_time" in cache:
                    lines.extend(["## 实时总结", ""])
                    for i, item in enumerate(cache["real_time"], 1):
                        lines.append(f"### 总结 {i}")
                        lines.append(f"**时间:** {item['timestamp']}")
                        lines.append(f"**内容:** {item['content']}")
                        lines.append("")

                # Section summaries
                if "sections" in cache:
                    lines.extend(["## 阶段总结", ""])
                    for section, data in cache["sections"].items():
                        lines.append(f"### {section}")
                        lines.append(f"**时间:** {data['timestamp']}")
                        lines.append(f"**内容:** {data['content']}")
                        lines.append("")

                # Final summary
                if "final" in cache:
                    lines.extend(["## 最终总结", ""])
                    lines.append(cache["final"]["content"])
                    lines.append("")

                # Action items
                if "actions" in cache:
                    lines.extend(["## 行动项", ""])
                    lines.append(cache["actions"]["content"])

                return "\n".join(lines)

            elif format == "json":
                import json
                return json.dumps(cache, default=str, ensure_ascii=False, indent=2)

            return None

        except Exception as e:
            self.ten_env.log_error(f"Failed to export summaries: {e}")
            return None

    def get_summary_stats(self, meeting_id: str) -> Dict:
        """Get statistics about generated summaries."""
        if meeting_id not in self.summary_cache:
            return {"status": "no_summaries"}

        cache = self.summary_cache[meeting_id]

        return {
            "meeting_id": meeting_id,
            "real_time_summaries": len(cache.get("real_time", [])),
            "section_summaries": len(cache.get("sections", {})),
            "has_final_summary": "final" in cache,
            "has_action_summary": "actions" in cache,
            "last_update": max([
                item.get("timestamp", datetime.min)
                for section in cache.values()
                if isinstance(section, (list, dict))
                for item in (section if isinstance(section, list) else [section])
                if isinstance(item, dict)
            ], default=datetime.min)
        }