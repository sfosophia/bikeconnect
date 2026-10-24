
from pathlib import Path
from collections import defaultdict
import json
import math

import networkx as nx
import osmnx as ox

from simulate_access import (
    SCHOOL_LAT,
    SCHOOL_LON,
    GRAPH_FILE,
    DATA_DIR,
    values,
    is_protected,
    PROTECTED_MULTIPLIER,
    build_weighted_graph,
)

OUTPUT = DATA_DIR / "ranked_improvements.json"
GEOJSON_OUTPUT = DATA_DIR / "recommended_corridors.geojson"

MIN_SEGMENT_LENGTH = 20
MAX_SEGMENT_LENGTH = 250
MAX_CORRIDOR_LENGTH = 300
MIN_CORRIDOR_LENGTH = 40

ALLOWED_HIGHWAYS = {
    "residential",
    "living_street",
    "tertiary",
}


def street_name(data):
    names = values(data.get("name"))
    return str(names[0]).strip() if names else "Unnamed street"


def eligible_segment(data):
    if is_protected(data):
        return False

    highways = values(data.get("highway"))

    if not any(h in ALLOWED_HIGHWAYS for h in highways):
        return False

    length = float(data.get("length", 0))

    return MIN_SEGMENT_LENGTH <= length <= MAX_SEGMENT_LENGTH


def get_segments(graph):
    """
    Collect physical street segments, grouping
    opposite travel directions together.
    """
    segments = {}

    for u, v, key, data in graph.edges(
            keys=True, data=True
    ):
        if not eligible_segment(data):
            continue

        pair = tuple(sorted((u, v)))

        if pair not in segments:
            segments[pair] = {
                "pair": pair,
                "u": u,
                "v": v,
                "length": float(data["length"]),
                "name": street_name(data),
            }

    return segments


def build_candidate_corridors(segments):
    """
    Build connected runs along the same named
    street, keeping each corridor <= 300 meters.

    A corridor is a connected set of segments,
    not necessarily a straight line.
    """
    by_street = defaultdict(list)

    for segment in segments.values():
        if segment["name"] != "Unnamed street":
            by_street[segment["name"]].append(segment)

    candidates = []
    seen = set()

    for name, street_segments in by_street.items():
        adjacency = defaultdict(list)

        for segment in street_segments:
            u, v = segment["pair"]
            adjacency[u].append(segment)
            adjacency[v].append(segment)

        # Grow a corridor from each segment.
        for seed in street_segments:
            corridor = [seed]
            used = {seed["pair"]}
            total_length = seed["length"]

            frontier = [seed["u"], seed["v"]]

            while frontier:
                node = frontier.pop(0)

                for neighbor in adjacency[node]:
                    pair = neighbor["pair"]

                    if pair in used:
                        continue

                    new_length = (
                            total_length + neighbor["length"]
                    )

                    if new_length > MAX_CORRIDOR_LENGTH:
                        continue

                    used.add(pair)
                    corridor.append(neighbor)
                    total_length = new_length

                    a, b = pair
                    frontier.append(
                        b if a == node else a
                    )

            if total_length < MIN_CORRIDOR_LENGTH:
                continue

            signature = tuple(sorted(used))

            if signature in seen:
                continue

            seen.add(signature)

            candidates.append({
                "name": name,
                "segments": sorted(used),
                "length": total_length,
            })

    return candidates


def costs_to_school(graph, school_node):
    return nx.single_source_dijkstra_path_length(
        graph.reverse(copy=False),
        school_node,
        weight="comfort_cost",
    )


def evaluate_candidate(
        baseline_graph,
        baseline_costs,
        school_node,
        candidate,
):
    upgraded = baseline_graph.copy()

    for u, v in candidate["segments"]:
        for a, b in ((u, v), (v, u)):
            if not upgraded.has_edge(a, b):
                continue

            for key, data in upgraded[a][b].items():
                data["comfort_cost"] = (
                        float(data["length"])
                        * PROTECTED_MULTIPLIER
                )

    after_costs = costs_to_school(
        upgraded,
        school_node,
    )

    reductions = []

    for origin, before in baseline_costs.items():
        after = after_costs.get(origin)

        if after is None:
            continue

        improvement = before - after

        if improvement > 0.001:
            reductions.append(improvement)

    total = sum(reductions)

    return {
        **candidate,
        "improved_origin_nodes": len(reductions),
        "total_weighted_cost_reduction": round(
            total, 1
        ),
        "average_weighted_cost_reduction": round(
            total / len(reductions), 1
        ) if reductions else 0,
        "benefit_per_meter": round(
            total / candidate["length"], 2
        ),
    }


def select_top_three(results):
    """
    Select highest-ranking projects that do not
    share the same physical street segments.
    """
    selected = []
    occupied = set()

    for result in results:
        segment_set = set(
            tuple(pair)
            for pair in result["segments"]
        )

        if segment_set & occupied:
            continue

        selected.append(result)
        occupied.update(segment_set)

        if len(selected) == 3:
            break

    return selected


def segment_coordinates(graph, u, v):
    """
    Use graph node coordinates for a simple
    GeoJSON segment visualization.
    """
    return [
        [
            float(graph.nodes[u]["x"]),
            float(graph.nodes[u]["y"]),
        ],
        [
            float(graph.nodes[v]["x"]),
            float(graph.nodes[v]["y"]),
        ],
    ]


def export_geojson(graph, recommendations):
    features = []

    for rank, item in enumerate(
            recommendations, start=1
    ):
        for u, v in item["segments"]:
            features.append({
                "type": "Feature",
                "properties": {
                    "rank": rank,
                    "name": item["name"],
                    "benefit_per_meter":
                        item["benefit_per_meter"],
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates":
                        segment_coordinates(graph, u, v),
                },
            })

    collection = {
        "type": "FeatureCollection",
        "features": features,
    }

    GEOJSON_OUTPUT.write_text(
        json.dumps(collection, indent=2),
        encoding="utf-8",
    )


def main():
    graph = ox.load_graphml(GRAPH_FILE)

    school_node = ox.distance.nearest_nodes(
        graph,
        X=SCHOOL_LON,
        Y=SCHOOL_LAT,
    )

    baseline = build_weighted_graph(
        graph,
        upgrade=False,
    )

    baseline_costs = costs_to_school(
        baseline,
        school_node,
    )

    segments = get_segments(graph)
    candidates = build_candidate_corridors(segments)

    print(
        f"Found {len(segments)} eligible segments."
    )
    print(
        f"Evaluating {len(candidates)} corridors..."
    )

    results = []

    for index, candidate in enumerate(
            candidates, start=1
    ):
        result = evaluate_candidate(
            baseline,
            baseline_costs,
            school_node,
            candidate,
        )

        if result["improved_origin_nodes"] > 0:
            results.append(result)

        if index % 25 == 0:
            print(
                f"Evaluated {index}/{len(candidates)}"
            )

    results.sort(
        key=lambda item: (
            -item["benefit_per_meter"],
            -item["total_weighted_cost_reduction"],
        )
    )

    top_three = select_top_three(results)

    output = {
        "school": "North Star Academy",
        "evaluated_corridors": len(candidates),
        "ranking_method":
            "Modeled total comfort-cost reduction "
            "per meter of proposed upgrade",
        "top_three": top_three,
        "disclaimer":
            "Exploratory OSM-based analysis. "
            "Origins are network nodes, not "
            "student homes. Comfort multipliers "
            "are illustrative.",
    }

    OUTPUT.write_text(
        json.dumps(output, indent=2),
        encoding="utf-8",
    )

    export_geojson(graph, top_three)

    print("\nTOP THREE CORRIDORS")

    for rank, item in enumerate(
            top_three, start=1
    ):
        print(
            f"{rank}. {item['name']} | "
            f"{item['length']:.1f} m | "
            f"{item['improved_origin_nodes']} origins | "
            f"benefit/m: "
            f"{item['benefit_per_meter']:.2f}"
        )

    print("\nSaved:")
    print(OUTPUT)
    print(GEOJSON_OUTPUT)


if __name__ == "__main__":
    main()
