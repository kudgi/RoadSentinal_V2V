# Road Sentinel final 3D build

## Run

Double-click `run-final.bat`, then open:

`http://127.0.0.1:8000/final.html`

The server is bound to loopback and exposes only this visualizer directory.

## Data ownership

- Eclipse MOSAIC and SUMO in `V2V-SIH` remain authoritative.
- `map/Barnim_small.net.xml` is a reduced rendering asset, not a replacement
  for `../sumo/Barnim.net.xml`.
- `data/output.csv` is a verified MOSAIC replay. Use `prepare-replay.ps1` to
  replace it with a newer MOSAIC output file.
- The renderer connects to `ws://127.0.0.1:46587`, polls the MOSAIC output
  ambassador every 100 ms, and consumes its native interaction envelopes.
- If MOSAIC is not running, the same page automatically uses the verified CSV replay.

## Reproducible states

- Normal start: `final.html?time=7`
- Exact DENM chain: `final.html?time=20.01`
- Automated playback: `final.html?autoplay=1&speed=3`

## Implemented systems

- SUMO-width asphalt lane surfaces, shoulders, junction fills and markings.
- Terrain plus deterministic, instanced buildings, trees and streetlights.
- Procedural optimized cars with wheels, glass and brake lights.
- Interpolated MOSAIC position, heading, speed and acceleration replay.
- DENM TX/RX rings, 500 m range, packet travel and receiver highlighting.
- Automatic incident camera focused only on the original `veh_0` hazard.
- TTC/risk values are joined from the matching MOSAIC application log; an
  infinite TTC is displayed as `∞ / SAFE` instead of being treated as missing.
- Live vehicle speed and heading are derived from consecutive projected MOSAIC
  positions because the reduced live update intentionally omits those fields.

## Live data boundary

Live MOSAIC TX/RX and vehicle movement are rendered directly. TTC/risk remains
a verified application-log enrichment in replay mode until those fields are added
to the MOSAIC WebSocket exporter. No synthetic TTC value is generated.