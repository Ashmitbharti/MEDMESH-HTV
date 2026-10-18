import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { citizenEmergencies } from '../emergency/cloudService';
import { cloudCaseId, retryCloudSos } from '../cloud/cloudSync';

export function useEmergencyUpdates(ids) {
  const key = ids.filter(Boolean).sort().join(',');
  const [records, setRecords] = useState([]);
  const [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    let alive = true;
    let busy = false;
    setRecords([]);
    async function refresh() {
      if (!key || busy || AppState.currentState === 'background') return;
      busy = true;
      try {
        await retryCloudSos();
        const rows = await citizenEmergencies(key.split(',').map(cloudCaseId));
        if (alive) { setRecords(rows); setError(''); }
      } catch { if (alive) setError('Cloud updates unavailable. Radio messages still appear below.'); }
      finally { busy = false; }
    }
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [key]));
  return { records, error };
}

export function cloudStatus(row) {
  const phase = row.status === 'closed' ? 'arrived' : row.status === 'cancelled' ? 'cancelled'
    : row.ambulance_id ? 'coming' : 'received';
  const events = [
    [row.created_at, 'Command Center received your SOS'],
    [row.ambulance_dispatched_at, `${row.ambulance_id} dispatched by Command Center (demo)`],
    [row.hospital_assigned_at, 'Receiving hospital notified; bed reserved'],
    [row.patient_received_at, 'Hospital confirmed arrival; request closed'],
    [row.status === 'cancelled' && row.closed_at, 'Request cancelled'],
  ];
  return { phase, hospId: row.hospital_id, amb: null, etaAt: null, contact: null, timeline: events.filter(([at]) => at).map(([at, text]) => ({ at: Date.parse(at), text })) };
}
