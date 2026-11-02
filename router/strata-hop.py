#!/usr/bin/env python3
"""strata-hop —— Strata 的按需（socket 激活）模型路由层。

为什么需要它
------------
DSH 的一个 provider 只有一个 baseURL，而 Strata 一个进程只装一个模型。要让 DSH 的
模型下拉框里能"选模型就切模型"，需要一个知道"请求里 model=谁"的中间层：

    DSH (127.0.0.1:8080)  ->  strata-hop  ->  127.0.0.1:8081 (实际 Strata)

strata-hop 常驻但几乎不占资源：没有请求时你桌面上没有任何 GPU 进程；第一个请求到达时
它才按 model 字段拉起对应的 `strata serve`，空闲超时后再把它停掉。

协议支持
--------
* Anthropic Messages  POST /v1/messages            （DSH 用的就是这条，流式/非流式）
* OpenAI Chat         POST /v1/chat/completions     （opencode 等）
* 其余请求（/v1/models、/health、/props ...）直接转发给当前模型。

用法
----
    strata-hop --config /home/USER/.config/strata/strata-hop.json
    strata-hop --config ... --print-route     # 只打印某模型会用什么命令，不拉起
"""

from __future__ import annotations

import argparse
import json
import os
import select
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# ---------------------------------------------------------------- 配置

DEFAULT_CONFIG = Path.home() / ".config" / "strata" / "strata-hop.json"


def load_config(path: Path) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    models = raw.get("models") or {}
    if not models:
        raise SystemExit(f"{path}: no models configured")
    for model_id, entry in models.items():
        for key in ("profile", "strata_python", "server_py"):
            if not entry.get(key):
                raise SystemExit(f"{path}: model {model_id!r} is missing {key}")
    listen = raw.get("listen", {})
    raw.setdefault("listen", {"host": listen.get("host", "127.0.0.1"), "port": listen.get("port", 8080)})
    raw["listen"].setdefault("host", "127.0.0.1")
    raw["listen"].setdefault("port", 8080)
    raw.setdefault("upstream_port", 8081)
    raw.setdefault("default_model", next(iter(models)))
    raw.setdefault("idle_seconds", 1800)
    raw.setdefault("start_timeout", 300)
    raw.setdefault("api_key_env", "STRATA_API_KEY")
    raw.setdefault("aliases", {})
    # 开机预热：true 预热 default_model，或写一个模型 id 预热那个；false/不写则不预热
    raw.setdefault("preload_model", False)
    preload = raw["preload_model"]
    if preload is True:
        raw["preload_model"] = raw["default_model"]
    elif preload in (False, None, ""):
        raw["preload_model"] = None
    elif preload not in models:
        raise SystemExit(f"{path}: preload_model {preload!r} is not one of {list(models)}")
    return raw


# ---------------------------------------------------------------- 上游管理


class StrataUpstream:
    """一个模型对应一个 `strata serve` 子进程，按需启动、空闲回收。"""

    def __init__(self, model_id: str, entry: dict, cfg: dict) -> None:
        self.model_id = model_id
        self.entry = entry
        self.cfg = cfg
        self.proc: subprocess.Popen | None = None
        self.lock = threading.Lock()
        self.last_used = 0.0

    # -- 命令
    def argv(self) -> list[str]:
        port = self.cfg["upstream_port"]
        argv = [
            self.entry["strata_python"],
            self.entry["server_py"],
            "--engine", self.entry.get("engine", "strata"),
            "--config", self.entry["profile"],
            "--host", "127.0.0.1",
            "--port", str(port),
        ]
        extra = self.entry.get("args") or []
        if extra:
            argv += [str(x) for x in extra]
        return argv

    # -- 进程
    def alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def start(self) -> None:
        """启动并等待端口可用；已在跑就什么都不做。"""
        with self.lock:
            if self.alive():
                self.last_used = time.time()
                return
            argv = self.argv()
            print(f"[strata-hop] starting {self.model_id}: {' '.join(argv)}", flush=True)
            self.proc = subprocess.Popen(
                argv,
                stdin=subprocess.DEVNULL,
                stdout=sys.stderr,
                stderr=sys.stderr,
                start_new_session=True,
            )
            deadline = time.time() + float(self.cfg["start_timeout"])
            while time.time() < deadline:
                if self.proc.poll() is not None:
                    raise RuntimeError(
                        f"{self.model_id} exited during startup (code {self.proc.returncode})"
                    )
                if self._port_open():
                    print(f"[strata-hop] {self.model_id} is ready", flush=True)
                    self.last_used = time.time()
                    return
                time.sleep(0.5)
            self.stop()
            raise RuntimeError(f"{self.model_id} did not become ready within {self.cfg['start_timeout']}s")

    def _port_open(self) -> bool:
        try:
            with socket.create_connection(("127.0.0.1", self.cfg["upstream_port"]), timeout=1):
                return True
        except OSError:
            return False

    def stop(self) -> None:
        proc, self.proc = self.proc, None
        if proc is None or proc.poll() is not None:
            return
        print(f"[strata-hop] stopping {self.model_id}", flush=True)
        for sig, grace in ((signal.SIGTERM, 30), (signal.SIGKILL, 5)):
            try:
                os.killpg(os.getpgid(proc.pid), sig)
            except ProcessLookupError:
                return
            try:
                proc.wait(timeout=grace)
                return
            except subprocess.TimeoutExpired:
                continue

    def touch(self) -> None:
        self.last_used = time.time()

    def idle_for(self) -> float:
        return time.time() - self.last_used


class Pool:
    def __init__(self, cfg: dict) -> None:
        self.cfg = cfg
        self.models = {k: StrataUpstream(k, v, cfg) for k, v in cfg["models"].items()}
        self.aliases = {str(a): m for a, m in (cfg.get("aliases") or {}).items()}
        self.current: StrataUpstream | None = None
        self.current_lock = threading.Lock()

    def resolve(self, requested: str | None) -> StrataUpstream:
        name = requested or self.cfg["default_model"]
        name = self.aliases.get(name, name)
        if name not in self.models:
            raise KeyError(name)
        return self.models[name]

    def ensure(self, requested: str | None) -> StrataUpstream:
        """返回已就绪的上游；必要时停掉旧的、启动新的（单模型共存，避免抢显存）。"""
        want = self.resolve(requested)
        with self.current_lock:
            if self.current is not want:
                if self.current is not None:
                    self.current.stop()
                want.start()
                self.current = want
            want.touch()
            return want

    def current_or_default(self) -> StrataUpstream | None:
        with self.current_lock:
            return self.current

    def reap_idle(self) -> None:
        idle = float(self.cfg["idle_seconds"])
        if idle <= 0:
            return
        with self.current_lock:
            if self.current is not None and self.current.idle_for() > idle:
                print(f"[strata-hop] {self.current.model_id} idle for {int(self.current.idle_for())}s", flush=True)
                self.current.stop()
                self.current = None

    def shutdown(self) -> None:
        with self.current_lock:
            if self.current is not None:
                self.current.stop()
                self.current = None

    def unload(self, model_id: str | None = None) -> dict:
        """手动卸载：model_id 为空就卸当前模型；不是当前模型则什么都不做（幂等）。"""
        with self.current_lock:
            cur = self.current
            if cur is None:
                return {"ok": True, "unloaded": None, "reason": "no model loaded"}
            if model_id and model_id != cur.model_id:
                return {"ok": True, "unloaded": None,
                        "reason": f"{model_id} is not loaded (current: {cur.model_id})"}
            name = cur.model_id
            cur.stop()
            self.current = None
            return {"ok": True, "unloaded": name}

    def preload(self, model_id: str) -> None:
        """开机预热：在后台线程里拉起一个模型，失败只记一行，不影响路由层本身。"""
        def run() -> None:
            try:
                print(f"[strata-hop] preloading {model_id}", flush=True)
                self.ensure(model_id)
                print(f"[strata-hop] {model_id} preloaded", flush=True)
            except Exception as exc:  # noqa: BLE001 — 预热失败不该让服务起不来
                print(f"[strata-hop] preload {model_id} failed: {exc}", flush=True)
        threading.Thread(target=run, name="preload", daemon=True).start()


# ---------------------------------------------------------------- HTTP 转发


def _header_end(head: bytes) -> int:
    return head.find(b"\r\n\r\n")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    pool: Pool  # 由 make_server 注入
    cfg: dict

    def log_message(self, fmt: str, *args) -> None:  # 减少噪声，只写启动/停止
        pass

    # -- 工具
    def _read_body(self, length: int | None = None) -> bytes:
        if length is None:
            length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def _authorized(self) -> bool:
        expected = os.environ.get(self.cfg["api_key_env"], "")
        if not expected:
            return True
        got = self.headers.get("x-api-key") or ""
        if not got:
            auth = self.headers.get("authorization") or ""
            if auth.lower().startswith("bearer "):
                got = auth[7:]
        return got == expected

    def _model_from_body(self, body: bytes) -> str | None:
        if not body:
            return None
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            return None
        if isinstance(payload, dict):
            value = payload.get("model")
            if isinstance(value, str) and value:
                return value
        return None

    def _upstream_request(self, path: str, body: bytes, model: str | None) -> None:
        """把请求原样转发到当前上游，并把响应（含流式）逐块写回客户端。"""
        try:
            up = self.pool.ensure(model)
        except KeyError:
            self._error(404, f"model {model!r} is not configured in strata-hop", "not_found_error")
            return
        except RuntimeError as exc:
            self._error(503, f"strata-hop could not start {model}: {exc}", "api_error")
            return

        headers = {}
        for key, value in self.headers.items():
            lower = key.lower()
            if lower in ("host", "connection", "content-length", "transfer-encoding", "keep-alive", "accept-encoding"):
                continue
            headers[key] = value
        if body:
            headers["Content-Length"] = str(len(body))

        url = f"http://127.0.0.1:{self.cfg['upstream_port']}{path}"
        req = urllib.request.Request(url, data=body or None, headers=headers, method=self.command)
        try:
            resp = urllib.request.urlopen(req, timeout=float(self.cfg["start_timeout"]) + 3600)
        except urllib.error.HTTPError as err:
            data = err.read()
            self.send_response(err.code)
            for key, value in err.headers.items():
                if key.lower() in ("transfer-encoding", "content-length", "connection"):
                    continue
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        except OSError as exc:
            self._error(502, f"strata-hop could not reach the model server: {exc}", "api_error")
            return

        with resp:
            self.send_response(resp.status)
            for key, value in resp.headers.items():
                if key.lower() in ("transfer-encoding", "content-length", "connection"):
                    continue
                self.send_header(key, value)
            # 一律用 chunked 编码写回：上游给多少就转多少，SSE 边到边发，不整段缓冲。
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            try:
                while True:
                    chunk = resp.read(8192)
                    if not chunk:
                        break
                    self.wfile.write(f"{len(chunk):x}\r\n".encode())
                    self.wfile.write(chunk)
                    self.wfile.write(b"\r\n")
                    self.wfile.flush()
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return
            finally:
                up.touch()

    def _error(self, code: int, message: str, kind: str) -> None:
        data = json.dumps({"error": {"type": kind, "message": message}}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # -- 路由
    def do_POST(self) -> None:
        body = self._read_body()
        if not self._authorized():
            self._error(401, "invalid or missing API key", "authentication_error")
            return
        path = self.path.split("?", 1)[0]
        if path in ("/unload", "/v1/unload"):
            # 手动卸载当前模型，释放 RAM 与显存；下次推理请求会重新加载。
            model = self._model_from_body(body)
            try:
                result = self.pool.unload(model)
            except Exception as exc:  # noqa: BLE001
                self._error(500, f"unload failed: {exc}", "api_error")
                return
            print(f"[strata-hop] manual unload: {result}", flush=True)
            payload = json.dumps(result, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if path in ("/warm", "/preload", "/warmup"):
            # 点模型即预热：只拉起引擎，不产生任何推理 token（幂等）。
            requested = self._model_from_body(body)
            try:
                target = self.pool.resolve(requested)
            except KeyError:
                self._error(404, f"unknown model {requested!r}", "invalid_request")
                return
            if self.pool.current is target:
                payload = json.dumps({"ok": True, "already": target.model_id}, ensure_ascii=False).encode()
            else:
                self.pool.preload(target.model_id)
                payload = json.dumps({"ok": True, "preloading": target.model_id}, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if path in ("/loaded", "/v1/loaded"):
            # 被动查询当前加载的模型（监控用；无副作用、不打日志）。
            cur = self.pool.current
            body_out = {"ok": True, "loaded": cur.model_id if cur is not None else None}
            payload = json.dumps(body_out, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if path in ("/v1/messages", "/v1/messages/", "/v1/chat/completions", "/chat/completions"):
            self._upstream_request(self.path, body, self._model_from_body(body))
            return
        self._passthrough(body)

    def do_GET(self) -> None:
        self._passthrough(b"")

    def do_HEAD(self) -> None:
        self._passthrough(b"")

    def do_DELETE(self) -> None:
        self._passthrough(b"")

    def _passthrough(self, body: bytes) -> None:
        """非推理请求：当前模型在跑就转发，否则直接答 `/v1/models`。"""
        if not self._authorized():
            self._error(401, "invalid or missing API key", "authentication_error")
            return
        up = self.pool.current_or_default()
        if up is not None and up.alive():
            self._upstream_request(self.path, body, up.model_id)
            return
        path = self.path.split("?", 1)[0]
        if path in ("/v1/models", "/models"):
            data = [{
                "id": mid,
                "object": "model",
                "status": {"value": "idle"},
                "meta": {"warm": False},
            } for mid in self.pool.models]
            payload = json.dumps({"object": "list", "data": data}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if path in ("/health", "/v1/health"):
            self._error(200, "idle: no model loaded", "ok")
            return
        self._error(503, "no model is loaded; send an inference request to start one", "unavailable")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()


class ReusableServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Storma/Strata socket-activated model router")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--print-route", metavar="MODEL", help="print the command for MODEL and exit")
    parser.add_argument("--check", action="store_true", help="validate the config and exit")
    args = parser.parse_args(argv)

    cfg = load_config(Path(args.config))
    pool = Pool(cfg)

    if args.print_route:
        up = pool.resolve(args.print_route)
        print(json.dumps({"model": up.model_id, "argv": up.argv(), "listen": cfg["listen"]}, indent=2))
        return 0
    if args.check:
        print(json.dumps({
            "listen": cfg["listen"],
            "routes": {m: up.argv() for m, up in pool.models.items()},
            "aliases": pool.aliases,
            "idle_seconds": cfg["idle_seconds"],
        }, indent=2))
        return 0

    Handler.pool = pool
    Handler.cfg = cfg
    server = ReusableServer((cfg["listen"]["host"], int(cfg["listen"]["port"])), Handler)

    def reap_loop() -> None:
        while True:
            time.sleep(max(5.0, min(60.0, float(cfg["idle_seconds"]) / 8 or 5)))
            try:
                pool.reap_idle()
            except Exception as exc:  # noqa: BLE001 — 守护线程不能死
                print(f"[strata-hop] reap: {exc}", flush=True)

    def shutdown(signum, frame) -> None:
        print("[strata-hop] shutting down", flush=True)
        threading.Thread(target=pool.shutdown, daemon=True).start()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    threading.Thread(target=reap_loop, daemon=True).start()
    print(f"[strata-hop] listening on http://{cfg['listen']['host']}:{cfg['listen']['port']}", flush=True)
    if cfg.get("preload_model"):
        pool.preload(cfg["preload_model"])
    try:
        server.serve_forever()
    finally:
        pool.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
