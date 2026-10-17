import * as Location from 'expo-location';

export async function captureLocation() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Location access was not allowed. Enter an address or landmark instead.');
  if (!await Location.hasServicesEnabledAsync()) throw new Error('Location services are off. Enter a landmark or enable location in phone settings.');

  let timeout;
  try {
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Location took too long. Enter a landmark or try again.')), 15000);
      }),
    ]);
    return {
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracy: fix.coords.accuracy,
      capturedAt: new Date(fix.timestamp).toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}
