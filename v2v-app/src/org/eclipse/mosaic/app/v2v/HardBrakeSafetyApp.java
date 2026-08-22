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
    private static final long DEMO_STOP_DURATION_NS = 60_000_000_000L;
    private static final double WARNING_TTC_SECONDS = 4.0;
    private static final double CRITICAL_TTC_SECONDS = 2.0;

    private long brakingStartedAt = Long.MIN_VALUE;
    private long lastStateTime = Long.MIN_VALUE;
    private double lastSpeed;
    private boolean brakingEventReported;
    private boolean demoBrakeCommandIssued;
    private final Set<String> seenHazards = new HashSet<>();

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
        issueDeterministicDemoBrake(now);
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

    private void issueDeterministicDemoBrake(long now) {
        if (!demoBrakeCommandIssued
                && DEMO_BRAKE_SOURCE_ID.equals(getOperatingSystem().getId())
                && now >= DEMO_BRAKE_START_NS) {
            getOperatingSystem().stopNow(VehicleStopMode.STOP, DEMO_STOP_DURATION_NS);
            transmitHardBrakingDenm(getOperatingSystem().getVehicleData(), now, -6.0);
            demoBrakeCommandIssued = true;
            getLog().info("DEMO incident vehicle stopped: time=" + now + ", vehicle=" + getOperatingSystem().getId() + ", duration=" + DEMO_STOP_DURATION_NS + " ns");
        }
    }

    private double deriveAcceleration(double currentSpeed, long currentTime) {
        if (lastStateTime == Long.MIN_VALUE || currentTime <= lastStateTime) {
            return 0.0;
        }
        double elapsedSeconds = (currentTime - lastStateTime) / 1_000_000_000.0;
        return (currentSpeed - lastSpeed) / elapsedSeconds;
    }

    private void transmitHardBrakingDenm(VehicleData vehicleData, long now, double acceleration) {
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
            closingSpeed = denm.getCausedSpeed() - receiverData.getSpeed();
            if (closingSpeed > 0.0) {
                ttc = distance / closingSpeed;
            }
        }

        RiskState risk = classifyRisk(ttc);
        boolean firstReception = seenHazards.add(buildHazardKey(denm));
        setVehicleColor(Color.GREEN);
        getLog().info("RX DENM: time=" + now + ", receiver=" + getOperatingSystem().getId() + ", senderPosition=" + denm.getSenderPosition() + ", eventRoad=" + denm.getEventRoadId() + ", age=" + age + " ns, eventPosition=" + eventPosition
                + ", ttc=" + ttc + " s, risk=" + risk + ", firstReception=" + firstReception);
        if (firstReception && eventPosition != null) {
            forwardDenm(denm, eventPosition, now);
        }
    }

    private void forwardDenm(Denm receivedDenm, GeoPoint eventPosition, long now) {
        MessageRouting routing = getOperatingSystem().getAdHocModule().createMessageRouting()
                .channel(AdHocChannel.CCH)
                .geographical(new GeoCircle(eventPosition, HAZARD_RADIUS_METRES))
                .broadcast()
                .hops(HAZARD_HOP_TTL)
                .build();
        Denm forwardedDenm = new Denm(routing, receivedDenm, 200L);
        getOperatingSystem().getAdHocModule().sendV2xMessage(forwardedDenm);
        setVehicleColor(Color.RED);
        getLog().info("FORWARD DENM: time=" + now + ", vehicle=" + getOperatingSystem().getId() + ", originalTime=" + receivedDenm.getTime() + ", eventRoad=" + receivedDenm.getEventRoadId());
    }

    private String buildHazardKey(Denm denm) {
        return String.valueOf(denm.getEventLocation()) + "|"
                + String.valueOf(denm.getEventRoadId()) + "|"
                + String.valueOf(denm.getEventCause()) + "|"
                + denm.getCausedSpeed();
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
