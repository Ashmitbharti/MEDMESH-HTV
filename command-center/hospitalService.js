import { getSupabase } from '../lib/supabase';

export async function loadHospitals() {
  const { data, error } = await getSupabase()
    .from('hospitals')
    .select('*, hospital_status(*)')
    .order('hosid');
  if (error) throw new Error('Hospital database is unavailable. Showing saved demo details.');
  if (!data?.length) throw new Error('Hospital database has no records. Showing saved demo details.');

  return data.map((hospital) => {
    const statuses = hospital.hospital_status || [];
    const status = statuses.find((item) => !item.is_simulated) || statuses.find((item) => item.is_simulated);
    return {
      id: hospital.slug,
      hosid: hospital.hosid,
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
  });
}
