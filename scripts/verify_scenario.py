
from pathlib import Path
import osmnx as ox

ROOT = Path(__file__).resolve().parent.parent
GRAPH_FILE = ROOT / "public/data/bike_network.graphml"

ELWOOD = 65397693
MIDDLE = 8974503441
DUANE = 65465515

G = ox.load_graphml(GRAPH_FILE)

print(f"Loaded {len(G.nodes)} nodes, {len(G.edges)} edges")

corridor = [
    (ELWOOD, MIDDLE),
    (MIDDLE, DUANE),
]

total = 0

for u, v in corridor:
    if not G.has_edge(u, v):
        raise RuntimeError(f"Missing corridor edge: {u} -> {v}")

    edges = [
        data for data in G[u][v].values()
        if "James Avenue" in str(data.get("name", ""))
    ]

    if not edges:
        raise RuntimeError(f"Not a James Avenue edge: {u} -> {v}")

    length = min(float(e["length"]) for e in edges)
    total += length

    print(f"Verified: {u} -> {v}, {length:.1f} m")

print(f"Total corridor length: {total:.1f} m")

# Check that reverse-direction edges exist too.
for u, v in corridor:
    print(f"Reverse edge {v} -> {u}: {G.has_edge(v, u)}")

print("Corridor verification complete.")
