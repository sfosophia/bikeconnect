
from pathlib import Path

import osmnx as ox

# North Star Academy, Redwood City
SCHOOL_LAT = 37.48081
SCHOOL_LON = -122.23500

# Download streets within approximately 1.2 km
DISTANCE_METERS = 1200

OUTPUT = (
        Path(__file__).resolve().parent.parent
        / "public"
        / "data"
        / "bike_network.geojson"
)


def main():
    print("Downloading bicycle-accessible streets...")

    graph = ox.graph_from_point(
        (SCHOOL_LAT, SCHOOL_LON),
        dist=DISTANCE_METERS,
        network_type="bike",
    )

    print(f"Nodes: {len(graph.nodes)}")
    print(f"Edges: {len(graph.edges)}")

    _, edges = ox.graph_to_gdfs(graph)

    edges = edges.to_crs(epsg=4326)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    edges.to_file(OUTPUT, driver="GeoJSON")

    print(f"Saved network to {OUTPUT}")


if __name__ == "__main__":
    main()
