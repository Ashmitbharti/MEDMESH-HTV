/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const storage = new Map();
const cache = new Map();
function load(file) {
  file = path.resolve(__dirname, file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = babel.transformSync(fs.readFileSync(file, 'utf8'), { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === '@react-native-async-storage/async-storage') return { getItem: async k => storage.get(k) || null, setItem: async (k,v) => storage.set(k,v) };
    return load(path.relative(__dirname, path.resolve(path.dirname(file), id + '.js')));
  }, module, module.exports);
  return module.exports;
}
(async () => {
  const d = load('./demoStore.js');
  const initial = await d.readDemo();
  const hospital = Object.keys(initial.hospitals)[0];
  const pharmacy = Object.keys(initial.pharmacies)[0];
  const item = Object.keys(initial.pharmacies[pharmacy].stock)[0];
  const a = await d.demoSubmit({ id: 'case-a' });
  const b = await d.demoSubmit({ id: 'case-b' });
  const races = await Promise.allSettled([a,b].map(r => d.demoEmergency(r,'dispatch',{ambulance_id:'AMB-01'})));
  assert.equal(races.filter(r=>r.status==='fulfilled').length,1,'ambulance cannot be double-booked');
  const dispatched = races.find(r=>r.status==='fulfilled').value;
  await assert.rejects(d.demoEmergency(a,'assign',{hospital_id:hospital,bed_type:'general'}),/changed/,'stale action rejected');
  const assigned = await d.demoEmergency(dispatched,'assign',{hospital_id:hospital,bed_type:'general'});
  assert.equal((await d.readDemo()).hospitals[hospital].freeBeds, initial.hospitals[hospital].freeBeds-1);
  await assert.rejects(d.demoEmergency(assigned,'receive',{hospital_id:'wrong'}));
  const closed = await d.demoEmergency(assigned,'receive',{hospital_id:hospital});
  assert.equal(closed.status,'closed');
  assert.equal((await d.readDemo()).hospitals[hospital].freeBeds,initial.hospitals[hospital].freeBeds-1,'arrived patient still occupies bed');
  const order = await d.demoSupply({id:'order-a',hospital_id:hospital,items:{[item]:1},status:'awaiting_assignment',assignment_version:0},'create');
  const asked = await d.demoSupply(order,'assign',pharmacy);
  const declined = await d.demoSupply(asked,'declined');
  assert.equal(declined.status,'declined');
  assert.equal((await d.readDemo()).pharmacies[pharmacy].stock[item],initial.pharmacies[pharmacy].stock[item]);
  const reassigned = await d.demoSupply(declined,'assign',pharmacy);
  const approved = await d.demoSupply(reassigned,'accepted');
  assert.equal(approved.status,'closed');
  assert.equal(approved.hospital_id,hospital);
  assert.equal((await d.readDemo()).pharmacies[pharmacy].stock[item],initial.pharmacies[pharmacy].stock[item]-1);
  await assert.rejects(d.demoSupply(reassigned,'accepted'));
  assert.equal((await d.readDemo()).pharmacies[pharmacy].stock[item],initial.pharmacies[pharmacy].stock[item]-1,'retry cannot double-decrement stock');
  console.log('PASS: dispatch conflict, stale actions, bed reservation, hospital arrival, decline/reassignment, approval/closure, stock retry protection');
})().catch(e=>{console.error(e);process.exitCode=1});
