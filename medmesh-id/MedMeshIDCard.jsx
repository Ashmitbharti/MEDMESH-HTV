import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Cloud, HeartPulse, QrCode, RotateCw, Server, Smartphone } from 'lucide-react-native';
import styles from './MedMeshID.styles';
import { c, grad } from './theme';

function Status({ icon: Icon, label, state }) {
  const color = state === 'ok' ? c.green : state === 'wait' ? c.amber : c.dim;
  return (
    <View style={[styles.status, { borderColor: color + '55' }]}>
      <Icon size={12} color={color} strokeWidth={2.4} />
      <Text style={[styles.statusText, { color }]}>{label}</Text>
    </View>
  );
}

export default function MedMeshIDCard({ profile, dirty }) {
  const id = profile.medmeshId;
  const hasRegisteredId = typeof id === 'string' && /^[A-Z0-9]{6}$/.test(id);
  const d = profile.details || {};
  const [flipped, setFlipped] = useState(false);
  const [flip] = useState(() => new Animated.Value(0));
  const [sheen] = useState(() => new Animated.Value(0));
  const [appear] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(appear, { toValue: 1, friction: 7, tension: 50, useNativeDriver: true }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(1800),
      Animated.timing(sheen, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(sheen, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [appear, sheen]);

  function toggle() {
    if (!hasRegisteredId) return;
    Animated.spring(flip, { toValue: flipped ? 0 : 1, friction: 8, tension: 40, useNativeDriver: true }).start();
    setFlipped(!flipped);
  }

  const front = { transform: [{ perspective: 1200 }, { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] };
  const back = { transform: [{ perspective: 1200 }, { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] }) }] };
  const sheenX = sheen.interpolate({ inputRange: [0, 1], outputRange: [-260, 420] });
  const allergies = (d.allergies || '').trim();
  const cloud = profile.status === 'synced' ? 'ok' : 'wait';
  const cc = profile.commandCentre === 'synced' ? 'ok' : profile.commandCentre === 'off' ? 'off' : 'wait';

  return (
    <Animated.View style={{ opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hasRegisteredId ? `MedMesh ID ${id}. Tap to ${flipped ? 'hide' : 'show'} the QR code` : 'MedMesh ID awaiting registration'}
        onPress={toggle}
        style={styles.flipWrap}
      >
        <Animated.View style={[styles.idCard, front]}>
          <LinearGradient colors={grad.card} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.idCardFill}>
            <View style={styles.idGlowA} />
            <View style={styles.idGlowB} />
            <View style={styles.idTop}>
              <LinearGradient colors={['#fde68a', '#d97706']} style={styles.chip} />
              <View style={styles.idBrand}>
                <HeartPulse size={14} color={c.sky} strokeWidth={2.4} />
                <Text style={styles.idBrandText}>MEDMESH ID</Text>
              </View>
            </View>
            <Text style={styles.medmeshId} selectable>{hasRegisteredId ? id : '· · · · · ·'}</Text>
            <Text style={styles.cardName} numberOfLines={1}>{d.name || 'Your name'}</Text>
            <View style={styles.idMeta}>
              <View>
                <Text style={styles.idMetaLabel}>BLOOD</Text>
                <Text style={styles.idBlood}>{d.blood || '—'}</Text>
              </View>
              <View>
                <Text style={styles.idMetaLabel}>AGE</Text>
                <Text style={styles.idMetaValue}>{d.age || '—'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.idMetaLabel}>ALLERGIES</Text>
                <Text style={[styles.idMetaValue, allergies && !/^none$/i.test(allergies) && { color: c.redl }]} numberOfLines={1}>
                  {allergies || '—'}
                </Text>
              </View>
            </View>
            <View style={styles.idHint}>
              {hasRegisteredId ? <QrCode size={12} color="rgba(224,242,254,0.7)" /> : null}
              <Text style={styles.idHintText}>{hasRegisteredId ? 'Tap for QR code' : 'Awaiting registration'}</Text>
            </View>
            <Animated.View pointerEvents="none" style={[styles.sheen, { transform: [{ translateX: sheenX }, { rotate: '20deg' }] }]}>
              <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.14)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />
            </Animated.View>
          </LinearGradient>
        </Animated.View>

        <Animated.View style={[styles.idCard, styles.idBack, back]}>
          <LinearGradient colors={grad.card} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={[styles.idCardFill, styles.idBackFill]}>
            {hasRegisteredId ? (
              <View style={styles.qrContainer} accessible accessibilityRole="image" accessibilityLabel={`QR code for MedMesh ID ${id}`}>
                <QRCode value={id} size={116} quietZone={8} color="#070b14" backgroundColor="#ffffff" ecl="M" />
              </View>
            ) : null}
            <Text style={styles.qrCaption}>Scan in an emergency</Text>
            <View style={styles.idHintStatic}>
              <RotateCw size={12} color="rgba(224,242,254,0.7)" />
              <Text style={styles.idHintText}>Works offline · tap to flip back</Text>
            </View>
          </LinearGradient>
        </Animated.View>
      </Pressable>

      <View style={styles.statusRow}>
        <Status icon={Smartphone} label="On this phone" state="ok" />
        <Status icon={Cloud} label={cloud === 'ok' ? 'Registered' : 'Not registered yet'} state={cloud} />
        <Status icon={Server} label={cc === 'ok' ? 'Command centre' : cc === 'off' ? 'Command centre off' : 'Command centre pending'} state={cc} />
      </View>
      {!hasRegisteredId ? <Text style={styles.hint}>Connect to the internet and sync to create your ID and QR code.</Text> : null}
      {dirty ? <Text style={[styles.hint, { color: c.amber }]}>You have unsaved changes.</Text> : null}
    </Animated.View>
  );
}
