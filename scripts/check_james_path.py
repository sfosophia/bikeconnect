
import osmnx as ox
import networkx as nx

SCHOOL = (37.48081, -122.23500)
ELWOOD = 65397693
DUANE = 65465515

G = ox.graph_from_point(
    SCHOOL,
    dist=1200,
    network_type="bike",
)

def is_james(name):
    if isinstance(name, list):
        return "James Avenue" in name
    return name == "James Avenue"

# Build a graph containing only James Avenue edges.
J = nx.MultiDiGraph()
J.add_nodes_from(G.nodes(data=True))

for u, v, key, data in G.edges(keys=True, data=True):
    if is_james(data.get("name")):
        J.add_edge(u, v, key=key, **data)

path = nx.shortest_path(
    J,
    source=ELWOOD,
    target=DUANE,
    weight="length",
)

print("\nJames Avenue path:")
print("Nodes:", path)

total_length = 0

for u, v in zip(path[:-1], path[1:]):
    key, edge = min(
        J[u][v].items(),
        key=lambda item: item[1].get("length", float("inf")),
    )
    length = edge["length"]
    total_length += length

    print(
        f"{u} -> {v}, "
        f"key={key}, "
        f"length={length:.1f}m"
    )

print(f"\nTotal corridor length: {total_length:.1f}m")
