
from pathlib import Path
import osmnx as ox

ROOT = Path(__file__).resolve().parent.parent
G = ox.load_graphml(
    ROOT / "public/data/bike_network.graphml"
)

SCHOOL_NODE = 5432482107

print("School node:", SCHOOL_NODE)
print("Coordinates:", G.nodes[SCHOOL_NODE]["y"],
      G.nodes[SCHOOL_NODE]["x"])

print("\nIncoming streets:")
for u, v, key, data in G.in_edges(
        SCHOOL_NODE, keys=True, data=True
):
    print({
        "name": data.get("name"),
        "highway": data.get("highway"),
        "cycleway": data.get("cycleway"),
        "length": round(float(data.get("length", 0)), 1),
    })

print("\nOutgoing streets:")
for u, v, key, data in G.out_edges(
        SCHOOL_NODE, keys=True, data=True
):
    print({
        "name": data.get("name"),
        "highway": data.get("highway"),
        "cycleway": data.get("cycleway"),
        "length": round(float(data.get("length", 0)), 1),
    })
