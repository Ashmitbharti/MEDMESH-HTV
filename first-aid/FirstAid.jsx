import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { guides } from './guides';
import CprBeat from './CprBeat';
import AidTimer from './AidTimer';
import styles from './FirstAid.styles';

function Guide({ guide, onClose }) {
  const [checked, setChecked] = useState([]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable accessibilityRole="button" style={styles.button} onPress={onClose}>
        <Text style={styles.link}>‹ All first-aid guides</Text>
      </Pressable>
      <Text style={styles.eyebrow}>OFFLINE FIRST AID</Text>
      <Text style={styles.title}>{guide.title}</Text>
      <Text style={styles.description}>{guide.description}</Text>
      <View style={styles.warning}><Text style={styles.warningText}>{guide.warning}</Text></View>
      <Text style={styles.muted}>Call 911 when available and follow the dispatcher. This app does not contact 911 or confirm help is on the way.</Text>
      {guide.tool === 'beat' ? <CprBeat /> : null}
      {guide.tool && guide.tool !== 'beat' ? <AidTimer type={guide.tool} /> : null}
      <View style={styles.row}>
        <Text style={styles.sectionTitle}>Steps</Text>
        <Text style={styles.muted}>{checked.length}/{guide.steps.length} marked</Text>
      </View>
      <Text style={styles.muted}>Checkmarks help you follow along. Complete is not a medical outcome.</Text>
      {guide.steps.map((step, index) => {
        const done = checked.includes(index);
        return (
          <Pressable key={index} accessibilityRole="checkbox" accessibilityState={{ checked: done }}
            accessibilityLabel={`Step ${index + 1}: ${step}`} style={[styles.step, done && styles.stepDone]}
            onPress={() => setChecked((current) => done ? current.filter((value) => value !== index) : [...current, index])}>
            <View style={styles.stepNumber}>{done ? <Ionicons name="checkmark" size={20} color="#87dfb1" /> : <Text style={styles.link}>{index + 1}</Text>}</View>
            <Text style={styles.stepText}>{step}</Text>
          </Pressable>
        );
      })}
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => setChecked([])}><Text style={styles.link}>Reset checklist</Text></Pressable>
      <Pressable accessibilityRole="button" style={styles.primary} onPress={() => router.push('/home')}>
        <Text style={styles.primaryText}>Open SOS controls</Text>
      </Pressable>
      <Text style={styles.muted}>General guidance, adapted from {guide.publisher} and checked October 17, 2026. Not a substitute for first-aid training or professional care.</Text>
      <Link href={guide.source} style={styles.source}>Read original guidance ↗</Link>
      <Text style={styles.muted}>Guide text and tools work offline. Source links require internet. Checkmarks reset when leaving a guide.</Text>
    </ScrollView>
  );
}

export default function FirstAid() {
  const [selected, setSelected] = useState(null);
  const guide = guides.find((item) => item.id === selected);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {guide ? <Guide key={guide.id} guide={guide} onClose={() => setSelected(null)} /> : (
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.replace('/home')}><Text style={styles.link}>‹ Home</Text></Pressable>
          <Text style={styles.eyebrow}>READY WITHOUT SIGNAL</Text>
          <Text style={styles.title}>First aid</Text>
          <Text style={styles.description}>Practical steps and tools while you seek help. No internet required.</Text>
          <View style={styles.warning}><Text style={styles.warningText}>Make the scene safe first. Call 911 when available. Do not delay urgent care to complete a checklist.</Text></View>
          {guides.map((item) => (
            <Pressable key={item.id} accessibilityRole="button" style={styles.card} onPress={() => setSelected(item.id)}>
              <View style={styles.icon}><Ionicons name={item.icon} size={26} color={item.color} /></View>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.muted}>{item.description}</Text>
                {item.tool ? <Text style={styles.badge}>{item.tool === 'beat' ? '110 BPM · sound + vibration' : 'Built-in timer'}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color="#747b89" />
            </Pressable>
          ))}
          <Text style={styles.muted}>Educational first aid · adult CPR and choking guidance. No diagnosis, automatic emergency call, or confirmed dispatch.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
