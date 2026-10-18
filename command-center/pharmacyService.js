import { demoMode, readDemo } from '../workflow/demoStore';
import { getSupabase } from '../lib/supabase';
import { pharmacies } from './facilities';
import { readPharmacyUpdates } from '../pharmacy/pharmacyStore';

export async function loadPharmacies() {
  if (await demoMode()) {
    const state = await readDemo();
    return pharmacies.map((p) => ({ ...p, pharmacyAvailability: state.pharmacies[p.id], demoStock: state.pharmacies[p.id].stock, availabilityIsSimulated: true, loadedFromDemo: true }));
  }
  const local = await readPharmacyUpdates();
  let cloud = true;
  let records;
  try {
    const { data, error } = await getSupabase().from('pharmacies').select('*, pharmacy_status(*)').order('entry_code');
    if (error || !data?.length) throw new Error('No pharmacy data');
    records = data.map((pharmacy) => {
      const status = pharmacy.pharmacy_status.find((item) => !item.is_simulated)
        || pharmacy.pharmacy_status.find((item) => item.is_simulated);
      return {
        id: pharmacy.id,
        pharmacyCode: pharmacy.entry_code,
        name: pharmacy.name,
        organization: pharmacy.area,
        address: pharmacy.address,
        phone: pharmacy.phone,
        services: pharmacy.services,
        hours: pharmacy.published_hours,
        sources: pharmacy.sources,
        sourceVerifiedOn: pharmacy.verified_on,
        sourceUpdated: pharmacy.source_updated,
        demoStock: status?.stock || null,
        pharmacyAvailability: status ? {
          stock: status.stock,
          open: status.is_open,
          waitMinutes: status.wait_minutes,
          services: status.available_services,
        } : null,
        availabilityIsSimulated: status?.is_simulated ?? true,
        statusReceivedAt: status?.received_at,
        availableServices: status?.available_services || [],
      };
    });
  } catch {
    cloud = false;
    records = pharmacies.map((pharmacy) => ({
      ...pharmacy,
      pharmacyAvailability: { stock: pharmacy.demoStock, open: true, waitMinutes: 15, services: pharmacy.services },
      availabilityIsSimulated: true,
    }));
  }
  return records.map((pharmacy) => {
    const update = local[pharmacy.id];
    if (!update || cloud && !update.pending) return { ...pharmacy, loadedFromCloud: cloud };
    return {
      ...pharmacy,
      loadedFromCloud: cloud,
      pharmacyAvailability: update,
      demoStock: update.stock,
      availabilityIsSimulated: true,
      availableServices: update.services,
      statusReceivedAt: update.pending ? null : update.receivedAt,
      localUpdate: update,
    };
  });
}
