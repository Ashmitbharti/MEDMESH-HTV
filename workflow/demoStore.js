import AsyncStorage from '@react-native-async-storage/async-storage';
import { hospitals, pharmacies } from '../command-center/facilities';

const KEY = 'medmesh-workflow-demo-v1';
let writing = Promise.resolve();
export async function demoMode() {
  const a = JSON.parse(await AsyncStorage.getItem('medmesh-auth') || 'null');
  return a?.mode === 'demo';
}

function initial() {
  return {
    emergencies: [], supplies: [],
    hospitals: Object.fromEntries(hospitals.map((h) => [h.hosid, { ...h.demoAvailability, services: h.services }])),
    pharmacies: Object.fromEntries(pharmacies.map((p) => [p.id, { stock: { ...p.demoStock }, open: true, waitMinutes: 15, services: p.services }])),
  };
}

export async function readDemo() {
  await writing;
  return JSON.parse(await AsyncStorage.getItem(KEY) || 'null') || initial();
}

export function changeDemo(change) {
  const result = writing.then(async () => {
    const state = JSON.parse(await AsyncStorage.getItem(KEY) || 'null') || initial();
    const out = change(state);
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
    return out;
  });
  writing = result.catch(() => {});
  return result;
}

export function demoSubmit(payload) {
  return changeDemo((s) => {
    const old = s.emergencies.find((r) => r.id === payload.id);
    if (old) return old;
    const r = { id: payload.id, payload, status: 'received', operation_version: 1, created_at: new Date().toISOString(), demo: true };
    s.emergencies.unshift(r);
    return r;
  });
}

export function demoEmergency(request, action, details) {
  return changeDemo((s) => {
    const r = s.emergencies.find((x) => x.id === request.id);
    if (!r || r.operation_version !== request.operation_version) throw new Error('This request changed. Refresh and try again.');
    if (['closed', 'cancelled'].includes(r.status)) throw new Error('This request is already closed.');
    const at = new Date().toISOString();
    if (action === 'dispatch') {
      if (r.ambulance_id || !['AMB-01', 'AMB-02'].includes(details.ambulance_id)) throw new Error('Choose an available ambulance.');
      if (s.emergencies.some((x) => x.ambulance_id === details.ambulance_id && !['closed', 'cancelled'].includes(x.status))) throw new Error('That ambulance is already assigned.');
      Object.assign(r, { status: 'dispatched', ambulance_id: details.ambulance_id, ambulance_dispatched_at: at });
    } else if (action === 'assign') {
      const h = s.hospitals[details.hospital_id];
      const icu = details.bed_type === 'icu';
      if (!r.ambulance_id || r.hospital_id || !['general', 'icu'].includes(details.bed_type) || !h?.open || (icu ? h.freeIcuBeds : h.freeBeds - h.freeIcuBeds) < 1) throw new Error('Choose an open hospital with an available bed.');
      h.freeBeds--;
      if (icu) h.freeIcuBeds--;
      Object.assign(r, { status: 'assigned', hospital_id: details.hospital_id, bed_type: details.bed_type, bed_reserved: true, hospital_assigned_at: at });
    } else if (action === 'receive') {
      if (r.status !== 'assigned' || details.hospital_id !== r.hospital_id) throw new Error('This patient is not assigned to this hospital.');
      Object.assign(r, { status: 'closed', patient_received_at: at, closed_at: at, bed_reserved: false });
    } else if (action === 'cancel') {
      if (r.bed_reserved) {
        const h = s.hospitals[r.hospital_id];
        h.freeBeds++;
        if (r.bed_type === 'icu') h.freeIcuBeds++;
      }
      Object.assign(r, { status: 'cancelled', closed_at: at, bed_reserved: false });
    } else throw new Error('Unknown emergency action.');
    r.operation_version++;
    return r;
  });
}

export function demoSupply(request, action, pharmacyId) {
  return changeDemo((s) => {
    if (action === 'create') {
      const existing = s.supplies.find((x) => x.id === request.id);
      if (existing) return existing;
      const saved = { ...request, pending: false, demo: true };
      s.supplies.unshift(saved);
      return saved;
    }
    const r = s.supplies.find((x) => x.id === request.id);
    if (!r || r.assignment_version !== request.assignment_version) throw new Error('Assignment changed. Refresh the request.');
    if (action === 'assign') {
      if (!['awaiting_assignment', 'assigned', 'declined'].includes(r.status)) throw new Error('This request cannot be reassigned.');
      const p = s.pharmacies[pharmacyId];
      if (!p?.open || Object.entries(r.items).some(([k, n]) => (p.stock[k] || 0) < n)) throw new Error('Pharmacy cannot fulfil these quantities.');
      Object.assign(r, { pharmacy_id: pharmacyId, status: 'assigned', assigned_at: new Date().toISOString(), assignment_version: r.assignment_version + 1 });
    } else {
      if (r.status !== 'assigned' || r.pharmacy_id !== request.pharmacy_id) throw new Error('This request is no longer awaiting this pharmacy.');
      if (action === 'accepted') {
        const p = s.pharmacies[r.pharmacy_id];
        if (!p?.open || Object.entries(r.items).some(([k, n]) => (p.stock[k] || 0) < n)) throw new Error('Not enough stock to approve this order.');
        Object.entries(r.items).forEach(([k, n]) => { p.stock[k] -= n; });
        Object.assign(r, { status: 'closed', closed_at: new Date().toISOString(), fulfilment: 'approved_to_hospital' });
      } else if (action === 'declined') r.status = 'declined';
      else throw new Error('Unknown supply response.');
    }
    return r;
  });
}
