"""A small ntfy client (SPEC §10). Standard library only, so no new dependency (D-070).

Messages are published as JSON to the server's root URL, which carries the topic,
title, priority, tags and click link without the header-encoding limits of the
plain-text API (titles with emoji or accents work).
"""

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Protocol

TIMEOUT_SECONDS = 10


@dataclass(frozen=True, slots=True)
class Message:
    title: str
    body: str
    #: ntfy priority 1 (min) to 5 (urgent); 3 is the default.
    priority: int = 3
    tags: tuple[str, ...] = ()
    click: str | None = None


@dataclass(frozen=True, slots=True)
class Target:
    url: str
    topic: str
    token: str | None = None


class SendError(Exception):
    """The server refused the message or could not be reached."""


class Sender(Protocol):
    def __call__(self, target: Target, message: Message) -> None: ...


def payload(target: Target, message: Message) -> dict:
    body: dict = {
        "topic": target.topic,
        "title": message.title,
        "message": message.body,
        "priority": message.priority,
    }
    if message.tags:
        body["tags"] = list(message.tags)
    if message.click:
        body["click"] = message.click
    return body


def send(target: Target, message: Message) -> None:
    """Publish one message. Raises SendError with a readable reason on failure."""
    request = urllib.request.Request(
        target.url.rstrip("/"),
        data=json.dumps(payload(target, message)).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    if target.token:
        request.add_header("Authorization", f"Bearer {target.token}")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            if response.status >= 300:
                raise SendError(f"ntfy answered {response.status}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:200]
        raise SendError(f"ntfy answered {exc.code}: {detail}".strip()) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        raise SendError(f"could not reach {target.url}: {reason}") from exc


@dataclass
class Recorder:
    """A stand-in sender for tests: remembers what would have gone out."""

    sent: list[tuple[Target, Message]] = field(default_factory=list)
    fail_with: str | None = None

    def __call__(self, target: Target, message: Message) -> None:
        if self.fail_with:
            raise SendError(self.fail_with)
        self.sent.append((target, message))
