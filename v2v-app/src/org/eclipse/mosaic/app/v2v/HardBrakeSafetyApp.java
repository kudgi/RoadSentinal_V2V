package org.eclipse.mosaic.app.v2v;

import org.eclipse.mosaic.fed.application.ambassador.simulation.communication.AdHocModule;
import org.eclipse.mosaic.fed.application.ambassador.simulation.communication.ReceivedAcknowledgement;
import org.eclipse.mosaic.fed.application.ambassador.simulation.communication.ReceivedV2xMessage;
import org.eclipse.mosaic.fed.application.ambassador.simulation.communication.CamBuilder;
import org.eclipse.mosaic.fed.application.app.AbstractApplication;
import org.eclipse.mosaic.fed.application.app.api.CommunicationApplication;
import org.eclipse.mosaic.fed.application.app.api.VehicleApplication;
import org.eclipse.mosaic.fed.application.app.api.os.VehicleOperatingSystem;
import org.eclipse.mosaic.interactions.communication.V2xMessageTransmission;
import org.eclipse.mosaic.lib.enums.AdHocChannel;
import org.eclipse.mosaic.lib.enums.EnvironmentEventCause;
import org.eclipse.mosaic.lib.enums.VehicleStopMode;
import org.eclipse.mosaic.lib.geo.GeoPoint;
import org.eclipse.mosaic.lib.geo.GeoCircle;
import org.eclipse.mosaic.lib.objects.addressing.AdHocMessageRoutingBuilder;
import org.eclipse.mosaic.lib.objects.road.IRoadPosition;
import org.eclipse.mosaic.lib.objects.v2x.MessageRouting;
import org.eclipse.mosaic.lib.objects.v2x.V2xMessage;
import org.eclipse.mosaic.lib.objects.v2x.etsi.Denm;
import org.eclipse.mosaic.lib.objects.v2x.etsi.DenmContent;
import org.eclipse.mosaic.lib.objects.vehicle.VehicleData;
import org.eclipse.mosaic.lib.util.scheduling.Event;
import java.awt.Color;
import java.util.HashSet;
import java.util.Set;

public class HardBrakeSafetyApp extends AbstractApplication<VehicleOperatingSystem>
        implements VehicleApplication, CommunicationApplication {

    // Initial V1 engineering values, not automotive-standard thresholds.
    private static final double HARD_BRAKING_ACCELERATION_MPS2 = -5.5;
    private static final long MINIMUM_BRAKING_DURATION_NS = 500_000_000L;
    private static final long MESSAGE_FRESHNESS_NS = 30_000_000_000L;
    private static final double HAZARD_RADIUS_METRES = 500.0;
    private static final int HAZARD_HOP_TTL = 6;
    private static final String DEMO_BRAKE_SOURCE_ID = "veh_0";
    private static final long DEMO_BRAKE_START_NS = 20_000_000_000L;
    private static final long INCIDENT_STOP_DURATION_NS = 2_000_000_000_000L;
    private static final String CRASH_FOLLOWER_ID = "veh_1";
    private static final long INCIDENT_BEACON_INTERVAL_NS = 500_000_000L;
    private static final long FORWARD_DELAY_NS = 1_000_000_000L;
    private static final long RELAY_INTERVAL_NS = 2_000_000_000L;
    private static final long ACTIVE_HAZARD_TIMEOUT_NS = 5_000_000_000L;
    private static final long FOLLOWER_APPROACH_DURATION_NS = 15_000_000_000L;
    private static final double FOLLOWER_MINIMUM_APPROACH_SPEED_MPS = 36.11;
    private static final double CONTROLLED_LEAD_DECELERATION_MPS2 = -50.0;
    private static final double COLLISION_PROXIMITY_METRES = 12.0;
    private static final double WARNING_TTC_SECONDS = 4.0;
    private static final double CRITICAL_TTC_SECONDS = 2.0;

    private long brakingStartedAt = Long.MIN_VALUE;
    private long lastStateTime = Long.MIN_VALUE;
    private double lastSpeed;
    private boolean brakingEventReported;
    private boolean demoBrakeCommandIssued;
    private boolean leadBrakeIssued;
    private boolean followerApproachIssued;
    private boolean collisionConfirmed;
    private final Set<String> seenHazards = new HashSet<>();
    private Denm sourceIncidentDenm;
    private long nextSourceAlertAt = Long.MAX_VALUE;
    private Denm pendingForwardDenm;
    private GeoPoint pendingForwardPosition;
    private long pendingForwardAt = Long.MAX_VALUE;
    private long lastHazardReceivedAt = Long.MIN_VALUE;
    private GeoPoint latestHazardPosition;
    private long nextFollowerLanePinAt = Long.MIN_VALUE;

    @Override
    public void onStartup() {
        getOperatingSystem().getAdHocModule().enable();
        setVehicleColor(Color.WHITE);
        getLog().info("HardBrakeSafetyApp started; vehicle=" + getOperatingSystem().getId());
    }

    @Override
    public void onShutdown() {
        getLog().info("HardBrakeSafetyApp stopped; vehicle=" + getOperatingSystem().getId());
    }

    @Override
    public void processEvent(Event event) throws Exception {
        // V1 does not schedule application events.
    }

    @Override
    public void onVehicleUpdated(VehicleData previous, VehicleData updated) {
        if (!isValidStateAndLog() || updated == null) {
            return;
        }

        long now = getOperatingSystem().getSimulationTime();
        keepCrashFollowerOnCollisionCourse(updated, now);
        issueDeterministicIncident(updated, now);
        detectFollowerCollision(updated, now);
        repeatIncidentBeaconIfDue(updated, now);
        forwardPendingDenmIfDue(now);
        double acceleration = updated.getLongitudinalAcceleration() != null
                ? updated.getLongitudinalAcceleration()
                : deriveAcceleration(updated.getSpeed(), now);

        if (acceleration <= HARD_BRAKING_ACCELERATION_MPS2) {
            if (brakingStartedAt == Long.MIN_VALUE) {
                brakingStartedAt = now;
            }
            if (!brakingEventReported
                    && now - brakingStartedAt >= MINIMUM_BRAKING_DURATION_NS) {
                transmitHardBrakingDenm(updated, now, acceleration);
                brakingEventReported = true;
            }
        } else {
            brakingStartedAt = Long.MIN_VALUE;
            brakingEventReported = false;
        }

        lastStateTime = now;
        lastSpeed = updated.getSpeed();
    }

    private void keepCrashFollowerOnCollisionCourse(VehicleData updated, long now) {
        boolean controlledCrashVehicle = CRASH_FOLLOWER_ID.equals(getOperatingSystem().getId())
                || DEMO_BRAKE_SOURCE_ID.equals(getOperatingSystem().getId());
        if (controlledCrashVehicle && !collisionConfirmed && now >= nextFollowerLanePinAt) {
            getOperatingSystem().changeLane(0, 1_000_000_000L);
            if (CRASH_FOLLOWER_ID.equals(getOperatingSystem().getId())) {
                double commandedSpeed = Math.max(updated.getSpeed(), FOLLOWER_MINIMUM_APPROACH_SPEED_MPS);
                getOperatingSystem().changeSpeedWithForcedAcceleration(commandedSpeed, 10.0);
            }
            nextFollowerLanePinAt = now + 500_000_000L;
        }
    }

    private void issueDeterministicIncident(VehicleData updated, long now) {
        if (!leadBrakeIssued
                && DEMO_BRAKE_SOURCE_ID.equals(getOperatingSystem().getId())
                && now >= DEMO_BRAKE_START_NS) {
            getOperatingSystem().stopNow(VehicleStopMode.STOP, INCIDENT_STOP_DURATION_NS);
            getOperatingSystem().changeSpeedWithForcedAcceleration(0.0, CONTROLLED_LEAD_DECELERATION_MPS2);
            leadBrakeIssued = true;
            sourceIncidentDenm = transmitHardBrakingDenm(updated, now, -6.0);
            nextSourceAlertAt = now + INCIDENT_BEACON_INTERVAL_NS;
            getLog().info("LEAD EMERGENCY BRAKE: time=" + now + ", vehicle=" + getOperatingSystem().getId());
        }
        if (!followerApproachIssued
                && CRASH_FOLLOWER_ID.equals(getOperatingSystem().getId())
                && now >= DEMO_BRAKE_START_NS) {
            double commandedSpeed = Math.max(updated.getSpeed(), FOLLOWER_MINIMUM_APPROACH_SPEED_MPS);
            getOperatingSystem().changeLane(0, FOLLOWER_APPROACH_DURATION_NS);
            getOperatingSystem().changeSpeedWithInterval(commandedSpeed, FOLLOWER_APPROACH_DURATION_NS);
            followerApproachIssued = true;
            getLog().info("FOLLOWER COLLISION APPROACH: time=" + now + ", vehicle=" + getOperatingSystem().getId()
                    + ", commandedSpeed=" + commandedSpeed);
        }
    }

    private void detectFollowerCollision(VehicleData updated, long now) {
        if (collisionConfirmed
                || !CRASH_FOLLOWER_ID.equals(getOperatingSystem().getId())
                || latestHazardPosition == null
                || now < DEMO_BRAKE_START_NS) {
            return;
        }
        double distance = latestHazardPosition.distanceTo(getOperatingSystem().getPosition());
        if (updated.isStopped() && distance <= COLLISION_PROXIMITY_METRES) {
            collisionConfirmed = true;
            sourceIncidentDenm = transmitHardBrakingDenm(updated, now, -6.0);
            nextSourceAlertAt = now + INCIDENT_BEACON_INTERVAL_NS;
            pendingForwardDenm = null;
            pendingForwardAt = Long.MAX_VALUE;
            getLog().info("COLLISION VEHICLE CONFIRMED: time=" + now + ", vehicle=" + getOperatingSystem().getId()
                    + ", distanceToLead=" + distance + " m, stopped=" + updated.isStopped());
        }
    }

    private void repeatIncidentBeaconIfDue(VehicleData updated, long now) {
        boolean incidentBroadcaster = DEMO_BRAKE_SOURCE_ID.equals(getOperatingSystem().getId()) && leadBrakeIssued
                || CRASH_FOLLOWER_ID.equals(getOperatingSystem().getId()) && collisionConfirmed;
        if (!incidentBroadcaster || sourceIncidentDenm == null || now < nextSourceAlertAt) {
            return;
        }
        sourceIncidentDenm = transmitHardBrakingDenm(updated, now, -6.0);
        nextSourceAlertAt = now + INCIDENT_BEACON_INTERVAL_NS;
        getLog().info("TX PERSISTENT INCIDENT DENM: time=" + now + ", sender=" + getOperatingSystem().getId());
    }

    private void forwardPendingDenmIfDue(long now) {
        if (pendingForwardDenm == null || now < pendingForwardAt) {
            return;
        }
        if (now - lastHazardReceivedAt > ACTIVE_HAZARD_TIMEOUT_NS) {
            pendingForwardDenm = null;
            pendingForwardPosition = null;
            pendingForwardAt = Long.MAX_VALUE;
            return;
        }
        forwardDenm(pendingForwardDenm, pendingForwardPosition, now);
        pendingForwardAt = now + RELAY_INTERVAL_NS;
    }
    private double deriveAcceleration(double currentSpeed, long currentTime) {
        if (lastStateTime == Long.MIN_VALUE || currentTime <= lastStateTime) {
            return 0.0;
        }
        double elapsedSeconds = (currentTime - lastStateTime) / 1_000_000_000.0;
        return (currentSpeed - lastSpeed) / elapsedSeconds;
    }

    private Denm transmitHardBrakingDenm(VehicleData vehicleData, long now, double acceleration) {
        GeoPoint position = getOperatingSystem().getPosition();
        String roadId = getRoadConnectionId();
        getLog().info("Hard braking detected: time=" + now + ", vehicle=" + getOperatingSystem().getId() + ", acceleration=" + acceleration + ", position=" + position + ", road=" + roadId);

        AdHocModule adHocModule = getOperatingSystem().getAdHocModule();
        AdHocMessageRoutingBuilder builder = adHocModule.createMessageRouting();
        MessageRouting routing = builder
                .channel(AdHocChannel.CCH)
                .geographical(new GeoCircle(position, HAZARD_RADIUS_METRES))
                .broadcast()
                .hops(HAZARD_HOP_TTL)
                .build();

        DenmContent content = new DenmContent(
                now,
                position,
                roadId,
                EnvironmentEventCause.DANGEROUS_SITUATION,
                (float) vehicleData.getSpeed(),
                (float) acceleration);
        Denm denm = new Denm(routing, content, 200L);
        seenHazards.add(buildHazardKey(denm));
        adHocModule.sendV2xMessage(denm);
        setVehicleColor(Color.RED);
        getLog().info("TX DENM: time=" + now + ", sender=" + getOperatingSystem().getId() + ", cause=" + denm.getEventCause() + ", position=" + denm.getSenderPosition());
        return denm;
    }

    private String getRoadConnectionId() {
        IRoadPosition roadPosition = getOperatingSystem().getRoadPosition();
        if (roadPosition == null || roadPosition.getConnection() == null) {
            return null;
        }
        return roadPosition.getConnection().getId();
    }

    @Override
    public void onMessageReceived(ReceivedV2xMessage receivedMessage) {
        V2xMessage message = receivedMessage.getMessage();
        if (!(message instanceof Denm)) {
            return;
        }

        Denm denm = (Denm) message;
        long now = getOperatingSystem().getSimulationTime();

        long age = now - denm.getTime();
        if (age < 0 || age > MESSAGE_FRESHNESS_NS) {
            return;
        }

        GeoPoint eventPosition = denm.getEventLocation() != null
                ? denm.getEventLocation()
                : denm.getSenderPosition();
        GeoPoint receiverPosition = getOperatingSystem().getPosition();
        VehicleData receiverData = getOperatingSystem().getVehicleData();
        String receiverRoadId = getRoadConnectionId();
        boolean sameRoad = receiverRoadId != null && receiverRoadId.equals(denm.getEventRoadId());

        double distance = Double.POSITIVE_INFINITY;
        double closingSpeed = 0.0;
        double ttc = Double.POSITIVE_INFINITY;
        if (sameRoad && eventPosition != null && receiverPosition != null) {
            distance = eventPosition.distanceTo(receiverPosition);
            closingSpeed = receiverData.getSpeed() - denm.getCausedSpeed();
            if (closingSpeed > 0.0) {
                ttc = distance / closingSpeed;
            }
        }

        RiskState risk = classifyRisk(ttc);
        boolean firstReception = seenHazards.add(buildHazardKey(denm));
        latestHazardPosition = eventPosition;
        lastHazardReceivedAt = now;
        setVehicleColor(Color.GREEN);
        getLog().info("RX DENM: time=" + now + ", receiver=" + getOperatingSystem().getId() + ", senderPosition=" + denm.getSenderPosition() + ", eventRoad=" + denm.getEventRoadId() + ", age=" + age + " ns, eventPosition=" + eventPosition
                + ", ttc=" + ttc + " s, risk=" + risk + ", firstReception=" + firstReception);
        boolean incidentBroadcaster = DEMO_BRAKE_SOURCE_ID.equals(getOperatingSystem().getId()) && leadBrakeIssued
                || CRASH_FOLLOWER_ID.equals(getOperatingSystem().getId()) && collisionConfirmed;
        if (!incidentBroadcaster && eventPosition != null) {
            pendingForwardDenm = denm;
            pendingForwardPosition = eventPosition;
            if (pendingForwardAt == Long.MAX_VALUE) {
                pendingForwardAt = now + FORWARD_DELAY_NS;
                getLog().info("DENM RELAY ACTIVATED: time=" + now + ", vehicle=" + getOperatingSystem().getId()
                        + ", firstRelayAt=" + pendingForwardAt);
            }
        }
    }

    private MessageRouting createHazardRouting(GeoPoint eventPosition) {
        return getOperatingSystem().getAdHocModule().createMessageRouting()
                .channel(AdHocChannel.CCH)
                .geographical(new GeoCircle(eventPosition, HAZARD_RADIUS_METRES))
                .broadcast()
                .hops(HAZARD_HOP_TTL)
                .build();
    }

    private void forwardDenm(Denm receivedDenm, GeoPoint eventPosition, long now) {
        MessageRouting routing = createHazardRouting(eventPosition);
        DenmContent content = new DenmContent(
                now,
                eventPosition,
                receivedDenm.getEventRoadId(),
                receivedDenm.getEventCause(),
                receivedDenm.getCausedSpeed(),
                receivedDenm.getSenderDeceleration());
        Denm forwardedDenm = new Denm(routing, content, 200L);
        getOperatingSystem().getAdHocModule().sendV2xMessage(forwardedDenm);
        setVehicleColor(Color.RED);
        getLog().info("RELAY DENM: time=" + now + ", vehicle=" + getOperatingSystem().getId()
                + ", eventRoad=" + receivedDenm.getEventRoadId() + ", eventPosition=" + eventPosition);
    }
    private String buildHazardKey(Denm denm) {
        return String.valueOf(denm.getEventRoadId()) + "|" + String.valueOf(denm.getEventCause());
    }

    private void setVehicleColor(Color color) {
        getOperatingSystem().requestVehicleParametersUpdate().changeColor(color).apply();
    }

    private RiskState classifyRisk(double ttc) {
        if (!Double.isFinite(ttc) || ttc > WARNING_TTC_SECONDS) {
            return RiskState.SAFE;
        }
        if (ttc > CRITICAL_TTC_SECONDS) {
            return RiskState.WARNING;
        }
        return RiskState.CRITICAL;
    }

    @Override
    public void onAcknowledgementReceived(ReceivedAcknowledgement acknowledgement) {
        // V1 does not use acknowledgements.
    }

    @Override
    public void onCamBuilding(CamBuilder camBuilder) {
        // V1 does not customize CAM generation.
    }

    @Override
    public void onMessageTransmitted(V2xMessageTransmission transmission) {
        // V1 does not process transmission notifications.
    }

    private enum RiskState {
        SAFE,
        WARNING,
        CRITICAL
    }
}
