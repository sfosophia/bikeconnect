
import osmnx as ox

SCHOOL_LAT = 37.48081
SCHOOL_LON = -122.23500

print("Loading bicycle network...")

G = ox.graph_from_point(
    (SCHOOL_LAT, SCHOOL_LON),
    dist=1200,
    network_type="bike",
)

# Identify nodes where James Avenue connects
# to Elwood Street or Duane Street.
targets = {"Elwood Street", "Duane Street"}

def street_names(value):
    if isinstance(value, list):
        return {str(v) for v in value}
    if value is None:
        return set()
    return {str(value)}

matches = []

for node in G.nodes:
    names = set()

    for _, _, data in G.out_edges(node, data=True):
        names.update(street_names(data.get("name")))

    for _, _, data in G.in_edges(node, data=True):
        names.update(street_names(data.get("name")))

    if "James Avenue" in names:
        for target in targets:
            if target in names:
                matches.append((target, node))

print("\nJames Avenue intersections:")

for street, node in sorted(matches):
    print(
        f"{street}: "
        f"node={node}, "
        f"lat={G.nodes[node]['y']:.7f}, "
        f"lon={G.nodes[node]['x']:.7f}"
    )

if not matches:
    print("No matching intersections found.")
