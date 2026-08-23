from dataclasses import dataclass


@dataclass
class V2VMessage:
    message_id: str
    sender_id: str
    event: str
    speed: float
    acceleration: float
    position: float
    lane: int
    timestamp: float
    hop_count: int
    ttl: int