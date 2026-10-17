import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import styles from './FirstAid.styles';

export default function AidTimer({ type }) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(null);
  const cooling = type === 'cooling';

  useEffect(() => {
    if (!running) return;
    const tick = () => setElapsed(Date.now() - started.current);
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [running]);

  function toggle() {
    if (running) {
      setElapsed(Date.now() - started.current);
      setRunning(false);
    } else {
      started.current = Date.now() - elapsed;
      setRunning(true);
    }
  }

  const seconds = cooling ? Math.max(0, Math.ceil((20 * 60000 - elapsed) / 1000)) : Math.floor(elapsed / 1000);
  const display = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <View style={styles.tool}>
      <Text style={styles.sectionTitle}>{cooling ? '20-minute cooling timer' : 'Seizure duration'}</Text>
      <Text style={styles.timer}>{display}</Text>
      <Text style={styles.muted}>{cooling ? 'Start when cooling actually begins. Timer completion does not mean the burn is safe.' : 'Start when the seizure begins. Record the final duration for responders.'}</Text>
      <Pressable accessibilityRole="button" style={styles.primary} onPress={toggle}>
        <Text style={styles.primaryText}>{running ? 'Pause timer' : elapsed ? 'Resume timer' : 'Start timer'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => { setRunning(false); setElapsed(0); started.current = null; }}>
        <Text style={styles.link}>Reset timer</Text>
      </Pressable>
      {!cooling && elapsed >= 5 * 60000 ? <Text style={styles.warningText}>5 minutes reached. Seek emergency help now if not already arranged.</Text> : null}
      {cooling && seconds === 0 ? <Text style={styles.warningText}>20 minutes elapsed. Continue the guide and arrange medical care as needed.</Text> : null}
      <Text style={styles.muted}>No background alarm. Leaving this guide resets the timer.</Text>
    </View>
  );
}
