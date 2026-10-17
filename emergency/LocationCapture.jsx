import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { captureLocation } from './locationService';
import { attachCoordinates } from './requestLifecycle';
import styles from './SosRequest.styles';

export default function LocationCapture({ request, busy, onSave }) {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function locate() {
    if (pending.current || busy) return;
    pending.current = true;
    setLocating(true);
    setError('');
    try {
      const fix = await captureLocation();
      if (!active.current) return;
      const saved = await onSave((current) => attachCoordinates(current, fix));
      if (!saved) throw new Error('Could not save the phone location. Please try again.');
    } catch (error) {
      if (active.current) setError(error.message || 'Could not get your location. Enter a landmark instead.');
    } finally {
      pending.current = false;
      if (active.current) setLocating(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.question}>Location for help</Text>
      <Text style={styles.hint}>Use the phone location only if you are with the person needing help.</Text>
      {request.coordinates ? (
        <>
          <Text style={styles.summaryValue}>
            {request.coordinates.latitude.toFixed(5)}, {request.coordinates.longitude.toFixed(5)}
          </Text>
          <Text style={styles.hint}>
            {request.coordinates.accuracy != null ? `Accuracy: about ${Math.round(request.coordinates.accuracy)} m · ` : ''}
            {new Date(request.coordinates.capturedAt).toLocaleString()}
          </Text>
        </>
      ) : null}
      <Pressable accessibilityRole="button" disabled={busy || locating} style={styles.answerButton} onPress={locate}>
        <Text style={styles.buttonText}>{locating ? 'Finding location…' : request.coordinates ? 'Refresh phone location' : 'Use phone location'}</Text>
      </Pressable>
      <Text style={styles.hint}>You can enter a landmark in the questions if location is unavailable.</Text>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}
