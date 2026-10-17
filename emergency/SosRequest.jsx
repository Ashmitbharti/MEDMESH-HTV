import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { answerRequest, expireRequest, questions, startQuestions } from './questions';
import QrIdentification from './QrIdentification';
import { loadRequest, updateRequest } from './requestService';
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
    } catch (error) {
      setError(error.message || 'Could not save this update. Please try again.');
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }

  function answer(value) {
    const key = question.key;
    const answeredAt = Date.now();
    saveUpdate((current) => answerRequest(current, key, value, answeredAt));
  }

  function cancel() {
    Alert.alert('Cancel this request?', 'Your local request will be marked cancelled.', [
      { text: 'Keep active', style: 'cancel' },
      { text: 'Cancel request', style: 'destructive', onPress: () => saveUpdate((current) => ({
        ...current, phase: 'cancelled', deadline: null, cancelledAt: new Date().toISOString(),
      })) },
    ]);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{request?.mode === 'other' ? 'Help someone else' : 'Emergency request'}</Text>
        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>Not sent</Text>
          <Text style={styles.description}>No mesh connection. No responder has been dispatched.</Text>
        </View>

        {loading ? <Text style={styles.description}>Loading your local request…</Text> : null}

        {!loading && request ? (
          <>
            <Text style={styles.description}>
              {request.mode === 'self' ? 'For you' : 'For another person'}
              {' · '}{request.medmeshId || 'No MedMesh ID attached'}
            </Text>
            <Text style={styles.hint}>Request saved on this phone.</Text>

            {request.escalation ? (
              <View style={styles.statusCard}>
                <Text style={styles.statusTitle}>No response recorded</Text>
                <Text style={styles.description}>
                  Request saved—waiting to send. You can keep answering.
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
                    <Pressable accessibilityRole="button" disabled={busy} style={styles.primaryButton}
                      onPress={() => answer(location)}>
                      <Text style={styles.buttonText}>Use this location</Text>
                    </Pressable>
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

            {request.phase === 'cancelled' ? (
              <Text style={styles.description}>This local request has been cancelled.</Text>
            ) : (
              <Pressable accessibilityRole="button" disabled={busy} style={styles.cancelButton} onPress={cancel}>
                <Text style={styles.cancelText}>Cancel request</Text>
              </Pressable>
            )}
          </>
        ) : null}

        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <Pressable accessibilityRole="button" style={styles.answerButton} onPress={() => router.replace('/')}>
          <Text style={styles.buttonText}>Back to Home</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
