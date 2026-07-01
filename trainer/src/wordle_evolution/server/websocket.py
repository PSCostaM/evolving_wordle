"""WebSocket training endpoint: /ws/train.

Client -> server control messages: ``start`` (with ``config``), ``pause``,
``resume``, ``stop``, ``reset``. Server -> client: streamed training events.
"""

from __future__ import annotations

import asyncio

import orjson
from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from . import schemas
from .training_manager import TrainingManager


async def train_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    send_lock = asyncio.Lock()
    manager: TrainingManager | None = None

    async def emit(event: dict) -> None:
        # Serialize concurrent sends (run loop + control handlers share the socket).
        async with send_lock:
            try:
                await websocket.send_text(orjson.dumps(event).decode("utf-8"))
            except RuntimeError:  # pragma: no cover - socket already closed
                pass

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = orjson.loads(raw)
            except orjson.JSONDecodeError:
                await emit({"type": "error", "message": "invalid JSON"})
                continue

            msg_type = message.get("type")

            if msg_type == "start":
                if manager is not None:
                    await manager.stop()
                try:
                    train_config = schemas.TrainConfig.model_validate(message.get("config") or {})
                except ValidationError as exc:
                    await emit({"type": "error", "message": f"invalid config: {exc}"})
                    continue
                config = schemas.build_evolution_config(train_config)
                manager = TrainingManager(config, emit)
                manager.start()

            elif msg_type == "pause":
                if manager is not None:
                    await manager.pause()

            elif msg_type == "resume":
                if manager is not None:
                    await manager.resume()

            elif msg_type == "stop":
                if manager is not None:
                    await manager.stop()

            elif msg_type == "reset":
                if manager is not None:
                    await manager.reset()
                    manager = None

            else:
                await emit({"type": "error", "message": f"unknown message type: {msg_type!r}"})

    except WebSocketDisconnect:
        if manager is not None:
            await manager.stop()
    except Exception as exc:  # pragma: no cover - defensive
        await emit({"type": "error", "message": str(exc)})
        if manager is not None:
            await manager.stop()
