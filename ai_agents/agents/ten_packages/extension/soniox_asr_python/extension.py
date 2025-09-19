#
# This file is part of TEN Framework, an open source project.
# Licensed under the Apache License, Version 2.0.
# See the LICENSE file for more information.
#
import asyncio
import json
import os
import time
from typing import List, Optional, Tuple

from ten_ai_base.const import (
    LOG_CATEGORY_VENDOR,
    LOG_CATEGORY_KEY_POINT,
)
from ten_ai_base.asr import (
    ASRBufferConfig,
    ASRBufferConfigModeKeep,
    ASRResult,
    AsyncASRBaseExtension,
)
from ten_ai_base.dumper import Dumper
from ten_ai_base.message import (
    ModuleError,
    ModuleErrorCode,
    ModuleErrorVendorInfo,
)
from ten_runtime import AsyncTenEnv, AudioFrame, Data
from typing_extensions import override

from .config import SonioxASRConfig
from .const import DUMP_FILE_NAME, MODULE_NAME_ASR, map_language_code
from .websocket import (
    SonioxFinToken,
    SonioxTranscriptToken,
    SonioxTranslationToken,
    SonioxToken,
    SonioxWebsocketClient,
    SonioxWebsocketEvents,
)


class SonioxASRExtension(AsyncASRBaseExtension):
    def __init__(self, name: str):
        super().__init__(name)
        self.connected: bool = False
        self.websocket: Optional[SonioxWebsocketClient] = None
        self.config: Optional[SonioxASRConfig] = None
        self.audio_dumper: Optional[Dumper] = None
        self.sent_user_audio_duration_ms_before_last_reset: int = 0
        self.last_finalize_timestamp: int = 0

    @override
    def vendor(self) -> str:
        return "soniox"

    @override
    async def on_init(self, ten_env: AsyncTenEnv) -> None:
        await super().on_init(ten_env)

        config_json, _ = await ten_env.get_property_to_json("")

        try:
            self.config = SonioxASRConfig.model_validate_json(config_json)
            self.config.update(self.config.params)
            ten_env.log_info(
                f"config: {self.config.to_str(sensitive_handling=True)}",
                category=LOG_CATEGORY_KEY_POINT,
            )

            if self.config.dump:
                dump_file_path = os.path.join(
                    self.config.dump_path, DUMP_FILE_NAME
                )
                self.audio_dumper = Dumper(dump_file_path)
        except Exception as e:
            ten_env.log_error(f"invalid property: {e}")
            self.config = SonioxASRConfig.model_validate_json("{}")
            await self.send_asr_error(
                ModuleError(
                    module=MODULE_NAME_ASR,
                    code=ModuleErrorCode.FATAL_ERROR.value,
                    message=str(e),
                ),
            )

    @override
    async def start_connection(self) -> None:
        assert self.config is not None
        self.ten_env.log_info("start_connection")

        if not self.config.params.get("api_key"):
            self.ten_env.log_error("Missing required api_key")
            await self.send_asr_error(
                ModuleError(
                    module=MODULE_NAME_ASR,
                    code=ModuleErrorCode.FATAL_ERROR.value,
                    message="Missing required api_key",
                ),
            )
            return

        try:
            start_request = json.dumps(self.config.params)
            ws = SonioxWebsocketClient(self.config.url, start_request)
            ws.on(SonioxWebsocketEvents.OPEN, self._handle_open)
            ws.on(SonioxWebsocketEvents.CLOSE, self._handle_close)
            ws.on(SonioxWebsocketEvents.EXCEPTION, self._handle_exception)
            ws.on(SonioxWebsocketEvents.ERROR, self._handle_error)
            ws.on(SonioxWebsocketEvents.FINISHED, self._handle_finished)
            ws.on(SonioxWebsocketEvents.TRANSCRIPT, self._handle_transcript)
            self.websocket = ws
            asyncio.create_task(ws.connect())
        except Exception as e:
            self.ten_env.log_error(f"start_connection failed: {e}")
            await self.send_asr_error(
                ModuleError(
                    module=MODULE_NAME_ASR,
                    code=ModuleErrorCode.FATAL_ERROR.value,
                    message=str(e),
                ),
            )
            return

        try:
            if self.audio_dumper:
                await self.audio_dumper.start()
        except Exception as e:
            self.ten_env.log_error(f"Failed to start audio dumper: {e}")
            await self.send_asr_error(
                ModuleError(
                    module=MODULE_NAME_ASR,
                    code=ModuleErrorCode.NON_FATAL_ERROR.value,
                    message=str(e),
                ),
            )

    @override
    async def stop_connection(self) -> None:
        self.ten_env.log_info("stop_connection")
        if self.audio_dumper:
            await self.audio_dumper.stop()
        if self.websocket:
            await self.websocket.stop()
        self.connected = False

    @override
    def is_connected(self) -> bool:
        return self.connected and self.websocket is not None

    @override
    def buffer_strategy(self) -> ASRBufferConfig:
        return ASRBufferConfigModeKeep(byte_limit=1024 * 1024 * 10)

    @override
    def input_audio_sample_rate(self) -> int:
        return 16000

    @override
    def input_audio_channels(self) -> int:
        return 1

    @override
    def input_audio_sample_width(self) -> int:
        return 2

    @override
    async def send_audio(
        self, frame: AudioFrame, session_id: Optional[str]
    ) -> bool:
        assert self.config is not None
        assert self.websocket is not None

        buf = frame.lock_buf()
        if self.audio_dumper:
            await self.audio_dumper.push_bytes(bytes(buf))
        self.audio_timeline.add_user_audio(
            int(len(buf) / (self.config.sample_rate / 1000 * 2))
        )

        await self.websocket.send_audio(bytes(buf))
        frame.unlock_buf(buf)

        return True

    @override
    async def finalize(self, session_id: Optional[str]) -> None:
        # NOTE: This is an empty method, actual finalize logic is handled in on_data.
        pass

    @override
    async def on_data(self, ten_env: AsyncTenEnv, data: Data) -> None:
        await super().on_data(ten_env, data)
        if data.get_name() == "asr_finalize":
            # NOTE: We need this extra parameter for manual finalization in order to achieve lower finalization latency.
            # Refer to: https://soniox.com/docs/stt/rt/manual-finalization#trailing-silence
            #
            # This property is not in the asr api, but will be included in the future.
            # The upstream can set this property if it knows the trailing silence duration.
            silence_duration_ms, err = data.get_property_int(
                "silence_duration_ms"
            )
            if err:
                await self._real_finalize()
            else:
                await self._real_finalize(silence_duration_ms)

    async def _real_finalize(
        self, silence_duration_ms: int | None = None
    ) -> None:
        self.ten_env.log_info(
            f"vendor_cmd: finalize, silence_duration_ms: {silence_duration_ms}",
            category=LOG_CATEGORY_VENDOR,
        )
        self.last_finalize_timestamp = int(time.time() * 1000)
        if self.websocket:
            await self.websocket.finalize(silence_duration_ms)

    async def _finalize_end(self) -> None:
        self.ten_env.log_info("finalize end")
        if self.last_finalize_timestamp != 0:
            timestamp = int(time.time() * 1000)
            latency = timestamp - self.last_finalize_timestamp
            self.ten_env.log_info(
                f"finalize end at {timestamp}, latency: {latency}",
                category=LOG_CATEGORY_KEY_POINT,
            )
            self.last_finalize_timestamp = 0
            await self.send_asr_finalize_end()

    # WebSocket event handlers
    async def _handle_open(self):
        self.ten_env.log_info(
            "vendor_status_changed: connection opened",
            category=LOG_CATEGORY_VENDOR,
        )
        self.sent_user_audio_duration_ms_before_last_reset += (
            self.audio_timeline.get_total_user_audio_duration()
        )
        self.audio_timeline.reset()
        self.connected = True

    async def _handle_close(self):
        self.ten_env.log_info(
            "vendor_status_changed: connection closed",
            category=LOG_CATEGORY_VENDOR,
        )
        self.connected = False

    async def _handle_exception(self, e: Exception):
        self.ten_env.log_error(
            f"soniox connection exception: {type(e)} {str(e)}"
        )
        await self._handle_error(-1, str(e))

    async def _handle_error(self, error_code: int, error_message: str):
        self.ten_env.log_error(
            f"vendor_error: code: {error_code}, message: {error_message}",
            category=LOG_CATEGORY_VENDOR,
        )
        error_msg = f"soniox error {error_code}: {error_message}"
        await self.send_asr_error(
            ModuleError(
                module=MODULE_NAME_ASR,
                code=ModuleErrorCode.NON_FATAL_ERROR.value,
                message=error_msg,
            ),
            ModuleErrorVendorInfo(
                vendor="soniox",
                code=str(error_code),
                message=error_message,
            ),
        )

    async def _handle_finished(
        self, final_audio_proc_ms: int, total_audio_proc_ms: int
    ):
        self.ten_env.log_info(
            f"soniox finished: final_audio_proc_ms={final_audio_proc_ms}, total_audio_proc_ms={total_audio_proc_ms}"
        )

    async def _handle_transcript(
        self,
        tokens: List[SonioxToken],
        final_audio_proc_ms: int,
        total_audio_proc_ms: int,
    ):
        self.ten_env.log_debug(
            f"vendor_result: transcript: {tokens}, final_audio_proc_ms: {final_audio_proc_ms}, total_audio_proc_ms: {total_audio_proc_ms}",
            category=LOG_CATEGORY_VENDOR,
        )
        try:
            transcript_tokens, unused_translation_tokens, fin = (
                self._group_tokens(tokens)
            )

            final_tokens, non_final_tokens = (
                self._group_transcript_tokens_by_final(transcript_tokens)
            )

            if final_tokens:
                await self._send_tokens(final_tokens, is_final=True)

            if non_final_tokens:
                await self._send_tokens(non_final_tokens, is_final=False)

            if fin:
                await self._finalize_end()

        except Exception as e:
            self.ten_env.log_error(f"Error handling transcript: {e}")

    def _group_tokens(
        self,
        tokens: List[SonioxToken],
    ) -> Tuple[List[SonioxTranscriptToken], List[SonioxTranslationToken], bool]:
        transcript_tokens = []
        translation_tokens = []
        fin = False

        for token in tokens:
            if isinstance(token, SonioxTranscriptToken):
                transcript_tokens.append(token)
            elif isinstance(token, SonioxTranslationToken):
                translation_tokens.append(token)
            elif isinstance(token, SonioxFinToken):
                fin = True
            # ignore end token

        return transcript_tokens, translation_tokens, fin

    def _group_transcript_tokens_by_final(
        self, tokens: List[SonioxTranscriptToken]
    ) -> Tuple[List[SonioxTranscriptToken], List[SonioxTranscriptToken]]:
        final_tokens = []
        non_final_tokens = []

        for token in tokens:
            if token.is_final:
                final_tokens.append(token)
            else:
                non_final_tokens.append(token)

        return final_tokens, non_final_tokens

    async def _send_tokens(
        self, tokens: List[SonioxTranscriptToken], is_final: bool = False
    ) -> None:
        results = self._create_asr_results(tokens, is_final)
        for result in results:
            await self.send_asr_result(result)

    def _create_asr_results(
        self, tokens: List[SonioxTranscriptToken], is_final: bool
    ) -> List[ASRResult]:
        if not tokens:
            return []

        results = []
        current_language = map_language_code(tokens[0].language or "en")
        current_tokens = []

        for token in tokens:
            token_language = map_language_code(token.language or "en")

            if token_language != current_language and current_tokens:
                result = self._create_single_asr_result(
                    current_tokens, current_language, is_final
                )
                results.append(result)
                current_tokens = []
                current_language = token_language

            current_tokens.append(token)

        if current_tokens:
            result = self._create_single_asr_result(
                current_tokens, current_language, is_final
            )
            results.append(result)

        return results

    def _create_single_asr_result(
        self, tokens: List[SonioxTranscriptToken], language: str, is_final: bool
    ) -> ASRResult:
        words = []
        text = ""
        start_ms = tokens[0].start_ms
        end_ms = tokens[-1].end_ms
        duration_ms = end_ms - start_ms

        for token in tokens:
            word = {
                "word": token.text,
                "start_ms": self._adjust_timestamp(token.start_ms),
                "duration_ms": token.end_ms - token.start_ms,
                "stable": token.is_final,
            }
            words.append(word)
            text += token.text

        return ASRResult(
            id=str(int(time.time() * 1000)),
            text=text,
            final=is_final,
            start_ms=self._adjust_timestamp(start_ms),
            duration_ms=duration_ms,
            language=language,
            words=words,
        )

    def _adjust_timestamp(self, timestamp_ms: int) -> int:
        return int(
            self.audio_timeline.get_audio_duration_before_time(timestamp_ms)
            + self.sent_user_audio_duration_ms_before_last_reset
        )
