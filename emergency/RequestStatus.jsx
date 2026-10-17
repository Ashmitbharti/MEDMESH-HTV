import { Text, View } from 'react-native';
import { deliveryLabel } from './requestLifecycle';
import styles from './SosRequest.styles';
import { hospitals } from '../command-center/facilities';

const steps = [
  { key: 'saved', label: 'Saved on this phone' },
  { key: 'node_received', label: 'Sent to node' },
  { key: 'command_received', label: 'Received by command centre' },
  { key: 'responder_dispatched', label: 'Responder dispatched' },
];

export default function RequestStatus({ request }) {
  const cloud = request.cloud;
  const cloudSteps = [
    { key: 'saved', label: 'Saved on this phone' },
    { key: 'command_received', label: 'Received by command centre' },
    { key: 'responder_dispatched', label: 'Ambulance dispatch recorded · demo' },
    { key: 'assigned', label: 'Hospital assigned' },
    { key: 'closed', label: 'Patient received · closed' },
  ];
  const displayed = request.deliveryTransport === 'supabase' ? cloudSteps : steps;
  const stage = cloud?.status === 'closed' ? 'closed' : cloud?.hospital_id ? 'assigned' : request.deliveryStatus;
  const rank = displayed.findIndex((step) => step.key === stage);
  const hospital = hospitals.find((item) => item.hosid === cloud?.hospital_id);
  return (
    <View style={styles.statusCard}>
      <Text style={styles.statusTitle}>{deliveryLabel(request)}</Text>
      <Text style={styles.description}>
        {request.phase === 'cancelled' ? request.cancellationConfirmedAt
          ? 'The command centre acknowledged cancellation.' : request.deliveryStatus === 'not_sent'
            ? 'Cancellation saved on this phone. No command centre acknowledgment yet.'
            : 'Cancellation is saved here. Keep the request until the command centre acknowledges it.'
          : request.deliveryStatus === 'not_sent'
            ? 'No delivery or responder dispatch has been confirmed.'
            : 'Status changes only when an acknowledgment arrives.'}
      </Text>
      {hospital ? <Text style={styles.description}>Destination: {hospital.name}</Text> : null}
      {cloud?.ambulance_id ? <Text style={styles.hint}>{cloud.ambulance_id} · demo dispatch; no real ambulance service contacted.</Text> : null}
      {displayed.map((step, index) => (
        <View key={step.key} style={styles.deliveryRow}>
          <View style={[styles.deliveryDot, (index === 0 || index <= rank) && styles.deliveryDotDone]} />
          <Text style={styles.deliveryText}>{step.label}</Text>
          <Text style={styles.hint}>{index === 0 || index <= rank ? 'Confirmed' : 'Waiting'}</Text>
        </View>
      ))}
      {!['cancelled', 'closed'].includes(request.phase) && (request.commandRevision || 0) < (request.revision || 1) ? (
        <Text style={styles.hint}>Latest details: awaiting command centre acknowledgment.</Text>
      ) : null}
    </View>
  );
}
