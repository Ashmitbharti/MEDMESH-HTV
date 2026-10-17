import { Text, View } from 'react-native';
import { deliveryLabel } from './requestLifecycle';
import styles from './SosRequest.styles';

const steps = [
  { key: 'saved', label: 'Saved on this phone' },
  { key: 'node_received', label: 'Sent to node' },
  { key: 'command_received', label: 'Received by command centre' },
  { key: 'responder_dispatched', label: 'Responder dispatched' },
];

export default function RequestStatus({ request }) {
  const rank = steps.findIndex((step) => step.key === request.deliveryStatus);
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
      {steps.map((step, index) => (
        <View key={step.key} style={styles.deliveryRow}>
          <View style={[styles.deliveryDot, (index === 0 || index <= rank) && styles.deliveryDotDone]} />
          <Text style={styles.deliveryText}>{step.label}</Text>
          <Text style={styles.hint}>{index === 0 || index <= rank ? 'Confirmed' : 'Waiting'}</Text>
        </View>
      ))}
      {request.phase !== 'cancelled' && (request.commandRevision || 0) < (request.revision || 1) ? (
        <Text style={styles.hint}>Latest details: awaiting command centre acknowledgment.</Text>
      ) : null}
    </View>
  );
}
