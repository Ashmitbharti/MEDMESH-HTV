"""Mesh bridges: a real one (Meshtastic board over USB) and a simulator.

Both expose the same interface so the rest of the base station doesn't care which is running:
    bridge.start(on_text)          on_text(text, from_id, from_name, hops, path)
    bridge.send(text, dest_id)     dest_id = node id string, or None for broadcast
    bridge.nodes()                 -> list of {id, name, online, last_heard, snr, hops}
"""
import threading, time
import networkx as nx

ONLINE_SECS = 15 * 60  # real mesh: a node counts as online if heard in the last 15 min


class SerialBridge:
    """Talks to the BASE board plugged in over USB using the official Meshtastic Python library."""

    def __init__(self, port=None):
        self.port = port
        self.iface = None
        self.my_id = None
        self.on_position = None  # set by server: live ambulance GPS -> traffic learning

    def start(self, on_text):
        import meshtastic.serial_interface
        from pubsub import pub

        def on_receive(packet, interface):
            d = packet.get("decoded", {})
            text = d.get("text")
            if not text:
                return
            frm = packet.get("fromId") or f"!{packet.get('from', 0):08x}"
            hops = None
            if "hopStart" in packet and "hopLimit" in packet:
                hops = packet["hopStart"] - packet["hopLimit"]
            on_text(text, frm, self._name(frm), hops, None)

        def on_pos(packet, interface):
            p = packet.get("decoded", {}).get("position", {})
            lat = p.get("latitude") or (p.get("latitudeI", 0) / 1e7 if p.get("latitudeI") else None)
            lon = p.get("longitude") or (p.get("longitudeI", 0) / 1e7 if p.get("longitudeI") else None)
            if lat and lon and self.on_position:
                frm = packet.get("fromId") or f"!{packet.get('from', 0):08x}"
                self.on_position(frm, self._name(frm), lat, lon, p.get("time") or None)

        pub.subscribe(on_receive, "meshtastic.receive.text")
        pub.subscribe(on_pos, "meshtastic.receive.position")
        self.iface = meshtastic.serial_interface.SerialInterface(self.port)
        info = self.iface.getMyNodeInfo() or {}
        self.my_id = (info.get("user") or {}).get("id")

    def _name(self, node_id):
        n = (self.iface.nodes or {}).get(node_id, {}) if self.iface else {}
        u = n.get("user", {})
        return u.get("shortName") or u.get("longName") or node_id

    def send(self, text, dest_id=None):
        self.iface.sendText(text, destinationId=dest_id or "^all", wantAck=bool(dest_id))

    def nodes(self):
        out, now = [], time.time()
        for nid, n in (self.iface.nodes or {}).items() if self.iface else []:
            u = n.get("user", {})
            last = n.get("lastHeard") or 0
            me = nid == self.my_id
            out.append({"id": nid, "name": u.get("longName") or u.get("shortName") or nid,
                        "short": u.get("shortName") or "", "online": me or (now - last) < ONLINE_SECS,
                        "last_heard": now if me else last, "snr": n.get("snr"), "hops": n.get("hopsAway"),
                        "me": me})
        return out


class SimBridge:
    """Simulated 4-node mesh for testing without hardware (and as a demo fallback).
    Radio links: FIELD-RELAY, RELAY-BASE, FIELD-RESP, RESP-BASE  (two paths, so the mesh can self-heal).
    Phones in 'Simulator' mode talk to these virtual nodes through the base server."""

    LINKS = [("FIELD", "RELAY"), ("RELAY", "BASE"), ("FIELD", "RESP"), ("RESP", "BASE")]

    def __init__(self):
        self.online = {n: True for n in ("FIELD", "RELAY", "RESP", "BASE")}
        self.my_id = "BASE"
        self.outbox = []  # messages delivered to virtual nodes: (node, text, ts)
        self.on_text = None
        self.lock = threading.Lock()

    def start(self, on_text):
        self.on_text = on_text

    def path(self, a, b):
        G = nx.Graph()
        G.add_nodes_from([n for n, up in self.online.items() if up])
        G.add_edges_from([(u, v) for u, v in self.LINKS if self.online[u] and self.online[v]])
        try:
            return nx.shortest_path(G, a, b)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return None

    def ensure(self, node):
        """Extra virtual nodes (e.g. HOSP, PHARM phones in the simulator) join with a direct link to BASE."""
        if node and node not in self.online:
            self.online[node] = True
            self.LINKS = self.LINKS + [(node, "BASE")]

    def inject(self, from_node, text):
        """A virtual phone sends `text` through `from_node`. Returns the path or None if undeliverable."""
        self.ensure(from_node)
        if from_node == "BASE":
            p = ["BASE"]
        else:
            p = self.path(from_node, "BASE")
        if not p:
            return None
        threading.Timer(0.6 * max(1, len(p) - 1), lambda: self.on_text(text, from_node, from_node, len(p) - 2, p)).start()
        return p

    def send(self, text, dest_id=None):
        targets = [dest_id] if dest_id else [n for n in self.online if n != "BASE"]
        for t in targets:
            p = self.path("BASE", t)
            with self.lock:
                self.outbox.append({"node": t, "text": text, "ts": time.time(), "path": p, "delivered": bool(p)})
                self.outbox = self.outbox[-300:]

    def nodes(self):
        now = time.time()
        return [{"id": n, "name": n, "short": n[:4], "online": up, "last_heard": now if up else now - 999,
                 "snr": 6.5 if up else None, "hops": (len(self.path(n, "BASE")) - 2) if up and self.path(n, "BASE") else None,
                 "me": n == "BASE"} for n, up in self.online.items()]
