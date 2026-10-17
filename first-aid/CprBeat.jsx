import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Switch, Text, Vibration, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import styles from './FirstAid.styles';

const source = require('../assets/cpr-beat.wav');

export default function CprBeat() {
  const playerRef = useRef(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [running, setRunning] = useState(false);
  const [vibrate, setVibrate] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [error, setError] = useState('');
  const focused = useRef(false);
  const starting = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const player = createAudioPlayer(source);
    player.loop = true;
    playerRef.current = player;
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (playerRef.current !== player) return;
      setLoaded(status.isLoaded);
      setPlaying(status.playing);
    });
    return () => {
      mounted.current = false;
      generation.current += 1;
      playerRef.current = null;
      subscription.remove();
      Vibration.cancel();
      try {
        player.pause();
      } catch {
        // A native interruption can invalidate playback during teardown.
      } finally {
        player.remove();
      }
    };
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    const player = playerRef.current;
    if (player) {
      try {
        player.pause();
      } catch {
        if (mounted.current) setError('Audio could not pause. Leave this guide to release the player.');
      }
    }
    Vibration.cancel();
    setRunning(false);
    setPulse(false);
  }, []);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { focused.current = false; stop(); }
      else focused.current = true;
    });
    return () => { focused.current = false; listener.remove(); stop(); };
  }, [stop]));

  useEffect(() => {
    if (!running || !playing) return;
    let pulseTimeout;
    const tick = () => {
      setPulse(true);
      pulseTimeout = setTimeout(() => setPulse(false), 150);
      if (vibrate) Vibration.vibrate(25);
    };
    tick();
    const timer = setInterval(tick, 60000 / 110);
    return () => { clearInterval(timer); clearTimeout(pulseTimeout); Vibration.cancel(); setPulse(false); };
  }, [running, playing, vibrate]);

  async function toggle() {
    if (running) { stop(); return; }
    if (starting.current) return;
    starting.current = true;
    const player = playerRef.current;
    const token = generation.current;
    setError('');
    try {
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'mixWithOthers' });
      if (!player || !focused.current || token !== generation.current) return;
      await player.seekTo(0);
      if (!focused.current || token !== generation.current || playerRef.current !== player) return;
      player.play();
      setRunning(true);
    } catch {
      if (mounted.current) setError('Audio could not start. Aim for 100–120 compressions per minute.');
    } finally {
      starting.current = false;
    }
  }

  return (
    <View style={styles.tool}>
      <Text style={styles.sectionTitle}>CPR rhythm aid</Text>
      <View style={[styles.beatCircle, running && pulse && styles.beatActive]}>
        <Text style={styles.beatNumber}>110</Text>
        <Text style={styles.muted}>beats / minute</Text>
      </View>
      <Pressable accessibilityRole="button" disabled={!loaded} style={styles.primary} onPress={toggle}>
        <Text style={styles.primaryText}>{!loaded ? 'Loading offline beat…' : running ? 'Stop CPR beat' : 'Start CPR beat'}</Text>
      </Pressable>
      <View style={styles.row}>
        <Text style={styles.body}>Vibration cues</Text>
        <Switch accessibilityLabel="CPR vibration cues" value={vibrate} onValueChange={setVibrate} />
      </View>
      <Text style={styles.muted}>Audio uses your phone’s volume and output device. Keep this screen open; the beat stops when you leave or lock the app.</Text>
      {error ? <Text style={styles.warningText}>{error}</Text> : null}
    </View>
  );
}
