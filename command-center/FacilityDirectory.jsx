import RoleSwitch from '../components/RoleSwitch';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { hospitalCapacity, hospitals, pharmacies, referenceLocation, verifiedOn } from './facilities';
import styles from './FacilityDirectory.styles';
import { loadHospitals } from './hospitalService';
import { loadPharmacies } from './pharmacyService';
import { catalogue } from '../pharmacy/catalogue';

export default function FacilityDirectory({ type }) {
  const [expanded, setExpanded] = useState(null);
  const isHospital = type === 'hospitals';
  const [hospitalRecords, setHospitalRecords] = useState(hospitals);
  const [pharmacyRecords, setPharmacyRecords] = useState(pharmacies);
  const [databaseStatus, setDatabaseStatus] = useState('Saved hospital directory');
  const facilities = isHospital ? hospitalRecords : pharmacyRecords;

  useFocusEffect(useCallback(() => {
    let active = true;
    const label = isHospital ? 'Hospital' : 'Pharmacy';
    setDatabaseStatus(`Checking ${label.toLowerCase()} database…`);
    const load = isHospital ? loadHospitals : loadPharmacies;
    load().then((records) => {
      if (!active) return;
      if (isHospital) setHospitalRecords(records);
      else setPharmacyRecords(records);
      setDatabaseStatus(records.every((item) => item.loadedFromDemo) ? 'Demo on this device' : records.every((item) => item.loadedFromCloud)
        ? `${label} database loaded · availability refreshes when you reopen this tab`
        : `Using saved ${label.toLowerCase()} details · database unavailable`);
    }).catch(() => {
      if (active) setDatabaseStatus('Database unavailable · showing last loaded or bundled facility details');
    });
    return () => { active = false; };
  }, [isHospital]));

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>COMMAND CENTER</Text>
          <RoleSwitch />
        </View>
        <Text style={styles.title}>{isHospital ? 'Hospitals' : 'Pharmacies'}</Text>
        <View style={styles.locationCard}>
          <Ionicons name="location-outline" size={22} color="#c5a3ff" />
          <View style={styles.flex}>
            <Text style={styles.locationTitle}>{referenceLocation.name}</Text>
            <Text style={styles.muted}>{referenceLocation.address}</Text>
          </View>
        </View>
        <Text style={styles.description}>
          {isHospital ? 'Three Scarborough hospital sites serving the UTSC area.' : 'Three pharmacies in the UTSC area.'}
          {' '}Public reference details are saved in the app for offline access.
        </Text>
        <Text style={styles.notice}>Directory selection · not a distance ranking. {databaseStatus}</Text>
        {isHospital ? (
          <View style={styles.card}>
            <Text style={styles.organization}>PUBLIC CAPACITY · {hospitalCapacity.period}</Text>
            <Text style={styles.cardTitle}>{hospitalCapacity.beds} beds · SHN network</Text>
            <Text style={styles.body}>{hospitalCapacity.scope}</Text>
            <Text style={styles.muted}>Reported by {hospitalCapacity.organization}. This is historical total capacity, not the number of free beds today.</Text>
            <Text style={styles.muted}>Source checked: {verifiedOn}</Text>
            <Link href={hospitalCapacity.source} style={styles.source}>SHN Key Facts · capacity source ↗</Link>
          </View>
        ) : null}
        {facilities.map((facility) => {
          const open = expanded === facility.id;
          const availability = isHospital ? facility.demoAvailability : facility.pharmacyAvailability;
          const simulated = facility.availabilityIsSimulated !== false;
          const mapUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(referenceLocation.address)}&destination=${encodeURIComponent(facility.address)}`;
          return (
            <View key={facility.id} style={styles.card}>
              <Text style={styles.organization}>{facility.organization}</Text>
              <Text style={styles.cardTitle}>{facility.name}</Text>
              <Text style={styles.body}>{isHospital ? `MedMesh HosID: ${facility.hospitalCode || facility.hosid}` : `MedMesh PharmID: ${facility.pharmacyCode}`}</Text>
              <Text style={styles.body}>{facility.address}</Text>
              <Text style={styles.body}>Phone: {facility.phone}</Text>
              <View style={styles.tags}>
                {facility.services.map((service) => (
                  <View key={service} style={styles.tag}><Text style={styles.tagText}>{service}</Text></View>
                ))}
              </View>
              {isHospital ? (
                <View>
                  <Text style={styles.body}>Total beds: {facility.capacity.beds} · {facility.capacity.simulated ? 'Simulated' : 'Publicly listed'}</Text>
                  <Text style={styles.muted}>{facility.capacity.period}{facility.capacity.simulated ? ' · fictional capacity' : ' · secondary source, not hospital-verified'}</Text>
                </View>
              ) : null}
              <View style={styles.availability}>
                <Text style={styles.availabilityTitle}>{availability ? simulated ? 'Simulated availability · DEMO' : 'Facility-reported availability' : 'Live availability unknown'}</Text>
                <Text style={styles.muted}>
                  {isHospital ? availability
                    ? `Free beds: ${availability.freeBeds ?? '—'}   Free ICU beds: ${availability.freeIcuBeds ?? '—'}\nER wait: ${availability.erWaitMinutes == null ? '—' : `${availability.erWaitMinutes} min`}   Status: ${availability.open == null ? 'Unconfirmed' : availability.open ? 'Open' : 'Closed'}`
                    : 'Free beds: —   Free ICU beds: —\nER wait: —   Operating status: unconfirmed'
                    : availability ? `Preparation: ${availability.waitMinutes ?? '—'} min   Status: ${availability.open == null ? 'Unconfirmed' : availability.open ? 'Open' : 'Closed'}`
                      : 'Medicine stock: —\nOperating status: unconfirmed'}
                </Text>
                {!isHospital && availability ? catalogue.map((item) => (
                  <Text key={item.id} style={styles.muted}>{item.name}: {availability.stock?.[item.id] ?? '—'} {item.unit}</Text>
                )) : null}
                <Text style={styles.muted}>{availability ? simulated ? 'Fictional demo snapshot · not a real facility update' : 'Facility-reported snapshot · confirm freshness before assignment' : 'Last live update: none received'}</Text>
                {facility.statusReceivedAt ? <Text style={styles.muted}>Database received: {new Date(facility.statusReceivedAt).toLocaleString()}</Text> : null}
                {facility.localUpdate ? <Text style={styles.muted}>Local demo update: {new Date(facility.localUpdate.savedAt).toLocaleString()} · {facility.localUpdate.pending ? 'cloud sync pending' : 'saved copy'}</Text> : null}
                {facility.availableServices?.length ? <Text style={styles.muted}>{simulated ? 'Simulated available services' : 'Reported available services'}: {facility.availableServices.join(', ')}</Text> : null}
              </View>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
                style={styles.detailsButton} onPress={() => setExpanded(open ? null : facility.id)}>
                <Text style={styles.link}>{open ? 'Hide public details' : 'Public details and sources'}</Text>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color="#c5a3ff" />
              </Pressable>
              {open ? (
                <View style={styles.details}>
                  <Text style={styles.body}>{facility.hours}</Text>
                  <Text style={styles.muted}>Published services and hours may change. These are not live operating confirmations.</Text>
                  {isHospital ? (
                    <>
                      <Text style={styles.muted}>Site figures may use different dates and definitions from the SHN network total. Do not add or reconcile them as a current capacity count. Historical ER measures have not been imported.</Text>
                      {facility.capacity.source ? <Link href={facility.capacity.source} style={styles.source}>Publicly listed bed count · Wikipedia ↗</Link> : null}
                      <Link href={hospitalCapacity.definitionSource} style={styles.source}>CIHI bed reporting definitions ↗</Link>
                    </>
                  ) : null}
                  <Text style={styles.muted}>Reference checked: {facility.sourceVerifiedOn || verifiedOn}</Text>
                  {facility.sourceUpdated ? <Text style={styles.muted}>Directory record updated: {facility.sourceUpdated}</Text> : null}
                  {facility.sources.map((source) => (
                    <Link key={source.url} href={source.url} style={styles.source}>{source.title} ↗</Link>
                  ))}
                  <Link href={mapUrl} style={styles.source}>Directions from Sam Ibrahim Building ↗</Link>
                  <Text style={styles.muted}>Source pages and directions require internet.</Text>
                </View>
              ) : null}
            </View>
          );
        })}
        <Link href={referenceLocation.source} style={styles.source}>UTSC reference location source ↗</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
