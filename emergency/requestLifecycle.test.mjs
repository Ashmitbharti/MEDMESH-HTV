import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { addConditionUpdate, applyReceipt, attachCoordinates, cancelRequest, reviseRequest, updateLandmark } from './requestLifecycle.js';

const initial = () => ({ id: 'demo', revision: 1, phase: 'ready', deliveryStatus: 'not_sent', answers: {}, deliveryEvents: [] });
const receipt = (stage, revision = 1) => ({ requestId: 'demo', revision, stage, source: stage === 'node_received' ? 'node' : 'command_centre' });

test('only matching acknowledgments advance delivery, with no backwards transitions', () => {
  const request = initial();
  for (const invalid of [null, {}, receipt('unknown'), receipt('command_received', 2), { ...receipt('command_received'), source: 'node' }, { ...receipt('command_received'), requestId: 'other' }]) {
    assert.equal(applyReceipt(request, invalid), request);
  }
  const dispatched = applyReceipt(request, receipt('responder_dispatched'));
  assert.equal(dispatched.deliveryStatus, 'responder_dispatched');
  assert.equal(applyReceipt(dispatched, receipt('node_received')).deliveryStatus, 'responder_dispatched');
  assert.equal(applyReceipt(dispatched, receipt('responder_dispatched')), dispatched);
});

test('new condition details require a newer acknowledgment', () => {
  const received = applyReceipt(initial(), receipt('command_received'));
  const updated = reviseRequest(received, addConditionUpdate(received, 'Moved to entrance', 1000));
  assert.equal(updated.revision, 2);
  assert.equal(updated.commandRevision, 1);
  assert.equal(updated.conditionUpdates[0].text, 'Moved to entrance');
  assert.equal(applyReceipt(updated, receipt('command_received', 2)).commandRevision, 2);
});

test('cancellation requires a command acknowledgment at its own revision', () => {
  const request = initial();
  const cancelled = reviseRequest(request, cancelRequest(request, 1000));
  assert.equal(applyReceipt(cancelled, receipt('cancellation_received')), cancelled);
  const confirmed = applyReceipt(cancelled, receipt('cancellation_received', 2));
  assert.ok(confirmed.cancellationConfirmedAt);
  assert.equal(applyReceipt(confirmed, receipt('cancellation_received', 2)), confirmed);
  assert.throws(() => addConditionUpdate(cancelled, 'Change'));
});

test('manual location replaces stale coordinates and invalid fixes are rejected', () => {
  const request = attachCoordinates(initial(), { latitude: 43.6, longitude: -79.4 });
  const updated = updateLandmark(request, '  North entrance  ');
  assert.equal(updated.coordinates, null);
  assert.equal(updated.answers.location, 'North entrance');
  assert.throws(() => attachCoordinates(request, { latitude: 91, longitude: 0 }));
  assert.throws(() => updateLandmark(request, ' '));
});

test('offline storage, self/bystander identity, reload and archived cancellation', async () => {
  const memory = new Map();
  globalThis.medmeshTestStorage = {
    getItem: async (key) => memory.get(key) || null,
    setItem: async (key, value) => memory.set(key, value),
  };
  let source = await readFile(new URL('./requestService.js', import.meta.url), 'utf8');
  source = source.replace("import AsyncStorage from '@react-native-async-storage/async-storage';", 'const AsyncStorage = globalThis.medmeshTestStorage;')
    .replace("import { loadProfile } from '../medmesh-id/profileService';", "const loadProfile = async () => ({ medmeshId: 'ABCDEF' });")
    .replace("'./questions'", JSON.stringify(new URL('./questions.js', import.meta.url).href))
    .replace("'./requestLifecycle'", JSON.stringify(new URL('./requestLifecycle.js', import.meta.url).href));
  const service = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const self = await service.createRequest('self');
  assert.equal(self.medmeshId, 'ABCDEF');
  assert.equal((await service.loadRequest()).id, self.id);
  await assert.rejects(service.retryDelivery(self.id), /No mesh node/);
  const cancelled = await service.updateRequest(self.id, cancelRequest);
  const other = await service.createRequest('other');
  assert.equal(other.medmeshId, null);
  assert.equal((await service.loadRequestHistory())[0].id, cancelled.id);
  assert.equal(await service.receiveReceipt(null), null);
  service.setMeshTransport({ send: async (packet) => ({ requestId: packet.requestId, revision: packet.revision, stage: 'cancellation_received', source: 'command_centre' }) });
  assert.ok((await service.retryDelivery(cancelled.id)).cancellationConfirmedAt);
  assert.equal((await service.loadRequest()).id, other.id);
  delete globalThis.medmeshTestStorage;
});

test('location permission denial, disabled services and GPS timeout support fallback', async () => {
  const provider = {
    Accuracy: { Balanced: 3 },
    requestForegroundPermissionsAsync: async () => ({ granted: false }),
    hasServicesEnabledAsync: async () => false,
    getCurrentPositionAsync: async () => new Promise(() => {}),
  };
  globalThis.medmeshTestLocation = provider;
  const source = (await readFile(new URL('./locationService.js', import.meta.url), 'utf8'))
    .replace("import * as Location from 'expo-location';", 'const Location = globalThis.medmeshTestLocation;')
    .replace('15000', '10');
  const { captureLocation } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  await assert.rejects(captureLocation(), /not allowed/);
  provider.requestForegroundPermissionsAsync = async () => ({ granted: true });
  await assert.rejects(captureLocation(), /services are off/);
  provider.hasServicesEnabledAsync = async () => true;
  await assert.rejects(captureLocation(), /too long/);
  provider.getCurrentPositionAsync = async () => ({ coords: { latitude: 43, longitude: -79, accuracy: 20 }, timestamp: 1000 });
  assert.equal((await captureLocation()).accuracy, 20);
  delete globalThis.medmeshTestLocation;
});
