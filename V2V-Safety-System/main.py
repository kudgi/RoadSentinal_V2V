import time

from verifier.message import V2VMessage
from verifier.verifier import V2VVerifier


verifier = V2VVerifier()


message = V2VMessage(
    message_id="HZ001",
    sender_id="V001",
    event="EMERGENCY_BRAKE",
    speed=72.0,
    acceleration=-6.5,
    position=542.3,
    lane=2,
    timestamp=time.time(),
    hop_count=0,
    ttl=5
)


result = verifier.verify(message)

print("\nVerification Result:", "ACCEPT" if result else "REJECT")