import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import SosButton from './SosButton';
import { SafeAreaView } from 'react-native-safe-area-context';
import styles from './Home.styles';
import { createRequest, loadRequest, loadRequestHistory, retryDelivery, subscribeRequest, syncCloudRequest } from '../emergency/requestService';
import { deliveryLabel } from '../emergency/requestLifecycle';

export default function Home() {
  const [holding, setHolding] = useState(null);
  const [remaining, setRemaining] = useState(3000);
  const [activeRequest, setActiveRequest] = useState(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const hold = useRef(null);
  const openingRef = useRef(false);
  const retrying = useRef(false);

  async function retryPrevious(id) {
    if (retrying.current) return;
    retrying.current = true;
    setError('');
    try {
      const saved = await retryDelivery(id);
      setHistory((current) => current.map((item) => item.id === saved.id ? saved : item));
    } catch (error) {
      setError(error.message || 'Cancellation delivery is not confirmed.');
    } finally {
      retrying.current = false;
    }
  }

  const cancelHold = useCallback((type) => {
    if (type && hold.current?.type !== type) return;
    hold.current = null;
    setHolding(null);
    setRemaining(3000);
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    const unsubscribe = subscribeRequest((saved) => {
      if (!active) return;
      const finished = ['cancelled', 'closed'].includes(saved.phase);
      setActiveRequest((current) => current?.id === saved.id ? finished ? null : saved : current);
      if (finished) setHistory((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    });
    Promise.all([loadRequest(), loadRequestHistory()]).then(([stored, previous]) => {
      if (active) {
        const finished = ['cancelled', 'closed'].includes(stored?.phase);
        setActiveRequest(finished ? null : stored);
        setHistory(finished ? [stored, ...previous] : previous);
        if (stored && stored.phase !== 'closed') syncCloudRequest(stored.id).catch(() => {});
      }
    }).catch(() => {
      if (active) setError('Could not load your local requests. Please try again.');
    });
    return () => { active = false; unsubscribe(); cancelHold(); };
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
    setRemaining(3000);
    setHolding(type);
  }

  async function finishHold(type) {
    if (hold.current?.type !== type || Date.now() - hold.current.started < 3000) return;
    if (openingRef.current) return;
    openingRef.current = true;
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
        <Pressable accessibilityRole="button" onPress={() => router.replace('/')}>
          <Text style={styles.resumeText}>Switch role</Text>
        </Pressable>
        <Text style={styles.description}>Who needs help?</Text>

        {['self', 'other'].map((mode) => (
          <SosButton key={mode} mode={mode} holding={holding} remaining={remaining}
            disabled={opening || !!activeRequest} onStart={startHold} onFinish={finishHold} onCancel={cancelHold} />
        ))}

        <Pressable accessibilityRole="button" style={styles.firstAidCard} onPress={() => router.push('/first-aid')}>
          <View style={styles.firstAidIcon}><Ionicons name="medical-outline" size={26} color="#87dfb1" /></View>
          <View style={styles.helperText}>
            <Text style={styles.helperTitle}>First aid</Text>
            <Text style={styles.cardDescription}>Offline guides · CPR beat · emergency timers</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#87dfb1" />
        </Pressable>
        <Text style={styles.notice}>First aid works offline. Sending requests still needs a connection.</Text>

        {opening ? <Text style={styles.notice}>Saving your request…</Text> : null}
        {activeRequest ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Saved emergency request</Text>
            <Text style={styles.cardDescription}>
              {activeRequest.mode === 'self' ? 'For you' : 'For another person'}
              {' · '}{deliveryLabel(activeRequest)}
            </Text>
            <Text style={styles.notice}>Resume or cancel this request before starting another.</Text>
            <Pressable accessibilityRole="button" style={styles.resumeButton} onPress={() => router.push('/sos')}>
              <Text style={styles.resumeText}>Resume request</Text>
            </Pressable>
          </View>
        ) : null}
        {history.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Recent requests</Text>
            {history.map((item) => (
              <View key={item.id} style={styles.historyRow}>
                <Text style={styles.cardDescription}>{item.mode === 'self' ? 'For you' : 'For another person'} · {item.medmeshId || 'No ID'}</Text>
                <Text style={styles.notice}>{deliveryLabel(item)}</Text>
                <Text style={styles.notice}>{new Date(item.createdAt).toLocaleString()}</Text>
                {item.phase === 'cancelled' && !item.cancellationConfirmedAt ? (
                  <Pressable accessibilityRole="button" style={styles.resumeButton} onPress={() => retryPrevious(item.id)}>
                    <Text style={styles.resumeText}>Retry cancellation delivery</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
        {error ? <Text style={styles.notice} accessibilityRole="alert">{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
