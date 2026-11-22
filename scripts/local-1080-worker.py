#!/usr/bin/env python3
"""1080p MP4 transcode worker for the docs server (110.40.170.187).

The main site's video worker POSTs one job per new upload. This service queues
jobs with concurrency 1, downloads the original through a short-lived presigned
GET URL, produces a single 4 Mbps H.264/AAC MP4 (faststart, 2 threads), uploads
it through a presigned PUT URL, and calls back the main site.

Python 3.12 standard library only; ffmpeg/ffprobe are external binaries.

Endpoints
  GET  /healthcheck   no auth, returns {"ok": true, "busy": ..., "queued": ...}
  POST /jobs          Authorization: Bearer $LOCAL_1080_WORKER_SECRET

Job JSON
  {videoId, sourceUrl, uploadUrl, outputKey, contentType, callbackUrl}
  Local verification only: leave uploadUrl empty and send outputPath, and the
  finished MP4 is written there instead of being uploaded.

Environment
  LOCAL_1080_WORKER_SECRET  required; same value as the main site
  PORT                      default 3002
  BIND_HOST                 default 127.0.0.1
  FFMPEG_BIN / FFPROBE_BIN  default ffmpeg / ffprobe
  LOCAL_1080_QUEUE_MAX      default 20

Deployment assumptions (documented here, nothing is deployed by this repo):
  * Unit file at /etc/systemd/system/local-1080-worker.service runs this script
    as an unprivileged user with Nice=19 and the secret in an EnvironmentFile.
  * Caddy on the same host terminates TLS for a private hostname and proxies to
    127.0.0.1:3002. The main site sets
      LOCAL_1080_ENABLED=true
      LOCAL_1080_WORKER_URL=https://<transcode-host>
      LOCAL_1080_WORKER_SECRET=<same secret>
  * The docs server needs egress to the S3/COS origin host and to the main site.
"""

from __future__ import annotations

import hmac
import http.client
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

WORKER_SECRET = os.environ.get("LOCAL_1080_WORKER_SECRET", "").strip()
PORT = int(os.environ.get("PORT", "3002"))
BIND_HOST = os.environ.get("BIND_HOST", "127.0.0.1").strip() or "127.0.0.1"
FFMPEG_BIN = os.environ.get("FFMPEG_BIN", "ffmpeg")
FFPROBE_BIN = os.environ.get("FFPROBE_BIN", "ffprobe")
QUEUE_MAX = max(1, int(os.environ.get("LOCAL_1080_QUEUE_MAX", "20")))

CONTENT_TYPE = "video/mp4"
OUTPUT_FILENAME = "preview-1080.mp4"
DOWNLOAD_TIMEOUT_SECONDS = 300
CALLBACK_TIMEOUT_SECONDS = 30
FFMPEG_TIMEOUT_SECONDS = 2 * 60 * 60
MAX_SOURCE_BYTES = 20 * 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
ERROR_MAX_LENGTH = 500

_URL_RE = re.compile(r"https?://[^\s\"'<>]+")
_SAFE_TOKEN_RE = re.compile(r"[\x00-\x1f\x7f]+")


def log(message: str) -> None:
    print(f"[local-1080] {time.strftime('%Y-%m-%dT%H:%M:%S%z')} {message}", flush=True)


def sanitize_error(value: Any) -> str:
    """One line, no presigned query strings, bounded length."""
    text = str(value)
    text = _URL_RE.sub(lambda match: match.group(0).split("?", 1)[0], text)
    text = _SAFE_TOKEN_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return (text or "Unknown error")[:ERROR_MAX_LENGTH]


def describe_error(exc: BaseException) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        return f"HTTP {exc.code}"
    if isinstance(exc, urllib.error.URLError):
        return f"network error: {sanitize_error(exc.reason)}"
    if isinstance(exc, subprocess.CalledProcessError):
        stderr = exc.stderr.decode("utf-8", "replace") if isinstance(exc.stderr, bytes) else str(exc.stderr or "")
        tail = stderr.strip().splitlines()[-1] if stderr.strip() else "no stderr"
        return f"ffmpeg exited {exc.returncode}: {sanitize_error(tail)}"
    return f"{type(exc).__name__}: {sanitize_error(exc)}"


class JobError(Exception):
    pass


def even(value: float) -> int:
    return max(2, int(round(value / 2.0)) * 2)


def target_dimensions(width: int, height: int) -> tuple[int, int]:
    """Fit inside 1080 on the short side, preserve aspect, never upscale."""
    if width <= 0 or height <= 0:
        raise JobError("source has no usable video dimensions")
    if width >= height:
        if height <= 1080:
            return even(width), even(height)
        return even(width * 1080.0 / height), 1080
    if width <= 1080:
        return even(width), even(height)
    return 1080, even(height * 1080.0 / width)


def download_source(source_url: str, dest_path: str) -> int:
    request = urllib.request.Request(source_url, method="GET")
    total = 0
    with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
        if response.status != 200:
            raise JobError(f"source download HTTP {response.status}")
        with open(dest_path, "wb") as handle:
            while True:
                chunk = response.read(CHUNK_SIZE)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_SOURCE_BYTES:
                    raise JobError("source exceeds the configured size limit")
                handle.write(chunk)
    if total == 0:
        raise JobError("source download was empty")
    return total


def probe_dimensions(path: str) -> tuple[int, int]:
    result = subprocess.run(
        [
            FFPROBE_BIN, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "json", path,
        ],
        capture_output=True,
        timeout=120,
        check=False,
    )
    if result.returncode != 0:
        raise JobError(f"ffprobe exited {result.returncode}: {sanitize_error(result.stderr.decode('utf-8', 'replace'))}")
    try:
        streams = json.loads(result.stdout.decode("utf-8", "replace")).get("streams") or []
        width = int(streams[0]["width"])
        height = int(streams[0]["height"])
    except (ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise JobError(f"could not read source dimensions: {sanitize_error(exc)}") from exc
    return width, height


def transcode(source_path: str, output_path: str) -> None:
    width, height = target_dimensions(*probe_dimensions(source_path))
    command = [
        FFMPEG_BIN, "-hide_banner", "-nostdin", "-y",
        "-i", source_path,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", f"scale={width}:{height}",
        "-c:v", "libx264", "-preset", "faster",
        "-b:v", "4000k", "-maxrate", "4000k", "-bufsize", "8000k",
        "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
        "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p",
        "-threads", "2",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
        "-movflags", "+faststart",
        "-max_muxing_queue_size", "1024",
        output_path,
    ]
    log(f"transcoding to {width}x{height}")
    result = subprocess.run(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        timeout=FFMPEG_TIMEOUT_SECONDS,
        check=False,
    )
    if result.returncode != 0:
        tail = result.stderr.decode("utf-8", "replace").strip().splitlines()
        raise JobError(f"ffmpeg exited {result.returncode}: {sanitize_error(tail[-1] if tail else 'no stderr')}")
    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise JobError("ffmpeg produced no output")


def upload_output(upload_url: str, output_path: str) -> None:
    """Single-object PUT. Presigned URLs sign Content-Type, so it must match."""
    parts = urllib.parse.urlsplit(upload_url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise JobError("uploadUrl is not an http(s) URL")
    path = parts.path or "/"
    if parts.query:
        path = f"{path}?{parts.query}"
    connection_class = http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
    connection = connection_class(parts.hostname, parts.port, timeout=DOWNLOAD_TIMEOUT_SECONDS)
    size = os.path.getsize(output_path)
    try:
        connection.putrequest("PUT", path)
        connection.putheader("Content-Type", CONTENT_TYPE)
        connection.putheader("Content-Length", str(size))
        connection.endheaders()
        with open(output_path, "rb") as handle:
            while True:
                chunk = handle.read(CHUNK_SIZE)
                if not chunk:
                    break
                connection.send(chunk)
        response = connection.getresponse()
        response.read(4096)
        if response.status not in (200, 201, 204):
            raise JobError(f"upload HTTP {response.status}")
    finally:
        connection.close()


def post_callback(callback_url: str, payload: dict[str, Any]) -> None:
    if not callback_url:
        return
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        callback_url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {WORKER_SECRET}",
        },
    )
    with urllib.request.urlopen(request, timeout=CALLBACK_TIMEOUT_SECONDS) as response:
        response.read(4096)
        if response.status < 200 or response.status >= 300:
            raise JobError(f"callback HTTP {response.status}")


def process_job(job: dict[str, Any]) -> None:
    video_id = str(job["videoId"])
    output_key = str(job.get("outputKey") or "")
    callback_url = str(job.get("callbackUrl") or "")
    upload_url = str(job.get("uploadUrl") or "")
    output_path = str(job.get("outputPath") or "")
    work_dir = tempfile.mkdtemp(prefix="local1080-")
    local_output = os.path.join(work_dir, OUTPUT_FILENAME)
    local_mode = not upload_url

    try:
        if job.get("contentType") not in (None, CONTENT_TYPE):
            raise JobError("contentType must be video/mp4")
        if not upload_url and not output_path:
            raise JobError("uploadUrl is required unless outputPath is set")

        source_path = os.path.join(work_dir, "source")
        started = time.monotonic()
        size = download_source(str(job["sourceUrl"]), source_path)
        log(f"job {job['jobId']} video {video_id}: downloaded {size} bytes in {time.monotonic() - started:.1f}s")

        started = time.monotonic()
        transcode(source_path, local_output)
        log(f"job {job['jobId']} video {video_id}: encoded in {time.monotonic() - started:.1f}s "
            f"({os.path.getsize(local_output)} bytes)")

        if local_mode:
            # Local verification only: never reachable when a presigned PUT URL
            # was supplied, so production never writes local files.
            parent = os.path.dirname(output_path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            shutil.copyfile(local_output, output_path)
            log(f"job {job['jobId']} video {video_id}: local test mode wrote an MP4")
        else:
            upload_output(upload_url, local_output)
            log(f"job {job['jobId']} video {video_id}: uploaded")

        post_callback(callback_url, {
            "videoId": video_id,
            "status": "READY",
            "outputKey": output_key,
        })
        log(f"job {job['jobId']} video {video_id}: callback READY")
    except Exception as exc:  # one attempt, report the failure
        message = describe_error(exc)
        log(f"job {job['jobId']} video {video_id}: failed: {message}")
        try:
            post_callback(callback_url, {
                "videoId": video_id,
                "status": "ERROR",
                "outputKey": output_key,
                "error": message,
            })
        except Exception as callback_exc:
            log(f"job {job['jobId']} video {video_id}: error callback failed: {describe_error(callback_exc)}")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


class JobQueue:
    """Concurrency 1: one worker thread drains a FIFO queue."""

    def __init__(self, maxsize: int) -> None:
        self._queue: "queue.Queue[dict[str, Any]]" = queue.Queue(maxsize=maxsize)
        self._busy = False
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._run, name="local-1080-worker", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def submit(self, job: dict[str, Any]) -> bool:
        try:
            self._queue.put_nowait(job)
            return True
        except queue.Full:
            return False

    def snapshot(self) -> tuple[bool, int]:
        with self._lock:
            return self._busy, self._queue.qsize()

    def _run(self) -> None:
        while True:
            job = self._queue.get()
            with self._lock:
                self._busy = True
            try:
                process_job(job)
            except Exception as exc:  # process_job already reports; keep the loop alive
                log(f"job {job.get('jobId')}: unhandled error: {describe_error(exc)}")
            finally:
                with self._lock:
                    self._busy = False
                self._queue.task_done()


JOBS = JobQueue(QUEUE_MAX)
MAX_BODY_BYTES = 64 * 1024


class Handler(BaseHTTPRequestHandler):
    server_version = "local-1080/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:  # no request paths in logs
        return

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        provided = self.headers.get("Authorization", "").encode("latin-1", "ignore")
        expected = f"Bearer {WORKER_SECRET}".encode("utf-8")
        return hmac.compare_digest(provided, expected)

    def do_GET(self) -> None:  # noqa: N802 (http.server API)
        if urllib.parse.urlsplit(self.path).path != "/healthcheck":
            self._json(404, {"error": "not found"})
            return
        busy, queued = JOBS.snapshot()
        self._json(200, {"ok": True, "busy": busy, "queued": queued})

    def do_POST(self) -> None:  # noqa: N802 (http.server API)
        if urllib.parse.urlsplit(self.path).path != "/jobs":
            self._json(404, {"error": "not found"})
            return
        if not self._authorized():
            self._json(401, {"error": "unauthorized"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._json(400, {"error": "invalid body size"})
            return

        try:
            job = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {"error": "invalid JSON"})
            return

        if not isinstance(job, dict):
            self._json(400, {"error": "job must be an object"})
            return
        for field in ("videoId", "sourceUrl"):
            if not isinstance(job.get(field), str) or not job[field].strip():
                self._json(400, {"error": f"{field} is required"})
                return
        job["videoId"] = job["videoId"].strip()
        job["jobId"] = uuid.uuid4().hex
        job.setdefault("outputKey", "")
        job.setdefault("contentType", CONTENT_TYPE)

        if not JOBS.submit(job):
            self._json(429, {"error": "queue full"})
            return

        log(f"job {job['jobId']} video {job['videoId']}: queued")
        self._json(202, {"ok": True, "jobId": job["jobId"]})


def main() -> int:
    if not WORKER_SECRET:
        log("LOCAL_1080_WORKER_SECRET is required; refusing to start")
        return 1
    try:
        os.nice(19)
    except OSError:
        pass

    JOBS.start()
    server = ThreadingHTTPServer((BIND_HOST, PORT), Handler)
    server.daemon_threads = True
    log(f"listening on {BIND_HOST}:{PORT}, concurrency=1, queue={QUEUE_MAX}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
