import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import styles from './Home.styles';
import { createRequest, loadRequest } from '../emergency/requestService';

export default function Home() {
  const [selected, setSelected] = useState(null);
  const [holding, setHolding] = useState(null);
  const [remaining, setRemaining] = useState(3000);
  const [activeRequest, setActiveRequest] = useState(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const hold = useRef(null);
  const openingRef = useRef(false);

  const cancelHold = useCallback((type) => {
    if (type && hold.current?.type !== type) return;
    hold.current = null;
    setHolding(null);
    setRemaining(3000);
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    loadRequest().then((stored) => {
      if (active) setActiveRequest(stored?.phase !== 'cancelled' ? stored : null);
    }).catch(() => {
      if (active) setError('Could not load your local requests. Please try again.');
    });
    return () => { active = false; cancelHold(); };
  }, [cancelHold]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') cancelHold();
    });
    return () => subscription.remove();
  }, [cancelHold]);

  useEffect(() => {
    if (!holding) return;
    const timer = setInterval(() => {
      if (hold.current) {
        setRemaining(Math.max(0, 3000 - (Date.now() - hold.current.started)));
      }
    }, 100);
    return () => clearInterval(timer);
  }, [holding]);

  function startHold(type) {
    if (hold.current || openingRef.current || activeRequest) return;
    hold.current = { type, started: Date.now() };
    setSelected(null);
    setRemaining(3000);
    setHolding(type);
  }

  async function finishHold(type) {
    if (hold.current?.type !== type || Date.now() - hold.current.started < 3000) return;
    if (openingRef.current) return;
    openingRef.current = true;
    setSelected(type);
    cancelHold();
    setOpening(true);
    setError('');
    try {
      const request = await createRequest(type);
      setActiveRequest(request);
      router.push('/sos');
    } catch {
      setError('Could not save your request on this phone. No request has been sent. Please try again.');
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Home</Text>
        <Text style={styles.description}>Who needs help?</Text>

        <Pressable
          accessibilityRole="button"
          accessibilityHint="Press and hold for three seconds. Release early to cancel."
          disabled={opening || !!activeRequest}
          accessibilityState={{ selected: selected === 'self', disabled: opening || !!activeRequest }}
          style={({ pressed }) => [
            styles.card,
            styles.troubleCard,
            selected === 'self' && styles.troubleSelected,
            pressed && styles.pressed,
          ]}
          delayLongPress={3000}
          onPressIn={() => startHold('self')}
          onPressOut={() => cancelHold('self')}
          onLongPress={() => finishHold('self')}
        >
          <View style={[styles.icon, styles.troubleIcon]}>
            <Ionicons name="alert-circle-outline" size={28} color="#ff8c9d" />
          </View>
          <Text style={styles.cardTitle}>{"I'm in trouble"}</Text>
          <Text style={styles.cardDescription}>Get emergency help for yourself</Text>
          <Text style={styles.holdLabel}>
            {holding === 'self' ? `Keep holding · ${Math.ceil(remaining / 1000)}s` : 'Press and hold for 3 seconds'}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[
              styles.progressFill,
              styles.troubleProgress,
              { width: holding === 'self' ? `${(1 - remaining / 3000) * 100}%` : '0%' },
            ]} />
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityHint="Press and hold for three seconds. Release early to cancel."
          disabled={opening || !!activeRequest}
          accessibilityState={{ selected: selected === 'other', disabled: opening || !!activeRequest }}
          style={({ pressed }) => [
            styles.card,
            selected === 'other' && styles.helpSelected,
            pressed && styles.pressed,
          ]}
          delayLongPress={3000}
          onPressIn={() => startHold('other')}
          onPressOut={() => cancelHold('other')}
          onLongPress={() => finishHold('other')}
        >
          <View style={[styles.icon, styles.helpIcon]}>
            <Ionicons name="people-outline" size={28} color="#7dcfff" />
          </View>
          <Text style={styles.cardTitle}>Help someone else</Text>
          <Text style={styles.cardDescription}>Help a person who needs assistance</Text>
          <Text style={styles.holdLabel}>
            {holding === 'other' ? `Keep holding · ${Math.ceil(remaining / 1000)}s` : 'Press and hold for 3 seconds'}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[
              styles.progressFill,
              { width: holding === 'other' ? `${(1 - remaining / 3000) * 100}%` : '0%' },
            ]} />
          </View>
        </Pressable>

        {opening ? <Text style={styles.notice}>Saving your request…</Text> : null}
        {activeRequest ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Saved emergency request</Text>
            <Text style={styles.cardDescription}>
              {activeRequest.mode === 'self' ? 'For you' : 'For another person'}
              {' · '}Not sent. No mesh connection.
            </Text>
            <Text style={styles.notice}>Resume or cancel this request before starting another.</Text>
            <Pressable accessibilityRole="button" style={styles.resumeButton} onPress={() => router.push('/sos')}>
              <Text style={styles.resumeText}>Resume request</Text>
            </Pressable>
          </View>
        ) : null}
        {error ? <Text style={styles.notice} accessibilityRole="alert">{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
