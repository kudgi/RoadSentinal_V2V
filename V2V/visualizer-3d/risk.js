export function enrichReceptionEvents(events, text) {
  const telemetry = new Map();
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line) continue;
    const [time, receiver, ttcText, risk] = line.split(";");
    const ttc = ttcText === "Infinity" ? Infinity : Number(ttcText);
    telemetry.set(`${time}:${receiver}`, { ttc, risk });
  }
  let matched = 0;
  for (const event of events) {
    if (event.type !== "rx") continue;
    const value = telemetry.get(`${event.t}:${event.id}`);
    if (!value) continue;
    event.ttc = value.ttc;
    event.risk = value.risk;
    matched += 1;
  }
  return matched;
}
