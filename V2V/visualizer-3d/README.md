# V2V-SIH 3D visualizer

This module renders the V2V-SIH simulation without changing the authoritative
SUMO or Eclipse MOSAIC scenario.

- `map/Barnim_small.net.xml` is the reduced RoadSentinel rendering map.
- `../sumo/Barnim.net.xml` remains the authoritative SUMO simulation network.
- `data/output.csv` is a recorded Eclipse MOSAIC output used for replay.
- `app.js` creates Three.js vehicles from MOSAIC vehicle updates and shows
  transmission/reception pulses only for recorded V2X events.

Run `run-visualizer.bat`, then open `http://127.0.0.1:8000/`. The launcher serves only this visualizer folder and binds only to the local machine.

To load a newer MOSAIC run:

```powershell
.\prepare-replay.ps1 -OutputCsv "D:\path\to\mosaic-log\output.csv"
```
