# V2V SIH Project Context

This file is the working brief for future contributors and Codex sessions. Read it before changing code or configuration.

## Project decision

The project direction is correct: build an infrastructure-independent cooperative road-safety system in which a vehicle detects a hazard, broadcasts a safety message, nearby vehicles receive it, calculate local collision risk, and react. The current implementation is a valid first technical slice, but it is not yet sufficient evidence for the hackathon. The next priority is a deterministic, measurable A-to-B-to-C experiment, not AI, a dashboard, or additional simulators.

The project must be presented as local cooperative safety and explainable TTC-based decision making. Do not present it as an AI project. AI is optional and belongs after a real measured baseline exists.

## Source requirements

The attached internal hackathon brief is at:

`C:\Users\aditi\Downloads\V2V SIH Internal Hackathon.docx`

Its requirements are planning guidance, not code-authority. Verified local MOSAIC 25.2 JAR APIs and the current repository take precedence over guessed APIs or generic examples.

The brief requires:

- infrastructure-independent V2V hazard sharing;
- local speed, position, direction, distance, and TTC reasoning;
- SUMO for roads and traffic;
- Eclipse MOSAIC for V2X and application logic;
- optional Wokwi ESP32 ECU demonstration;
- realistic range, latency, loss, congestion, and stale-message handling;
- without-V2V versus with-V2V experiments using actual measured results;
- later scaling, failure testing, validation/security, and optional AI;
- no initial dependence on ns-3, OMNeT++, CARLA, or hardware.

## Authoritative local environment

- Repository: `D:\Road V2V\V2V-SIH`
- MOSAIC: `D:\Road V2V\eclipse-mosaic-25.2`
- MOSAIC: `25.2`
- SUMO target: `1.27.1`
- Runtime: Java `21`
- Compile target: Java `17`
- Scenario: `V2V\scenario_config.json`
- Scenario ID: `Barnim`
- Scenario duration: `1000s`
- Active federates: application, environment, sns, output, sumo
- Disabled federates: cell, ns3, omnetpp

Never modify MOSAIC installation files. Do not enable ns-3 unless the project plan explicitly changes.

## Current implementation

Source:

`v2v-app\src\org\eclipse\mosaic\app\v2v\HardBrakeSafetyApp.java`

Class:

`org.eclipse.mosaic.app.v2v.HardBrakeSafetyApp`

Superclass/interfaces:

```java
AbstractApplication<VehicleOperatingSystem>
VehicleApplication
CommunicationApplication
```

Current behavior:

1. Enables the vehicle ad-hoc module in `onStartup()`.
2. Uses `VehicleData.getLongitudinalAcceleration()` when non-null.
3. Falls back to signed speed delta divided by elapsed simulation time in seconds.
4. Requires acceleration at or below `-3.0 m/s2` for `500 ms` before reporting.
5. Protects one DENM transmission per braking episode.
6. Creates an ETSI `Denm` with `EnvironmentEventCause.DANGEROUS_SITUATION`.
7. Uses geographical broadcast with `GeoCircle(500 m)` and `hops(6)` on `AdHocChannel.CCH`.
8. Receives DENMs through `onMessageReceived()`.
9. Rejects messages older than `30s` or with future event timestamps.
10. Calculates TTC only when the receiver and event share the same road connection.
11. Uses `SAFE`, `WARNING`, and `CRITICAL` states with initial thresholds of `4s` and `2s`.
12. Logs TX and RX information, vehicle IDs, event road, message age, TTC, and risk.

The thresholds are initial engineering values only. They are not claimed automotive standards.

## Current scenario wiring

Application JAR:

`V2V\application\hard-brake-safety-25.2.jar`

Mapping:

`V2V\mapping\mapping_config.json`

The custom app is assigned to the `AdHoc` vehicle type, alongside the existing tutorial applications. Cellular and unequipped mappings remain separate.

Important current limitation: the mapping randomly creates many AdHoc vehicles, and existing `WeatherWarningApp`/`SlowDownApp` applications remain active. This is why the visualizer may show many colored vehicles and why the current scenario is not a deterministic Vehicle A, B, C experiment.

SNS:

`V2V\sns\sns_config.json`

Current baseline:

```json
maximumTtl: 6
singlehopRadius: 300.0
adhocTransmissionModel: SophisticatedAdhocTransmissionModel
simpleMultihopDelay: ConstantDelay, 20 ms
simpleMultihopTransmission.lossProbability: 0.0
singlehopTransmission.lossProbability: 0.0
```

Zero loss is a debugging baseline, not the final communication model. Later experiments must add controlled loss, delay, range, and congestion conditions.

Output:

`V2V\output\output_config.xml`

Already subscribed:

- vehicle updates, including speed, position, acceleration, road position, and brake light;
- V2X message reception, including type, message ID, receiver, signal strength, and payload length;
- V2X message transmission, including type, message ID, source, source position, routing type, channel, and payload length;
- vehicle registration and speed changes.

## Verified MOSAIC API facts

These facts were verified against local MOSAIC 25.2 JARs. Do not replace them with invented method names.

Application lifecycle:

```java
onStartup()
onShutdown()
processEvent(Event)
```

Vehicle callback:

```java
onVehicleUpdated(VehicleData previous, VehicleData updated)
```

Communication callbacks:

```java
onMessageReceived(ReceivedV2xMessage)
onAcknowledgementReceived(ReceivedAcknowledgement)
onCamBuilding(CamBuilder)
onMessageTransmitted(V2xMessageTransmission)
```

Vehicle state:

```java
VehicleOperatingSystem.getId()
VehicleOperatingSystem.getSimulationTime()
VehicleOperatingSystem.getVehicleData()
VehicleOperatingSystem.getPosition()
VehicleOperatingSystem.getRoadPosition()
VehicleData.getSpeed()
VehicleData.getLongitudinalAcceleration()
VehicleData.getRoadPosition()
IRoadPosition.getConnectionId()
IRoadPosition.getOffset()
```

Ad-hoc routing:

```java
VehicleOperatingSystem.getAdHocModule()
AdHocModule.enable()
AdHocModule.createMessageRouting()
AdHocMessageRoutingBuilder.channel(AdHocChannel.CCH)
AdHocMessageRoutingBuilder.geographical(GeoArea)
AdHocMessageRoutingBuilder.broadcast()
AdHocMessageRoutingBuilder.hops(int)
AdHocMessageRoutingBuilder.build()
AdHocModule.sendV2xMessage(V2xMessage)
```

DENM:

```java
new DenmContent(...)
new Denm(MessageRouting, DenmContent, long payloadLength)
Denm.getTime()
Denm.getSenderPosition()
Denm.getEventLocation()
Denm.getEventRoadId()
Denm.getEventCause()
Denm.getCausedSpeed()
Denm.getSenderDeceleration()
```

Geometry:

```java
new GeoCircle(GeoPoint center, double radiusMetres)
GeoPoint.distanceTo(GeoPoint)
```

Compile against all local MOSAIC and third-party libraries with `--release 17`:

```powershell
javac --release 17 `
  -cp "D:\Road V2V\eclipse-mosaic-25.2\lib\mosaic\*;D:\Road V2V\eclipse-mosaic-25.2\lib\third-party\*" `
  -d "v2v-app\build\classes" `
  "v2v-app\src\org\eclipse\mosaic\app\v2v\HardBrakeSafetyApp.java"
```

## Correct next direction

### Milestone 1: deterministic proof

Create a controlled experiment with exactly identified roles:

- Vehicle A: hard-braking event producer;
- Vehicle B: first receiver and TTC evaluator;
- Vehicle C: farther receiver or native forwarding observer.

Do not use the current weighted random vehicle mix as the primary proof. Keep the Barnim scenario as a smoke test, but add a separate deterministic mapping/flow or controlled application trigger for the A/B/C experiment. Preserve the existing scenario until the controlled experiment is working.

The proof must show:

```text
Vehicle A hard brake
  -> TX Denm
  -> Vehicle B RX Denm
  -> TTC and risk state
  -> native SNS propagation/forwarding evidence where supported
  -> Vehicle C RX Denm
```

Do not infer communication from red/green visualizer colors. Use application logs and output CSV `Type`/sender/receiver/message IDs.

### Milestone 2: vehicle response

After TTC is validated, add a deliberately simple response for `WARNING` and/or `CRITICAL` using verified `VehicleOperatingSystem` speed-control methods. Record speed-change interactions and compare reaction time and reaction distance.

### Milestone 3: experimental baseline

Run identical seeds and traffic conditions:

- without V2V;
- with V2V.

Measure actual:

- secondary collisions;
- warning time;
- reaction time;
- reaction distance;
- DENM delivery rate;
- communication latency;
- affected vehicle count;
- traffic disruption;
- scaling at 10, 50, and 100+ vehicles.

Never place invented results in the presentation.

### Milestone 4: communication robustness

Replace the zero-loss baseline with controlled scenarios for packet loss, latency, range, congestion, stale messages, and vehicle disappearance. Keep one reproducible baseline configuration for debugging.

### Milestone 5: Wokwi and optional extensions

Add Wokwi only as a separate virtual ECU demonstration: input/sensor -> ESP32 logic -> hazard message/alert. Do not claim it validates physical wireless performance. Add trust/security and AI only after the deterministic system and measurements work.

## What must not be done yet

- Do not force AI into the project.
- Do not enable ns-3, OMNeT++, or CARLA for the first proof.
- Do not add a dashboard before output metrics are reliable.
- Do not claim visualizer colors prove DENM TX/RX.
- Do not claim threshold values are standards.
- Do not claim native multi-hop forwarding without output evidence.
- Do not replace the verified MOSAIC APIs with guessed APIs.
- Do not modify the MOSAIC installation.

## Required validation for future changes

1. Read this file before implementation.
2. Inspect the exact local JAR signatures for any new API.
3. Keep changes scoped to the project files needed for the milestone.
4. Compile with Java 17 target.
5. Package and copy the JAR only after compilation succeeds.
6. Validate all changed JSON/XML files.
7. Run the scenario or a bounded smoke test.
8. Inspect logs and output records, not only the visualizer.
9. Report exact files, commands, observed results, and remaining limitations.

## Current deterministic experiment build\n\nThe active mapping is now a controlled three-vehicle experiment plus 27 background vehicles (30 maximum in the run). The `Car` prototype runs only `HardBrakeSafetyApp`; the three entries are intended to create `veh_0`, `veh_1`, and `veh_2` at 5 s, 6 s, and 7 s with departure positions 1417 m, 1100 m, and 800 m on route 1. The application contains a V1 test-only trigger: `veh_0` issues one explicit hard-brake DENM at 20 s. This trigger is separate from normal measured acceleration detection and must be removed or disabled before final experiments.\n\nThe first controlled smoke test proved `veh_0 TX Denm` and direct reception by `veh_1`/`veh_2` when all vehicles were co-located. A later spatial run showed only `veh_0` had received its explicit position because the mapping edit was incomplete; `veh_1` and `veh_2` are now corrected to 1100 m and 800 m, but the spatial A-to-B-to-C run must be rerun before native multihop forwarding can be claimed.\n\n## Latest diagnostic findings\n\nLatest run inspected: `D:\\Road V2V\\eclipse-mosaic-25.2\\logs\\log-20260822-205751-Barnim`. The 30 vehicles registered and moved through SUMO. The output contained one `V2X_MESSAGE_TRANSMISSION` record for `veh_0` and no `V2X_MESSAGE_RECEPTION` records for that DENM. The application logs confirmed `veh_0 TX DENM`; `veh_1` and `veh_2` did not receive it in that run. `Traffic.log` states: `ChangeSpeed with forced acceleration is not supported yet.` Therefore the current demo trigger sends a test DENM but does not physically stop the SUMO vehicle.\n\nThe application now uses the verified MOSAIC color API for visual markers: white at startup, red after DENM transmission, and green after DENM reception. These colors are convenience markers only. The authoritative evidence remains application logs and output CSV `V2X_MESSAGE_TRANSMISSION`/`V2X_MESSAGE_RECEPTION` records.\n\nCollision observability is not complete yet. A future experiment must add a verified SUMO collision-output path or a validated collision metric; do not infer a collision from a visual blink.\n\n## Latest verification\n\nLatest run: `D:\\Road V2V\\eclipse-mosaic-25.2\\logs\\log-20260822-212852-Barnim`. The project mapping now contains 15 maximum vehicles: three controlled vehicles plus 12 background vehicles. The project SNS log confirms `singlehopRadius=500.0`. The rebuilt application produced a real `veh_0` DENM transmission and `veh_1` received it; `veh_2` did not receive it at the previous 800 m departure position. `veh_2` is now moved to 1000 m for the next verification.\n\nThe latest source JAR includes white startup, red TX, and green RX color updates. In the inspected run, `veh_0` TX and `veh_1` RX were confirmed in both application logs and `output.csv`. No color can appear for a vehicle that does not receive a DENM.\n\n## Current status

The application compiles and the MOSAIC scenario starts with the custom JAR and SNS baseline. The full 1000-second run has not yet been completed as a controlled A/B/C experiment. The project is therefore on the correct technical path, but the next deliverable must be reproducibility and measured evidence rather than more features.

## Current incident-chain implementation (2026-08-22)

The V1 application now models a deterministic incident using verified MOSAIC 25.2 APIs. At simulation time 20 s, only `veh_0` calls `VehicleOperatingSystem.stopNow(VehicleStopMode.STOP, 60_000_000_000L)` and sends one ETSI `Denm`. Other vehicles are not stopped by the application and continue under SUMO traffic behavior.

Received DENMs are checked as actual `Denm` instances, evaluated for freshness, used for TTC/risk logging, and forwarded once per stable event using the same ad-hoc geographic broadcast route. Duplicate suppression uses event location, road ID, event cause, and caused speed so changing forwarding transport timestamps or forwarding sender positions do not create rebroadcast loops. The current application logs `TX DENM`, `RX DENM`, and `FORWARD DENM` with vehicle IDs and simulation times.

The 15-vehicle mapping remains active: three controlled vehicles plus 12 background vehicles. SNS uses `SophisticatedAdhocTransmissionModel`, 500 m single-hop radius, TTL 6, 20 ms multihop delay, and zero loss for the debugging baseline. This is an application-level forwarding chain layered on the native geographic/hop-limited transmission model; it is intentionally not the final network realism configuration.

Verification runs:
- `D:\Road V2V\eclipse-mosaic-25.2\logs\log-20260822-214036-Barnim` proved a real SUMO stop and exposed the timestamp-based forwarding-loop issue.
- `D:\Road V2V\eclipse-mosaic-25.2\logs\log-20260822-214414-Barnim` proved source TX, `veh_1` and `veh_2` RX, and forwarding, but was before the final source-event registration correction. Rebuild/deploy after that correction completed successfully; run a fresh bounded smoke test before claiming the final self-reception behavior from logs.

The visualizer's transient red/green sending/receiving markers are driven by output `V2xMessageTransmission` and `V2xMessageReception` events, not by application vehicle-color changes. Therefore output records and application logs are authoritative for DENM evidence. Collision detection and automatic dashboard summaries are still not implemented.

## Visible incident demonstration update (2026-08-22 22:23)

The deterministic incident pair is now `veh_0` and `veh_1`. At 20 s both call `stopNow(VehicleStopMode.STOP, 2_000_000_000_000L)`, which extends beyond the 1000 s scenario. Run `log-20260822-222246-Barnim` confirms both SUMO stop requests and confirms speed `0.0` with `Stopped=true` from 31 s through the end of the bounded smoke test. Other vehicles remain controlled by SUMO and can pass using the second lane.

For visible MOSAIC 2D markers, `veh_0` sends a four-message DENM alert burst at 20, 21, 22, and 23 s. A first-time receiver queues forwarding for one simulated second instead of forwarding immediately. This allows the visualizer's approximately 500 ms green RX state to appear before the relay produces a red TX state. Stable event-content duplicate suppression still limits each vehicle to one forwarding transmission.

Authoritative output in `D:\Road V2V\eclipse-mosaic-25.2\logs\log-20260822-222246-Barnim\output.csv` confirms `veh_0` DENM TX, `veh_1`/`veh_2` DENM RX, and subsequent `veh_1`/`veh_2` forwarding TX. Watch simulation time 20-24 s for the visible sequence. The bounded run was manually stopped after verification; exit code 1 is from Ctrl+C, not an application failure.
## Authoritative physical-collision status (2026-08-22 23:30)

This section supersedes older notes that described two independent stopNow calls as an accident. Two vehicles stopping at different coordinates is not a collision and must not be presented as one.

Current controlled roles are restored to eh_0 = CrashLead and eh_1 = CrashFollower, both requested on route 1/lane 0. CrashLead is a test-only prototype with high deceleration so eh_0 can stop abruptly at 20 s. CrashFollower has weak test-only braking parameters. These values are simulation controls, not automotive standards. Both controlled applications repeatedly request lane 0; the other 13 vehicles retain normal SUMO behavior and may pass in lane 1.

The application now creates fresh persistent DENMs every 500 ms for an active incident. Receivers retain the hazard for 5 s and emit fresh relay DENMs every 2 s, so late-arriving vehicles can receive the warning and the application-level hop chain remains visible. The deployed JAR compiles with Java 17 and is at V2V/application/hard-brake-safety-25.2.jar.

Physical collision is NOT yet verified. Repeated bounded runs produced no <collision> entry in SUMO collisions.xml. Trajectory output showed that SUMO either delayed unsafe vehicle insertion, changed the lane before lane pinning was corrected, or applied safe car-following and stopped the follower without overlap. Do not infer a crash from red/green visualizer activity, isStopped(), TTC, or geographic proximity. Only SUMO collision output is authoritative.

The smallest correct next step is a dedicated deterministic SUMO collision scenario or a verified low-level TraCI/SUMO control path that can disable safe-speed checks for the designated crash follower. Keep the V2V application responsible for DENM creation, reception, TTC, risk, persistent beaconing, and relay; keep physical crash generation in SUMO. Verify one <collision> record naming both controlled vehicles, then verify both remain stopped for the rest of the scenario and ordinary vehicles pass in lane 1. Do not claim this milestone complete before those three facts are present in output.
