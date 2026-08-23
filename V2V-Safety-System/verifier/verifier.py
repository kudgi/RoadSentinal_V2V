import time


class V2VVerifier:

    def __init__(self):
        self.known_vehicles = {
            "V001",
            "V002",
            "V003",
            "V004",
            "V005"
        }

        self.processed_messages = set()

    def verify(self, message):

        print("\n--- V2V VERIFICATION ---")

        # 1. Sender verification
        if message.sender_id not in self.known_vehicles:
            print("✗ Invalid sender")
            return False

        print("✓ Sender valid")

        # 2. Duplicate detection
        if message.message_id in self.processed_messages:
            print("✗ Duplicate message")
            return False

        print("✓ Message is unique")

        # 3. Freshness check
        current_time = time.time()

        if abs(current_time - message.timestamp) > 10:
            print("✗ Message expired")
            return False

        print("✓ Message is fresh")

        # 4. TTL check
        if message.ttl <= 0:
            print("✗ TTL expired")
            return False

        print("✓ TTL valid")

        # 5. Speed plausibility
        if message.speed < 0 or message.speed > 200:
            print("✗ Invalid speed")
            return False

        print("✓ Speed valid")

        # 6. Lane validation
        if message.lane < 1:
            print("✗ Invalid lane")
            return False

        print("✓ Lane valid")

        # Message accepted
        self.processed_messages.add(message.message_id)

        print("\n✓ MESSAGE ACCEPTED")
        print("→ Message can be forwarded")

        return True