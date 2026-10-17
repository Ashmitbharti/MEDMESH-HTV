import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { answerRequest, expireRequest, questions, startQuestions } from './questions';
import QrIdentification from './QrIdentification';
import { loadRequest, retryDelivery, subscribeRequest, syncCloudRequest, updateRequest } from './requestService';
import { addConditionUpdate, attachCoordinates, cancelRequest, updateLandmark } from './requestLifecycle';
import { captureLocation } from './locationService';
import LocationCapture from './LocationCapture';
import RequestStatus from './RequestStatus';
import styles from './SosRequest.styles';

export default function SosRequest() {
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [focused, setFocused] = useState(false);
  const [remaining, setRemaining] = useState(5);
  const [location, setLocation] = useState('');
  const [personId, setPersonId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conditionUpdate, setConditionUpdate] = useState('');
  const [newLandmark, setNewLandmark] = useState('');
  const [sending, setSending] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const locationPending = useRef(false);
  const changing = useRef(false);
  const question = request ? questions[request.questionIndex] : null;
  const missed = question && request.missedQuestions.includes(question.key);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    loadRequest().then((stored) => {
      if (!active) return;
      setRequest(stored);
      setPersonId(stored?.medmeshId || '');
      setLocation('');
      setLocationError('');
      setConditionUpdate('');
      setNewLandmark('');
      setError('');
    }).catch(() => {
      if (active) setError('Could not load your request. Return Home and try again.');
    }).finally(() => {
      if (active) {
        setLoading(false);
        setFocused(true);
      }
    });
    return () => { active = false; setFocused(false); };
  }, []));

  useEffect(() => subscribeRequest((saved) => {
    setRequest((current) => current?.id === saved.id ? saved : current);
  }), []);

  const requestId = request?.id;
  useEffect(() => {
    if (!focused || !requestId) return;
    function refresh() {
      if (AppState.currentState === 'active') syncCloudRequest(requestId).catch(() => {});
    }
    refresh();
    const timer = setInterval(refresh, 10000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [focused, requestId]);

  useEffect(() => {
    if (!focused || !request || request.phase !== 'questions' || missed) return;
    let active = true;
    let expiring = false;
    const id = request.id;
    const questionKey = question.key;

    function tick() {
      const left = Math.max(0, request.deadline - Date.now());
      setRemaining(Math.ceil(left / 1000));
      if (left > 0 || expiring) return;
      expiring = true;
      updateRequest(id, (current) => questions[current.questionIndex]?.key === questionKey
        ? expireRequest(current) : current).then((saved) => {
        if (active) setRequest(saved);
      }).catch(() => {
        if (active) setError('Could not save the timeout flag. Your request has not been sent.');
      });
    }

    tick();
    const timer = setInterval(tick, 200);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, [focused, missed, question, request]);

  async function saveUpdate(update) {
    if (changing.current || !request) return;
    changing.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await updateRequest(request.id, update);
      setRequest(saved);
      return saved;
    } catch (error) {
      setError(error.message || 'Could not save this update. Please try again.');
      return null;
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }

  function answer(value, useCoordinates = false) {
    const key = question.key;
    const answeredAt = Date.now();
    saveUpdate((current) => {
      const next = answerRequest(current, key, value, answeredAt);
      return next !== current && key === 'location' && !useCoordinates ? { ...next, coordinates: null } : next;
    });
  }

  function cancel() {
    Alert.alert('Cancel this request?', 'Cancellation is saved here first. A request already sent needs command centre confirmation.', [
      { text: 'Keep active', style: 'cancel' },
      { text: 'Cancel request', style: 'destructive', onPress: () => saveUpdate(cancelRequest) },
    ]);
  }

  async function useLocation() {
    if (locationPending.current || changing.current) return;
    locationPending.current = true;
    setLocationError('');
    try {
      const landmark = location.trim();
      let fix = null;
      if (!landmark) {
        setLocating(true);
        fix = request.coordinates || await captureLocation();
      }
      const answeredAt = Date.now();
      const saved = await saveUpdate((current) => {
        if (current.phase !== 'questions' || questions[current.questionIndex]?.key !== 'location') return current;
        const value = landmark || `${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)}`;
        const located = fix ? attachCoordinates(current, fix) : { ...current, coordinates: null };
        return answerRequest(located, 'location', value, answeredAt);
      });
      if (!saved) setLocationError('Could not save this location. Please try again.');
    } catch (error) {
      setLocationError(error.message || 'Could not get your location. Enter a landmark instead.');
    } finally {
      locationPending.current = false;
      setLocating(false);
    }
  }

  async function retry() {
    if (sending) return;
    setSending(true);
    setError('');
    try {
      const saved = await retryDelivery(request.id);
      setRequest(saved);
    } catch (error) {
      setError(error.message || 'Delivery is not confirmed. Your request is saved.');
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{request?.mode === 'other' ? 'Help someone else' : 'Emergency request'}</Text>
        <Pressable accessibilityRole="button" style={styles.answerButton} onPress={() => router.push('/first-aid')}>
          <Text style={styles.buttonText}>First aid · offline guides and CPR beat</Text>
        </Pressable>
        {request ? <RequestStatus request={request} /> : null}

        {loading ? <Text style={styles.description}>Loading your local request…</Text> : null}

        {!loading && request ? (
          <>
            <Text style={styles.description}>
              {request.mode === 'self' ? 'For you' : 'For another person'}
              {' · '}{request.medmeshId || 'No MedMesh ID attached'}
            </Text>
            <Text style={styles.hint}>Request saved on this phone.</Text>
            {request.lastSyncError ? <Text style={styles.error}>Cloud delivery pending: {request.lastSyncError}</Text> : null}

            {request.escalation && !['cancelled', 'closed'].includes(request.phase) ? (
              <View style={styles.statusCard}>
                <Text style={styles.statusTitle}>No response recorded</Text>
                <Text style={styles.description}>
                  {request.deliveryStatus === 'not_sent'
                    ? 'Request saved—waiting to send. You can keep answering.'
                    : 'Your request remains active. Check delivery status above for confirmation of the latest details.'}
                </Text>
              </View>
            ) : null}

            {request.phase === 'identify' ? (
              <QrIdentification
                focused={focused}
                busy={busy}
                savedId={request.mode === 'self' ? request.medmeshId : null}
                onContinue={(id) => saveUpdate((current) => startQuestions(current, id))}
              />
            ) : null}

            {request.phase === 'ready' || question?.key === 'location' && request.phase === 'questions' ? (
              <LocationCapture request={request} busy={busy} onSave={saveUpdate} />
            ) : null}

            {request.phase === 'questions' && question ? (
              <View style={styles.card}>
                <Text style={styles.progress}>Question {request.questionIndex + 1} of {questions.length}</Text>
                <Text style={styles.question}>
                  {request.mode === 'self' && question.selfTitle ? question.selfTitle : question.title}
                </Text>
                <Text style={styles.hint}>
                  {missed ? 'No response recorded within 5 seconds. You can still answer.'
                    : `${remaining}s to answer · an unanswered question flags your request`}
                </Text>

                {question.input ? (
                  <>
                    {request.coordinates ? (
                      <Pressable accessibilityRole="button" disabled={busy} style={styles.primaryButton}
                        onPress={() => answer(`${request.coordinates.latitude.toFixed(5)}, ${request.coordinates.longitude.toFixed(5)}`, true)}>
                        <Text style={styles.buttonText}>Use captured phone location</Text>
                      </Pressable>
                    ) : null}
                    <TextInput
                      style={styles.input}
                      accessibilityLabel="Address or landmark where help is needed"
                      placeholder="Address or nearby landmark"
                      placeholderTextColor="#777d89"
                      value={location}
                      onChangeText={setLocation}
                      maxLength={300}
                      editable={!busy}
                    />
                    <Pressable accessibilityRole="button" disabled={busy || locating} style={styles.primaryButton}
                      onPress={useLocation}>
                      <Text style={styles.buttonText}>{locating ? 'Finding location…' : 'Use this location'}</Text>
                    </Pressable>
                    {locationError ? <Text style={styles.error} accessibilityRole="alert">{locationError}</Text> : null}
                  </>
                ) : null}

                {question.options.map((option) => (
                  <Pressable key={option} accessibilityRole="button" disabled={busy}
                    style={({ pressed }) => [styles.answerButton, pressed && styles.pressed]}
                    onPress={() => answer(option)}>
                    <Text style={styles.buttonText}>{option}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {!['cancelled', 'closed', 'identify'].includes(request.phase) ? (
              <View style={styles.card}>
                <Text style={styles.question}>Update your request</Text>
                <Text style={styles.hint}>Changes are saved here and need delivery acknowledgment.</Text>
                <TextInput
                  accessibilityLabel="Change in condition"
                  style={styles.input}
                  placeholder="Describe what changed"
                  placeholderTextColor="#777d89"
                  multiline
                  maxLength={500}
                  value={conditionUpdate}
                  editable={!busy}
                  onChangeText={setConditionUpdate}
                />
                <Pressable accessibilityRole="button" disabled={busy} style={styles.answerButton} onPress={async () => {
                  const saved = await saveUpdate((current) => addConditionUpdate(current, conditionUpdate));
                  if (saved) setConditionUpdate('');
                }}>
                  <Text style={styles.buttonText}>Save condition update</Text>
                </Pressable>
                {request.phase === 'ready' ? (
                  <>
                    <TextInput accessibilityLabel="Updated address or landmark" style={styles.input}
                      placeholder="Updated address or landmark" placeholderTextColor="#777d89"
                      value={newLandmark} onChangeText={setNewLandmark} maxLength={300} editable={!busy} />
                    <Pressable accessibilityRole="button" disabled={busy} style={styles.answerButton} onPress={async () => {
                      const saved = await saveUpdate((current) => updateLandmark(current, newLandmark));
                      if (saved) setNewLandmark('');
                    }}>
                      <Text style={styles.buttonText}>Save location update</Text>
                    </Pressable>
                  </>
                ) : null}
                {(request.conditionUpdates || []).map((update, index) => (
                  <View key={`${update.at}-${index}`} style={styles.summaryRow}>
                    <Text style={styles.summaryValue}>{update.text}</Text>
                    <Text style={styles.hint}>{new Date(update.at).toLocaleString()}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Pressable accessibilityRole="button" disabled={sending || busy} style={styles.answerButton} onPress={retry}>
              <Text style={styles.buttonText}>{sending ? 'Checking delivery…' : request.phase === 'cancelled' ? 'Retry cancellation delivery' : 'Send / refresh request status'}</Text>
            </Pressable>

            {request.phase === 'ready' ? (
              <View style={styles.card}>
                <Text style={styles.question}>Request summary</Text>
                {questions.map((item) => (
                  <View key={item.key} style={styles.summaryRow}>
                    <Text style={styles.hint}>{request.mode === 'self' && item.selfTitle ? item.selfTitle : item.title}</Text>
                    <Text style={styles.summaryValue}>{request.answers[item.key] || 'No answer'}</Text>
                    {request.missedQuestions.includes(item.key) ? (
                      <Text style={styles.hint}>Answered after the time limit</Text>
                    ) : null}
                  </View>
                ))}

                {request.mode === 'other' ? (
                  <>
                    <Text style={styles.hint}>Their MedMesh ID (optional)</Text>
                    <TextInput style={styles.input} accessibilityLabel="Other person's MedMesh ID"
                      placeholder="Six-letter ID" placeholderTextColor="#777d89" autoCapitalize="characters"
                      autoCorrect={false} maxLength={6} value={personId} editable={!busy}
                      onChangeText={(value) => setPersonId(value.toUpperCase().replace(/[^A-Z]/g, ''))} />
                    <Pressable accessibilityRole="button" disabled={busy} style={styles.answerButton} onPress={() => {
                      if (!/^[A-Z]{6}$/.test(personId)) { setError('Enter a six-letter MedMesh ID.'); return; }
                      saveUpdate((current) => ({ ...current, medmeshId: personId, updatedAt: new Date().toISOString() }));
                    }}>
                      <Text style={styles.buttonText}>Attach their ID</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            ) : null}

            {request.phase === 'closed' ? <Text style={styles.description}>The hospital confirmed patient arrival and closed this request.</Text> : request.phase === 'cancelled' ? (
              <Text style={styles.description}>Cancellation saved. Check its acknowledgment above.</Text>
            ) : (
              <Pressable accessibilityRole="button" disabled={busy} style={styles.cancelButton} onPress={cancel}>
                <Text style={styles.cancelText}>Cancel request</Text>
              </Pressable>
            )}
          </>
        ) : null}

        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <Pressable accessibilityRole="button" style={styles.answerButton} onPress={() => router.replace('/home')}>
          <Text style={styles.buttonText}>Back to Home</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
