import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import styles from './SosRequest.styles';

export default function QrIdentification({ focused, busy, savedId, onContinue }) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [scannedId, setScannedId] = useState(null);
  const [manualId, setManualId] = useState('');
  const [error, setError] = useState('');
  const [cameraError, setCameraError] = useState(false);
  const scanLock = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
      if (state === 'active') getPermission().catch(() => setError('Could not check camera permission.'));
    });
    return () => subscription.remove();
  }, [getPermission]);

  function handleScan({ data }) {
    if (scanLock.current || busy) return;
    const id = typeof data === 'string' ? data.trim().toUpperCase() : '';
    if (!/^[A-Z]{6}$/.test(id)) {
      setError('This QR code does not contain a six-letter MedMesh ID.');
      return;
    }
    scanLock.current = true;
    setScannedId(id);
    setError('');
  }

  async function enableCamera() {
    setError('');
    try {
      if (permission && !permission.canAskAgain) {
        await Linking.openSettings();
      } else {
        await requestPermission();
      }
    } catch {
      setError('Could not open the camera. Enter the ID below or continue without one.');
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.progress}>Step 1 · Identify the person</Text>
      <Text style={styles.question}>Scan their MedMesh QR</Text>
      <Text style={styles.hint}>The five-second question timers start after this step.</Text>

      {scannedId ? (
        <>
          <Text style={styles.scannedId}>{scannedId}</Text>
          <Text style={styles.hint}>Check that this is the ID of the person needing help.</Text>
          <Pressable accessibilityRole="button" disabled={busy} style={styles.primaryButton} onPress={() => onContinue(scannedId)}>
            <Text style={styles.buttonText}>Use this ID</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} style={styles.answerButton} onPress={() => {
            scanLock.current = false;
            setScannedId(null);
          }}>
            <Text style={styles.buttonText}>Scan again</Text>
          </Pressable>
        </>
      ) : (
        <>
          {permission?.granted && focused && active && !cameraError && !busy ? (
            <View style={styles.cameraFrame}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={handleScan}
                onMountError={() => {
                  setCameraError(true);
                  setError('Camera unavailable. Enter the ID below or continue without one.');
                }}
              />
            </View>
          ) : !permission?.granted ? (
            <Pressable accessibilityRole="button" disabled={busy || !permission} style={styles.primaryButton} onPress={enableCamera}>
              <Text style={styles.buttonText}>
                {!permission ? 'Checking camera permission…' : permission.canAskAgain ? 'Enable camera' : 'Open camera settings'}
              </Text>
            </Pressable>
          ) : null}

          <TextInput
            style={styles.input}
            accessibilityLabel="MedMesh ID"
            placeholder="Or enter the six-letter ID"
            placeholderTextColor="#777d89"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            value={manualId}
            editable={!busy}
            onChangeText={(value) => setManualId(value.toUpperCase().replace(/[^A-Z]/g, ''))}
          />
          <Pressable accessibilityRole="button" disabled={busy} style={styles.answerButton} onPress={() => {
            if (!/^[A-Z]{6}$/.test(manualId)) { setError('Enter a six-letter MedMesh ID.'); return; }
            onContinue(manualId);
          }}>
            <Text style={styles.buttonText}>Use entered ID</Text>
          </Pressable>
          {savedId ? (
            <Pressable accessibilityRole="button" disabled={busy} style={styles.answerButton} onPress={() => onContinue(savedId)}>
              <Text style={styles.buttonText}>Use my saved ID · {savedId}</Text>
            </Pressable>
          ) : null}
        </>
      )}

      <Pressable accessibilityRole="button" disabled={busy} style={styles.answerButton} onPress={() => onContinue(null)}>
        <Text style={styles.buttonText}>No ID available · continue</Text>
      </Pressable>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}
