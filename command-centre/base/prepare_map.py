"""Download the REAL map for the demo area once (needs internet). Afterwards MedMesh routes
and draws the street map fully offline.

    pip install osmnx
    python prepare_map.py                          # default: Scarborough around UTSC, 6 km radius
    python prepare_map.py 43.7840 -79.1870 5000    # lat lon radius_m
    python prepare_map.py --no-buildings           # smaller file

Writes base/map.json (roads with real curves, road types, speed limits, water, parks, buildings).
Restart server.py to use it. Delete map.json to go back to the built-in simplified grid.
Map data (c) OpenStreetMap contributors, ODbL.
"""
import json, os, sys
import osmnx as ox

args = [a for a in sys.argv[1:] if not a.startswith("--")]
lat, lon, dist = (float(args[0]), float(args[1]), int(args[2])) if len(args) >= 3 else (43.7800, -79.2300, 6000)
want_buildings = "--no-buildings" not in sys.argv

CLASS = {"motorway": "motorway", "motorway_link": "motorway", "trunk": "trunk", "trunk_link": "trunk",
         "primary": "primary", "primary_link": "primary", "secondary": "secondary", "secondary_link": "secondary",
         "tertiary": "tertiary", "tertiary_link": "tertiary", "residential": "residential", "living_street": "residential",
         "unclassified": "residential"}

print(f"1/3 Downloading drivable roads within {dist} m of {lat},{lon} ...")
G = ox.graph_from_point((lat, lon), dist=dist, network_type="drive", simplify=True)
G = ox.add_edge_speeds(G)          # fills missing speed limits from road type
G = ox.add_edge_travel_times(G)
U = ox.convert.to_undirected(G) if hasattr(ox, "convert") else G.to_undirected()

nodes = [{"id": int(n), "lat": round(d["y"], 6), "lon": round(d["x"], 6)} for n, d in U.nodes(data=True)]
edges, seen = [], set()
for u, v, d in U.edges(data=True):
    key = (min(u, v), max(u, v))
    if key in seen:
        continue
    seen.add(key)
    name = d.get("name") or d.get("ref") or "unnamed road"
    if isinstance(name, list): name = name[0]
    hw = d.get("highway", "residential")
    if isinstance(hw, list): hw = hw[0]
    if "geometry" in d:
        geom = [[round(y, 6), round(x, 6)] for x, y in d["geometry"].coords]
    else:
        geom = [[U.nodes[u]["y"], U.nodes[u]["x"]], [U.nodes[v]["y"], U.nodes[v]["x"]]]
    # make geometry start at u
    if abs(geom[0][0] - U.nodes[u]["y"]) + abs(geom[0][1] - U.nodes[u]["x"]) > abs(geom[-1][0] - U.nodes[u]["y"]) + abs(geom[-1][1] - U.nodes[u]["x"]):
        geom.reverse()
    edges.append({"u": int(u), "v": int(v), "name": str(name), "cls": CLASS.get(hw, "service" if hw == "service" else "residential"),
                  "length": round(float(d.get("length", 0)), 1), "speed": round(float(d.get("speed_kph", 40)), 1), "geom": geom})


def polys(tags, label, simplify_m=4, limit=None):
    print(f"   {label} ...")
    try:
        gdf = ox.features_from_point((lat, lon), tags=tags, dist=dist)
    except Exception as e:
        print("   skipped:", e); return []
    out = []
    for geom in gdf.geometry:
        if geom is None: continue
        gs = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
        for g in gs:
            if g.geom_type != "Polygon": continue
            g = g.simplify(simplify_m / 111000)
            out.append([[round(y, 6), round(x, 6)] for x, y in g.exterior.coords])
    return out[:limit] if limit else out


print("2/3 Downloading water, parks" + (" and buildings" if want_buildings else "") + " ...")
areas = {"water": polys({"natural": "water", "water": True, "waterway": "riverbank"}, "water"),
         "parks": polys({"leisure": ["park", "nature_reserve", "golf_course"], "landuse": ["grass", "forest", "recreation_ground"]}, "parks"),
         "buildings": polys({"building": True}, "buildings", 2, 40000) if want_buildings else []}

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "map.json")
with open(out, "w") as f:
    json.dump({"source": "osm", "center": [lat, lon], "nodes": nodes, "edges": edges, "areas": areas}, f, separators=(",", ":"))
print(f"3/3 Saved {len(nodes)} intersections, {len(edges)} road segments, {len(areas['buildings'])} buildings "
      f"-> {out} ({os.path.getsize(out) / 1e6:.1f} MB). Restart server.py.")
