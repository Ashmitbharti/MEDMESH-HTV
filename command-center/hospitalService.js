import { getSupabase } from '../lib/supabase';
import { hospitals } from './facilities';
import { readHospitalUpdates } from '../hospital/hospitalStore';

export async function loadHospitals({ includeLocal = true } = {}) {
  const local = await readHospitalUpdates();
  let data;
  let cloud = true;
  try {
    const response = await getSupabase()
      .from('hospitals')
      .select('*, hospital_status(*)')
      .order('hosid');
    if (response.error || !response.data?.length) throw new Error('No hospital data');
    data = response.data;
  } catch {
    cloud = false;
  }

  const records = cloud ? data.map((hospital) => {
    const statuses = hospital.hospital_status || [];
    const status = statuses.find((item) => !item.is_simulated) || statuses.find((item) => item.is_simulated);
    return {
      id: hospital.slug,
      hosid: hospital.hosid,
      hospitalCode: hospital.entry_code || hospitals.find((item) => item.hosid === hospital.hosid)?.hospitalCode,
      name: hospital.name,
      organization: 'Scarborough Health Network',
      address: hospital.address,
      phone: hospital.phone,
      services: hospital.services,
      hours: hospital.published_hours,
      sources: hospital.sources,
      sourceVerifiedOn: hospital.verified_on,
      capacity: {
        beds: hospital.reported_beds,
        simulated: hospital.capacity_is_simulated,
        period: hospital.capacity_period,
        source: hospital.capacity_source_url,
      },
      demoAvailability: status ? {
        freeBeds: status.free_beds,
        freeIcuBeds: status.free_icu_beds,
        erWaitMinutes: status.er_wait_minutes,
        open: status.is_open,
      } : null,
      availabilityIsSimulated: status?.is_simulated ?? true,
      statusReceivedAt: status?.received_at,
      availableServices: status?.available_services || [],
    };
  }) : hospitals;
  return records.map((hospital) => {
    const update = includeLocal ? local[hospital.hosid] : null;
    if (!update || cloud && !update.pending) return { ...hospital, loadedFromCloud: cloud };
    return {
      ...hospital,
      loadedFromCloud: cloud,
      demoAvailability: update,
      availabilityIsSimulated: true,
      availableServices: update.services,
      statusReceivedAt: update.pending ? null : update.receivedAt,
      localUpdate: update,
    };
  });
}
