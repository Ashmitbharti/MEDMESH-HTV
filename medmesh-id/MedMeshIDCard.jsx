import { Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import styles from './MedMeshID.styles';

export default function MedMeshIDCard({ profile, dirty }) {
  const id = profile.medmeshId;
  const hasRegisteredId = typeof id === 'string' && /^[A-Z]{6}$/.test(id);

  return (
    <View style={styles.uploadCard}>
      <Text style={styles.label}>Your saved MedMesh ID</Text>
      {profile.details?.name ? <Text style={styles.cardName}>{profile.details.name}</Text> : null}
      <Text style={styles.medmeshId} selectable>
        {hasRegisteredId ? id : 'Awaiting registration'}
      </Text>

      {hasRegisteredId ? (
        <>
          <View
            style={styles.qrContainer}
            accessible
            accessibilityRole="image"
            accessibilityLabel={`QR code for MedMesh ID ${id}`}
          >
            <QRCode
              value={id}
              size={168}
              quietZone={32}
              color="#070b14"
              backgroundColor="#ffffff"
              ecl="M"
            />
          </View>
          <Text style={styles.qrCaption}>Scan to read your MedMesh ID</Text>
          <Text style={styles.qrOffline}>Available offline</Text>
        </>
      ) : (
        <Text style={styles.hint}>Connect to the internet and sync to create your ID and QR code.</Text>
      )}

      <Text style={styles.hint}>
        {dirty ? 'You have unsaved changes.' : profile.status === 'synced'
          ? 'Saved on this phone and in Supabase.'
          : 'Saved on this phone. Internet is needed to sync.'}
      </Text>
      <Text style={styles.hint}>Command centre backup sync is not connected yet.</Text>
    </View>
  );
}
