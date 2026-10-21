

from pathlib import Path
import json

import networkx as nx
import osmnx as ox

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "public" / "data"

GRAPH_FILE = DATA_DIR / "bike_network.graphml"
OUTPUT = DATA_DIR / "simulation_results.json"
ORIGINS_OUTPUT = DATA_DIR / "improved_origins.geojson"
ROUTES_OUTPUT = DATA_DIR / "improved_routes.geojson"
CORRIDOR_OUTPUT = DATA_DIR / "james_upgrade.geojson"

SCHOOL_LAT = 37.48081
SCHOOL_LON = -122.23500

# James Avenue corridor: Elwood Street to Duane Street.
ELWOOD = 65397693
MIDDLE = 8974503441
DUANE = 65465515

CORRIDOR = [
    (ELWOOD, MIDDLE),
    (MIDDLE, DUANE),
]

# Illustrative comfort preferences.
# These are NOT verified safety or traffic-stress ratings.
PROTECTED_MULTIPLIER = 1
UNPROTECTED_MULTIPLIER = 3


def values(value):
    """
    Normalize OSM tags to lowercase strings.

    GraphML may load list-valued tags as string
    representations, so handle both formats.
    """
    if value is None:
        return []

    if isinstance(value, (list, tuple, set)):
        return [
            str(item).strip().lower()
            for item in value
        ]

    if isinstance(value, str):
        text = value.strip()

        if text.startswith("[") and text.endswith("]"):
            try:
                import ast
                parsed = ast.literal_eval(text)

                if isinstance(parsed, (list, tuple, set)):
                    return [
                        str(item).strip().lower()
                        for item in parsed
                    ]
            except (ValueError, SyntaxError):
                pass

        return [text.lower()]

    return [str(value).lower()]


def upgraded_edge_pairs():
    """
    Include both travel directions for each
    proposed James Avenue segment.
    """
    return {
        (u, v)
        for a, b in CORRIDOR
        for u, v in ((a, b), (b, a))
    }


def is_protected(edge):
    """
    Simplified OSM-based protected infrastructure
    proxy. Not an official facility classification.
    """
    if "cycleway" in values(edge.get("highway")):
        return True

    for key in (
            "cycleway",
            "cycleway:left",
            "cycleway:right",
            "cycleway:both",
    ):
        tags = values(edge.get(key))

        if any(
                tag in ("track", "opposite_track")
                for tag in tags
        ):
            return True

    return False


def build_weighted_graph(graph, upgrade=False):
    """
    Assign modeled cycling comfort cost to edges.

    Protected infrastructure: length x 1
    Other streets:            length x 3
    """
    weighted = graph.copy()
    upgraded_pairs = upgraded_edge_pairs()

    for u, v, key, data in weighted.edges(
            keys=True,
            data=True,
    ):
        protected = (
                is_protected(data)
                or (
                        upgrade
                        and (u, v) in upgraded_pairs
                )
        )

        length = float(data.get("length", 0))

        multiplier = (
            PROTECTED_MULTIPLIER
            if protected
            else UNPROTECTED_MULTIPLIER
        )

        data["comfort_cost"] = length * multiplier

    return weighted


def calculate_comfort_routes(
        graph,
        school_node,
        upgrade=False,
):
    """
    Calculate minimum modeled comfort cost
    from every reachable origin to the school.
    """
    weighted = build_weighted_graph(
        graph,
        upgrade=upgrade,
    )

    # Reverse edges so a search starting at school
    # calculates routes traveling TO the school.
    reversed_graph = weighted.reverse(copy=False)

    return nx.single_source_dijkstra_path_length(
        reversed_graph,
        school_node,
        weight="comfort_cost",
    )


def calculate_protected_length(graph, upgrade=False):
    """
    Count physical street segments only once,
    even when both travel directions exist.
    """
    upgraded_pairs = upgraded_edge_pairs()
    segments = {}

    for u, v, key, data in graph.edges(
            keys=True,
            data=True,
    ):
        pair = tuple(sorted((u, v)))
        length = float(data.get("length", 0))

        protected = (
                is_protected(data)
                or (
                        upgrade
                        and (u, v) in upgraded_pairs
                )
        )

        if pair not in segments:
            segments[pair] = {
                "length": length,
                "protected": protected,
            }
        else:
            segments[pair]["length"] = max(
                segments[pair]["length"],
                length,
            )
            segments[pair]["protected"] |= protected

    return round(
        sum(
            segment["length"]
            for segment in segments.values()
            if segment["protected"]
        ),
        1,
    )


def export_improved_origins(
        graph,
        improved_nodes,
        comfort_before,
        comfort_after,
):
    """
    Export improved starting nodes as GeoJSON points.
    """
    features = []

    for node in improved_nodes:
        node_data = graph.nodes[node]

        reduction = (
                comfort_before[node]
                - comfort_after[node]
        )

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [
                    float(node_data["x"]),
                    float(node_data["y"]),
                ],
            },
            "properties": {
                "node_id": str(node),
                "cost_before": round(
                    comfort_before[node], 1
                ),
                "cost_after": round(
                    comfort_after[node], 1
                ),
                "cost_reduction": round(
                    reduction, 1
                ),
            },
        })

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }

    ORIGINS_OUTPUT.write_text(
        json.dumps(geojson, indent=2),
        encoding="utf-8",
    )

    print(
        f"Exported {len(features)} improved origins "
        f"to {ORIGINS_OUTPUT}"
    )


def export_comfort_routes(
        graph,
        school_node,
        improved_nodes,
):
    """
    Export before/after lowest-comfort-cost routes.

    Each improved origin has two routes:
    one before and one after the proposed upgrade.
    """
    features = []

    for upgrade in (False, True):
        scenario = "after" if upgrade else "before"

        weighted = build_weighted_graph(
            graph,
            upgrade=upgrade,
        )

        reversed_graph = weighted.reverse(copy=False)

        paths = nx.single_source_dijkstra_path(
            reversed_graph,
            school_node,
            weight="comfort_cost",
        )

        for origin in improved_nodes:
            if origin not in paths:
                continue

            # Reverse the school-to-origin path.
            node_path = list(reversed(paths[origin]))

            if len(node_path) < 2:
                continue

            coordinates = [
                [
                    float(graph.nodes[node]["x"]),
                    float(graph.nodes[node]["y"]),
                ]
                for node in node_path
            ]

            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": coordinates,
                },
                "properties": {
                    "origin_node": str(origin),
                    "scenario": scenario,
                },
            })

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }

    ROUTES_OUTPUT.write_text(
        json.dumps(geojson, indent=2),
        encoding="utf-8",
    )

    print(
        f"Exported {len(features)} routes "
        f"to {ROUTES_OUTPUT}"
    )


def export_upgrade_corridor(graph):
    """
    Export the two proposed James Avenue segments.

    Prefer actual OSM edge geometry when available;
    otherwise connect the endpoint coordinates.
    """
    features = []
    total_length = 0.0

    for u, v in CORRIDOR:
        edge_options = graph.get_edge_data(u, v)

        if not edge_options:
            raise RuntimeError(
                f"Missing James Avenue segment: {u} -> {v}"
            )

        # Choose the shortest edge if parallel
        # edges exist between these nodes.
        edge = min(
            edge_options.values(),
            key=lambda data: float(
                data.get("length", float("inf"))
            ),
        )

        length = float(edge.get("length", 0))
        total_length += length

        geometry = edge.get("geometry")

        if geometry is not None:
            coordinates = [
                [float(x), float(y)]
                for x, y in geometry.coords
            ]
        else:
            coordinates = [
                [
                    float(graph.nodes[u]["x"]),
                    float(graph.nodes[u]["y"]),
                ],
                [
                    float(graph.nodes[v]["x"]),
                    float(graph.nodes[v]["y"]),
                ],
            ]

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": coordinates,
            },
            "properties": {
                "street": "James Avenue",
                "from_node": str(u),
                "to_node": str(v),
                "length_meters": round(length, 1),
                "proposed_upgrade": "protected bike lane",
            },
        })

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }

    CORRIDOR_OUTPUT.write_text(
        json.dumps(geojson, indent=2),
        encoding="utf-8",
    )

    print(
        f"Exported {len(features)} James Avenue segments "
        f"({total_length:.1f} m) to {CORRIDOR_OUTPUT}"
    )

    return round(total_length, 1)


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading bicycle network...")
    G = ox.load_graphml(GRAPH_FILE)

    school_node = ox.distance.nearest_nodes(
        G,
        X=SCHOOL_LON,
        Y=SCHOOL_LAT,
    )

    # Validate both directions of the corridor.
    for u, v in CORRIDOR:
        if not G.has_edge(u, v) or not G.has_edge(v, u):
            raise RuntimeError(
                f"Corridor missing a direction: "
                f"{u} <-> {v}"
            )

    # ----------------------------------------
    # Export proposed James Avenue improvement
    # ----------------------------------------

    corridor_length = export_upgrade_corridor(G)

    # ----------------------------------------
    # Calculate protected infrastructure length
    # ----------------------------------------

    protected_before = calculate_protected_length(
        G,
        upgrade=False,
    )

    protected_after = calculate_protected_length(
        G,
        upgrade=True,
    )

    added_protected = round(
        protected_after - protected_before,
        1,
        )

    print(f"Protected before: {protected_before} m")
    print(f"Protected after:  {protected_after} m")
    print(
        f"Added protected infrastructure: "
        f"{added_protected} m"
    )

    # ----------------------------------------
    # Calculate comfort-weighted routes
    # ----------------------------------------

    comfort_before = calculate_comfort_routes(
        G,
        school_node,
        upgrade=False,
    )

    comfort_after = calculate_comfort_routes(
        G,
        school_node,
        upgrade=True,
    )

    improved_nodes = [
        node
        for node in comfort_before
        if node in comfort_after
           and (
                   comfort_after[node]
                   < comfort_before[node] - 0.001
           )
    ]

    reductions = [
        comfort_before[node] - comfort_after[node]
        for node in improved_nodes
    ]

    average_reduction = (
        round(
            sum(reductions) / len(reductions),
            1,
            )
        if reductions
        else 0
    )

    print("\nComfort-weighted routing results:")
    print(
        "Origins with reduced modeled route cost:",
        len(improved_nodes),
    )
    print(
        "Average cost reduction among improved origins:",
        average_reduction,
    )

    # ----------------------------------------
    # Export visualization files
    # ----------------------------------------

    export_improved_origins(
        G,
        improved_nodes,
        comfort_before,
        comfort_after,
    )

    export_comfort_routes(
        G,
        school_node,
        improved_nodes,
    )

    # ----------------------------------------
    # Save simulation summary
    # ----------------------------------------

    results = {
        "scenario": "James Avenue protected bike lane",
        "school": "North Star Academy",
        "corridor_length_meters": corridor_length,
        "school_node": school_node,
        "impact": {
            "improved_origin_nodes": len(improved_nodes),
            "average_weighted_cost_reduction":
                average_reduction,
            "added_protected_meters":
                added_protected,
        },
        "model": {
            "protected_street_multiplier":
                PROTECTED_MULTIPLIER,
            "unprotected_street_multiplier":
                UNPROTECTED_MULTIPLIER,
        },
        "disclaimer": (
            "Exploratory routing simulation using "
            "OpenStreetMap data and illustrative comfort "
            "weights. Origin nodes are not households "
            "or students. Results do not represent "
            "verified safety improvements."
        ),
    }

    OUTPUT.write_text(
        json.dumps(results, indent=2),
        encoding="utf-8",
    )

    print(json.dumps(results, indent=2))
    print(f"\nSaved to {OUTPUT}")


if __name__ == "__main__":
    main()
