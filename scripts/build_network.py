
from pathlib import Path

import osmnx as ox

# North Star Academy, Redwood City
SCHOOL_LAT = 37.48081
SCHOOL_LON = -122.23500
DISTANCE_METERS = 1200

OUTPUT = (
        Path(__file__).resolve().parent.parent
        / "public"
        / "data"
        / "bike_network.geojson"
)

# Request additional bicycle-related OpenStreetMap tags.
EXTRA_TAGS = {
    "cycleway",
    "cycleway:left",
    "cycleway:right",
    "cycleway:both",
    "bicycle",
    "maxspeed",
    "traffic_calming",
    "segregated",
}
ox.settings.useful_tags_way = list(
    set(ox.settings.useful_tags_way) | EXTRA_TAGS
)


def tag_values(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).lower() for v in value]
    return [str(value).lower()]


def classify_street(row):
    highways = tag_values(row.get("highway"))
    cycleways = []
    for key in (
            "cycleway",
            "cycleway:left",
            "cycleway:right",
            "cycleway:both",
    ):
        cycleways.extend(tag_values(row.get(key)))

    if "cycleway" in highways:
        return "dedicated"

    if any(
            value in {"track", "opposite_track"}
            for value in cycleways
    ):
        return "dedicated"

    if "path" in highways and (
            "yes" in tag_values(row.get("bicycle"))
            or "yes" in tag_values(row.get("segregated"))
    ):
        return "dedicated"

    if any(
            value in {"lane", "opposite_lane", "shared_lane"}
            for value in cycleways
    ):
        return "bike_lane_or_shared"

    if any(
            highway in {"residential", "living_street"}
            for highway in highways
    ):
        return "residential_unverified"

    return "other"


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
    edges = edges.to_crs(epsg=4326).copy()

    edges["facility_type"] = edges.apply(
        classify_street, axis=1
    )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    edges.to_file(OUTPUT, driver="GeoJSON")

    print("\nFacility classification:")
    print(edges["facility_type"].value_counts())
    print(f"\nSaved to {OUTPUT}")


if __name__ == "__main__":
    main()
