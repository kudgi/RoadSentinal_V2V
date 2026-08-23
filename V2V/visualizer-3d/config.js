export const CONFIG = Object.freeze({
  mapUrl: "map/Barnim_small.net.xml",
  replayUrl: "data/output.csv",
  riskUrl: "data/safety-events.csv",
  websocketUrl: "ws://127.0.0.1:46587",
  sumoOffset: Object.freeze({ x: 395635.35, y: 5826456.24 }),
  communicationRangeMeters: 500,
  incidentVehicleId: "veh_0",
  incidentTimeNs: 20_000_000_000,
  websocketTimeoutMs: 1400
});
