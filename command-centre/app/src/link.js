// MedMesh link layer: one interface over Bluetooth (phone -> node), USB (laptop -> node) and Simulator (via base server).
import { MeshDevice } from "@meshtastic/core";
import { TransportWebBluetooth } from "@meshtastic/transport-web-bluetooth";
import { TransportWebSerial } from "@meshtastic/transport-web-serial";

export class Link {
  constructor() {
    this.kind = null; this.device = null; this.status = "disconnected"; this.nodeName = ""; this.baseNum = null;
    this.nodes = new Map(); this.myNum = null; this.listeners = { message: [], status: [] }; this.simTimer = null;
  }
  on(ev, fn) { this.listeners[ev].push(fn); }
  emit(ev, ...a) { this.listeners[ev].forEach((f) => { try { f(...a); } catch (e) { console.error(e); } }); }
  setStatus(s) { this.status = s; this.emit("status", s); }

  static support() {
    return { ble: !!navigator.bluetooth, usb: !!navigator.serial, secure: window.isSecureContext };
  }

  // ---------------- real node (Bluetooth or USB) via official Meshtastic JS library
  async connectDevice(kind, baseHint = "BASE") {
    this.kind = kind; this.baseHint = baseHint.toUpperCase(); this.setStatus("connecting");
    const transport = kind === "ble" ? await TransportWebBluetooth.create() : await TransportWebSerial.create();
    const dev = new MeshDevice(transport); this.device = dev;
    dev.events.onDeviceStatus.subscribe((s) => {
      if (s === 7) this.setStatus("connected");          // DeviceConfigured
      else if (s === 2) this.setStatus("disconnected");   // DeviceDisconnected
      else if (s === 4) this.setStatus("reconnecting");
    });
    dev.events.onMyNodeInfo.subscribe((i) => { this.myNum = i.myNodeNum; });
    dev.events.onNodeInfoPacket.subscribe((n) => {
      const u = n.user || {};
      this.nodes.set(n.num, { num: n.num, long: u.longName || "", short: u.shortName || "", lastHeard: n.lastHeard });
      if (n.num === this.myNum) this.nodeName = u.longName || u.shortName || "my node";
      if (n.num !== this.myNum && ((u.longName || "").toUpperCase().includes(this.baseHint) || (u.shortName || "").toUpperCase() === this.baseHint.slice(0, 4)))
        this.baseNum = n.num;
    });
    dev.events.onMessagePacket.subscribe((p) => { if (p.from !== this.myNum) this.emit("message", p.data, { from: p.from, type: p.type }); });
    await dev.configure();
    this.setStatus("connected");
  }

  // ---------------- simulator: virtual node on the base server
  async connectSim(baseUrl, node) {
    this.kind = "sim"; this.base = baseUrl.replace(/\/$/, ""); this.nodeName = node; this.since = Date.now() / 1000;
    this.setStatus("connecting");
    const r = await fetch(this.base + "/api/state"); if (!r.ok) throw new Error("Base server not reachable");
    this.setStatus("connected");
    clearInterval(this.simTimer);
    this.simTimer = setInterval(async () => {
      try {
        const msgs = await (await fetch(`${this.base}/api/sim/inbox/${node}?since=${this.since}`)).json();
        msgs.forEach((m) => { this.since = Math.max(this.since, m.ts); this.emit("message", m.text, { from: "BASE" }); });
      } catch (e) { /* base unreachable: keep trying */ }
    }, 1000);
  }

  // send a MedMesh message; resolves {mesh:true} when the mesh ACKs (real node) or the sim accepts it
  async send(text) {
    if (this.status !== "connected") throw new Error("Not connected to a MedMesh node");
    if (new TextEncoder().encode(text).length > 200) throw new Error("Message too long for LoRa");
    if (this.kind === "sim") {
      const r = await (await fetch(this.base + "/api/sim/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ node: this.nodeName, text }) })).json();
      if (!r.ok) throw new Error("No route to the command centre (nodes down)");
      return { mesh: true, path: r.path };
    }
    // direct to the BASE node when we know it (gives a real delivery ACK); otherwise broadcast on the channel
    const dest = this.baseNum ?? "broadcast";
    await this.device.sendText(text, dest, true, 0);
    return { mesh: true, direct: dest !== "broadcast" };
  }

  async disconnect() {
    clearInterval(this.simTimer);
    try { if (this.device) await this.device.disconnect(); } catch (e) {}
    this.device = null; this.setStatus("disconnected");
  }
}
