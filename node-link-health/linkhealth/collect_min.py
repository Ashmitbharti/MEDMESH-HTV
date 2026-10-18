"""
Minimal Meshtastic link logger for MedMesh Model A.

Setup:  pip install meshtastic pypubsub
Run:    python collect_min.py --session baseline_01
        python collect_min.py --session walkout_01 --ping '!a1b2c302' --every 15    (also measure delivery)
        python collect_min.py --session walkout_01 --port COM5     (Windows)
        python collect_min.py --session walkout_01 --port /dev/ttyUSB0

While it runs, type a short note and press Enter to mark an event with a timestamp,
e.g.  "walked board 3 out of range"  or  "unplugged relay"  or  "water on sensor".
Press Ctrl+C to stop.

Outputs (in ./data/raw/):
  {session}.csv         one row per received packet
  {session}_events.csv  your typed notes with timestamps
  {session}_nodes.csv   node table snapshot every 30 s
  {session}_first_packets.json  the first few raw packets, so we can see the real field names
  {session}_acks.csv    only with --ping: one row per test message sent, with whether an ACK came back

NOTE: field names (rxSnr, rxRssi, hopStart, hopLimit, telemetry keys) come from memory and differ by
firmware version. Missing fields are logged as empty, never as zero. Check the *_first_packets.json file.
"""
import argparse, csv, json, os, sys, threading, time
from datetime import datetime, timezone

from pubsub import pub
import meshtastic.serial_interface as msi


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", required=True)
    ap.add_argument("--port", default=None, help="serial port; omit to auto-detect")
    ap.add_argument("--ping", default=None, help="node id (e.g. '!a1b2c302') to send acknowledged test messages to")
    ap.add_argument("--every", type=float, default=15.0, help="seconds between pings (with --ping)")
    a = ap.parse_args()

    os.makedirs("data/raw", exist_ok=True)
    base = f"data/raw/{a.session}"
    cols = ["ts_utc", "from_id", "to_id", "packet_id", "portnum", "rx_snr", "rx_rssi",
            "hop_limit", "hop_start", "hops_used", "battery_level", "voltage",
            "channel_utilization", "air_util_tx", "rx_time"]
    f = open(base + ".csv", "a", newline="")
    w = csv.DictWriter(f, fieldnames=cols)
    if f.tell() == 0:
        w.writeheader()
    ev = open(base + "_events.csv", "a", newline="")
    evw = csv.writer(ev)
    if ev.tell() == 0:
        evw.writerow(["ts_utc", "note"])
    seen = {"n": 0}

    def on_receive(packet, interface):
        try:
            if seen["n"] < 5:
                seen["n"] += 1
                with open(base + "_first_packets.json", "a") as fp:
                    fp.write(json.dumps(packet, default=str) + "\n")
                print("FIELDS:", sorted(packet.keys()))
            dec = packet.get("decoded", {}) or {}
            tel = dec.get("telemetry", {}) or {}
            dm = tel.get("deviceMetrics", {}) or {}
            hl, hs = packet.get("hopLimit"), packet.get("hopStart")
            row = {
                "ts_utc": now(),
                "from_id": packet.get("fromId") or packet.get("from"),
                "to_id": packet.get("toId") or packet.get("to"),
                "packet_id": packet.get("id"),
                "portnum": dec.get("portnum"),
                "rx_snr": packet.get("rxSnr"),
                "rx_rssi": packet.get("rxRssi"),
                "hop_limit": hl, "hop_start": hs,
                "hops_used": (hs - hl) if (hs is not None and hl is not None) else None,
                "battery_level": dm.get("batteryLevel"),
                "voltage": dm.get("voltage"),
                "channel_utilization": dm.get("channelUtilization"),
                "air_util_tx": dm.get("airUtilTx"),
                "rx_time": packet.get("rxTime"),
            }
            w.writerow(row)
            f.flush()
            print(f"{row['ts_utc'][11:23]} from={row['from_id']} {row['portnum']} snr={row['rx_snr']} rssi={row['rx_rssi']} hops={row['hops_used']}")
        except Exception as e:  # never let one odd packet stop the logger
            print("packet parse error:", e, file=sys.stderr)

    pub.subscribe(on_receive, "meshtastic.receive")
    iface = msi.SerialInterface(devPath=a.port) if a.port else msi.SerialInterface()
    print(f"Connected. Logging to {base}.csv   Type a note + Enter to mark an event. Ctrl+C to stop.")

    stop = threading.Event()

    def snapshot_nodes():
        nf = open(base + "_nodes.csv", "a", newline="")
        nw = csv.writer(nf)
        if nf.tell() == 0:
            nw.writerow(["ts_utc", "node_id", "snr", "last_heard"])
        while not stop.is_set():
            try:
                for nid, n in (iface.nodes or {}).items():
                    nw.writerow([now(), nid, n.get("snr"), n.get("lastHeard")])
                nf.flush()
            except Exception as e:
                print("node snapshot error:", e, file=sys.stderr)
            stop.wait(30)

    threading.Thread(target=snapshot_nodes, daemon=True).start()

    if a.ping:
        af = open(base + "_acks.csv", "a", newline="")
        aw = csv.writer(af)
        if af.tell() == 0:
            aw.writerow(["ts_sent_utc", "dest", "seq", "ack", "ts_reply_utc", "detail"])
        pending = {}

        def make_cb(seq):
            def cb(pkt):
                try:
                    routing = (pkt.get("decoded", {}) or {}).get("routing", {}) or {}
                    err = routing.get("errorReason", "NONE")
                    ok = (err == "NONE")
                    aw.writerow([pending.get(seq, ""), a.ping, seq, int(ok), now(), err])
                    af.flush()
                    pending[seq] = None
                except Exception as e:
                    print("ack callback error:", e, file=sys.stderr)
            return cb

        def pinger():
            seq = 0
            while not stop.is_set():
                seq += 1
                pending[seq] = now()
                try:
                    iface.sendText(f"ping {seq}", destinationId=a.ping, wantAck=True, onResponse=make_cb(seq))
                except Exception as e:
                    aw.writerow([pending[seq], a.ping, seq, 0, now(), f"send error: {e}"]); af.flush()
                stop.wait(a.every)

        threading.Thread(target=pinger, daemon=True).start()
        print(f"Pinging {a.ping} every {a.every}s. A ping with no row in the ACK file's reply column was never acknowledged.")

    try:
        while True:
            note = sys.stdin.readline()
            if note == "":
                time.sleep(1)
                continue
            note = note.strip()
            if note:
                evw.writerow([now(), note]); ev.flush()
                print("  [event logged]", note)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        iface.close()
        f.close(); ev.close()
        print("\nStopped. Files are in data/raw/")


if __name__ == "__main__":
    main()
