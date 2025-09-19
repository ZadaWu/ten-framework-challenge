from abc import abstractmethod
import asyncio
import websockets
import datetime
import hashlib
import base64
import hmac
from urllib.parse import urlencode
import ssl
from wsgiref.handlers import format_date_time
from datetime import datetime
from time import mktime
import json
from .const import TIMEOUT_CODE
from websockets.protocol import State
from ten_ai_base.timeline import AudioTimeline
from ten_ai_base.const import (
    LOG_CATEGORY_VENDOR,
)
from ten_runtime import (
    AsyncTenEnv,
)
from .audio_buffer_manager import AudioBufferManager


STATUS_FIRST_FRAME = 0  # First frame identifier
STATUS_CONTINUE_FRAME = 1  # Middle frame identifier
STATUS_LAST_FRAME = 2  # Last frame identifier


class XfyunWSRecognitionCallback:
    """WebSocket Speech Recognition Callback Interface"""

    @abstractmethod
    async def on_open(self):
        """Called when connection is established"""

    @abstractmethod
    async def on_result(self, message_data):
        """
        Recognition result callback
        :param message_data: Complete recognition result data
        """

    @abstractmethod
    async def on_error(self, error_msg, error_code=None):
        """Error callback"""

    @abstractmethod
    async def on_close(self):
        """Called when connection is closed"""


class XfyunWSRecognition:
    """Async WebSocket-based speech recognition class"""

    def __init__(
        self,
        app_id: str,
        api_key: str,
        api_secret: str,
        audio_timeline: AudioTimeline,
        ten_env: AsyncTenEnv,
        config: dict,
        callback: XfyunWSRecognitionCallback,
    ):
        """
        Initialize WebSocket speech recognition
        :param app_id: Application ID
        :param api_key: API key
        :param api_secret: API secret
        :param ten_env: Ten environment object for logging
        :param config: Configuration parameter dictionary, including the following optional parameters
        """
        self.app_id = app_id
        self.api_key = api_key
        self.api_secret = api_secret
        self.ten_env = ten_env
        self.audio_timeline = audio_timeline

        self.config = config

        if self.config is None:
            self.config = {}

        self.host = self.config["host"]
        self.callback = callback

        # Common parameters
        self.common_args = {"app_id": self.app_id}

        # Business parameters - extract all business-related parameters from config
        self.business_args = {}

        # Required business parameters
        required_business_params = ["domain", "language", "accent"]
        for param in required_business_params:
            if param in self.config:
                self.business_args[param] = self.config[param]

        # Optional business parameters
        optional_business_params = [
            "dwa",
            "request_id",
            "eos",
            "pd",
            "res_id",
            "vto",
            "punc",
            "nunum",
            "pptaw",
            "dyhotws",
            "personalization",
            "seg_max",
            "seg_min",
            "seg_weight",
            "speex_size",
            "spkdia",
            "pgsnum",
            "vad_mdn",
            "language_type",
            "dhw",
            "dhw_mod",
            "feature_list",
            "rsgid",
            "rlang",
            "pgs_flash_freq",
        ]
        for param in optional_business_params:
            if param in self.config:
                self.business_args[param] = self.config[param]

        self.websocket = None
        self.is_started = False
        self.is_first_frame = True
        self._message_task = None
        self._consumer_task = None

        self.audio_buffer = AudioBufferManager(
            ten_env=self.ten_env, threshold=1280
        )

    def _create_url(self):
        """Generate WebSocket connection URL"""
        url = f"wss://{self.host}/v2/ist"

        # Generate RFC1123 format timestamp
        now = datetime.now()
        date = format_date_time(mktime(now.timetuple()))

        # Concatenate string
        signature_origin = f"host: {self.host}\n"
        signature_origin += f"date: {date}\n"
        signature_origin += "GET /v2/ist HTTP/1.1"

        # Encrypt using hmac-sha256
        signature_sha = hmac.new(
            self.api_secret.encode("utf-8"),
            signature_origin.encode("utf-8"),
            digestmod=hashlib.sha256,
        ).digest()
        signature_sha = base64.b64encode(signature_sha).decode(encoding="utf-8")

        authorization_origin = f'api_key="{self.api_key}", algorithm="hmac-sha256", headers="host date request-line", signature="{signature_sha}"'
        authorization = base64.b64encode(
            authorization_origin.encode("utf-8")
        ).decode(encoding="utf-8")

        # Combine authentication parameters into dictionary
        v = {"authorization": authorization, "host": self.host, "date": date}
        url = url + "?" + urlencode(v)
        return url

    async def _handle_message(self, message):
        """Handle WebSocket message"""
        try:
            message_data = json.loads(message)
            code = message_data.get("code")
            sid = message_data.get("sid")
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            self.ten_env.log_info(f"[{timestamp}] message: {message}")

            if self.ten_env:
                self.ten_env.log_debug(
                    f"vendor_result: on_recognized: {message}",
                    category=LOG_CATEGORY_VENDOR,
                )

            if code != 0:
                error_msg = message_data.get("message")
                self.ten_env.log_info(
                    f"[{timestamp}] sid: {sid} call error: {error_msg}, code: {code}"
                )
                await self.callback.on_error(error_msg, code)
            else:
                await self.callback.on_result(message_data)

        except Exception as e:
            error_msg = f"Error processing message: {e}"
            self.ten_env.log_info(
                f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {error_msg}"
            )
            await self.callback.on_error(error_msg)

    async def _message_handler(self):
        """Handle incoming WebSocket messages"""
        try:
            if self.websocket is None:
                return
            ws = self.websocket
            async for message in ws:
                await self._handle_message(message)
        except websockets.exceptions.ConnectionClosed:
            self.ten_env.log_info("WebSocket connection closed")
        except Exception as e:
            error_msg = f"WebSocket message handler error: {e}"
            self.ten_env.log_info(f"### {error_msg} ###")
            await self.callback.on_error(error_msg)
        finally:
            self.is_started = False
            await self.callback.on_close()

    async def start(self, timeout=10):
        """
        Start speech recognition service
        :param timeout: Connection timeout in seconds, default 10 seconds
        """
        if self.is_connected():
            self.ten_env.log_info("Recognition already started")
            return True

        try:
            ws_url = self._create_url()
            self.ten_env.log_info(f"Connecting to: {ws_url}")

            # Create SSL context that doesn't verify certificates (similar to original)
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE

            # Connect to WebSocket with timeout
            self.websocket = await websockets.connect(
                ws_url, ssl=ssl_context, open_timeout=timeout
            )

            self.ten_env.log_info("### WebSocket opened ###")
            self.is_first_frame = True
            self.is_started = True

            # Start message handler task
            self._message_task = asyncio.create_task(self._message_handler())

            # Start consumer task for sending audio from buffer
            self._consumer_task = asyncio.create_task(self._consume_and_send())

            await self.callback.on_open()

            self.ten_env.log_info("Recognition started successfully")
            return True
        except asyncio.TimeoutError:
            error_msg = f"Connection timeout after {timeout} seconds"
            self.ten_env.log_error(f"Failed to start recognition: {error_msg}")
            await self.callback.on_error(error_msg, TIMEOUT_CODE)
            return False
        except Exception as e:
            error_msg = f"Failed to start recognition: {e}"
            self.ten_env.log_error(error_msg)
            await self.callback.on_error(error_msg)
            return False

    async def send_audio_frame(self, audio_data):
        """
        Producer side: push audio bytes into buffer.
        :param audio_data: Audio data (bytes)
        """
        try:
            await self.audio_buffer.push_audio(audio_data)
        except Exception as e:
            self.ten_env.log_info(f"Failed to enqueue audio frame: {e}")
            await self.callback.on_error(f"Failed to enqueue audio frame: {e}")

    async def _consume_and_send(self):
        """Consumer loop: pull chunks from buffer and send over websocket."""
        sample_rate = self.config.get("sample_rate", 16000)
        try:
            while True:
                chunk = await self.audio_buffer.pull_chunk()
                if chunk == b"":
                    # EOF after close and buffer drained
                    break

                # Build payload
                if self.is_first_frame:
                    self.ten_env.log_info(
                        f"Sending first frame data: {self.business_args}"
                    )
                    d = {
                        "common": self.common_args,
                        "business": self.business_args,
                        "data": {
                            "status": STATUS_FIRST_FRAME,
                            "format": f"audio/L16;rate={sample_rate}",
                            "audio": str(base64.b64encode(chunk), "utf-8"),
                            "encoding": "raw",
                        },
                    }
                    self.is_first_frame = False
                else:
                    d = {
                        "data": {
                            "status": STATUS_CONTINUE_FRAME,
                            "format": f"audio/L16;rate={sample_rate}",
                            "audio": str(base64.b64encode(chunk), "utf-8"),
                            "encoding": "raw",
                        }
                    }

                # Update timeline based on actual sent bytes
                duration_ms = int(len(chunk) / (sample_rate / 1000 * 2))
                self.audio_timeline.add_user_audio(duration_ms)
                if self.websocket is None:
                    break
                await self.websocket.send(json.dumps(d))
        except websockets.exceptions.ConnectionClosed:
            self.ten_env.log_info(
                "WebSocket connection closed while consuming audio frames"
            )
            self.is_started = False
        except Exception as e:
            self.ten_env.log_info(f"Consumer loop error: {e}")
            await self.callback.on_error(f"Consumer loop error: {e}")

    async def stop(self):
        """
        Stop speech recognition
        """
        if not self.is_connected():
            self.ten_env.log_info("Recognition not started")
            return

        try:
            # Close producer buffer so consumer drains remaining bytes and exits
            self.audio_buffer.close()
            if self._consumer_task:
                try:
                    await self._consumer_task
                except asyncio.CancelledError:
                    pass
            # Send end identifier
            d = {
                "data": {
                    "status": STATUS_LAST_FRAME,
                    "format": f"audio/L16;rate={self.config.get('sample_rate', 16000)}",
                    "audio": "",
                    "encoding": "raw",
                }
            }
            ws = self.websocket
            if ws is not None:
                await ws.send(json.dumps(d))
            self.is_started = False
            if self.ten_env:
                self.ten_env.log_info(
                    f"vendor_cmd: ${json.dumps(d)}",
                    category=LOG_CATEGORY_VENDOR,
                )

        except websockets.exceptions.ConnectionClosed:
            self.ten_env.log_info("WebSocket connection already closed")
        except Exception as e:
            self.ten_env.log_info(f"Failed to stop recognition: {e}")
            await self.callback.on_error(f"Failed to stop recognition: {e}")

    async def stop_consumer(self):
        """Stop consumer task"""
        if self._consumer_task and not self._consumer_task.done():
            self._consumer_task.cancel()
            try:
                await self._consumer_task
            except asyncio.CancelledError:
                pass

    async def close(self):
        """Close WebSocket connection"""
        if self.websocket:
            try:
                if self.websocket.state == State.OPEN:
                    await self.websocket.close()
            except Exception as e:
                self.ten_env.log_info(f"Error closing websocket: {e}")

        await self.stop_consumer()

        if self._message_task and not self._message_task.done():
            self._message_task.cancel()
            try:
                await self._message_task
            except asyncio.CancelledError:
                pass

        self.is_started = False
        self.is_first_frame = True
        self.ten_env.log_info("WebSocket connection closed")

    def is_connected(self) -> bool:
        """Check if WebSocket connection is established"""
        if self.websocket is None:
            return False

        # Check if websocket is still open by checking the state
        try:
            # For websockets library, we can check the state attribute
            if hasattr(self.websocket, "state"):
                return self.is_started and self.websocket.state == State.OPEN
            # Fallback: just check if websocket exists and is_started is True
            else:
                return self.is_started
        except Exception:
            # If any error occurs, assume disconnected
            return False
