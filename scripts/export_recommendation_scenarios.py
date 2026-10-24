
import json
from pathlib import Path

import networkx as nx
import osmnx as ox

from simulate_access import (
    GRAPH_FILE,
    DATA_DIR,
    SCHOOL_LAT,
    SCHOOL_LON,
    PROTECTED_MULTIPLIER,
    build_weighted_graph,
)

RANKINGS_FILE = DATA_DIR / "ranked_improvements.json"
OUTPUT_DIR = DATA_DIR / "scenarios"


def save_json(path, data):
    path.write_text(
        json.dumps(data, indent=2),
        encoding="utf-8",
    )


def costs_and_paths(graph, school_node):
    reverse = graph.reverse(copy=False)

    costs, paths = nx.single_source_dijkstra(
        reverse,
        school_node,
        weight="comfort_cost",
    )

    return costs, paths


def upgrade_corridor(graph, segments):
    upgraded = graph.copy()

    for u, v in segments:
        for a, b in ((u, v), (v, u)):
            if not upgraded.has_edge(a, b):
                continue

            for key, data in upgraded[a][b].items():
                data["comfort_cost"] = (
                        float(data["length"])
                        * PROTECTED_MULTIPLIER
                )

    return upgraded


def node_coordinates(graph, node):
    return [
        float(graph.nodes[node]["x"]),
        float(graph.nodes[node]["y"]),
    ]


def export_origins(
        graph,
        improved_nodes,
        before_costs,
        after_costs,
):
    features = []

    for node in improved_nodes:
        features.append({
            "type": "Feature",
            "properties": {
                "node_id": str(node),
                "cost_before": round(
                    before_costs[node], 1
                ),
                "cost_after": round(
                    after_costs[node], 1
                ),
                "cost_reduction": round(
                    before_costs[node]
                    - after_costs[node], 1
                ),
            },
            "geometry": {
                "type": "Point",
                "coordinates": node_coordinates(
                    graph, node
                ),
            },
        })

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def export_routes(
        graph,
        improved_nodes,
        before_paths,
        after_paths,
):
    features = []

    for scenario, paths in (
            ("before", before_paths),
            ("after", after_paths),
    ):
        for node in improved_nodes:
            # Dijkstra ran on the reversed graph.
            # Reverse the path back toward school.
            path = list(reversed(paths[node]))

            if len(path) < 2:
                continue

            features.append({
                "type": "Feature",
                "properties": {
                    "origin_node": str(node),
                    "scenario": scenario,
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        node_coordinates(graph, n)
                        for n in path
                    ],
                },
            })

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def export_corridor(graph, item):
    features = []

    for u, v in item["segments"]:
        features.append({
            "type": "Feature",
            "properties": {
                "name": item["name"],
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    node_coordinates(graph, u),
                    node_coordinates(graph, v),
                ],
            },
        })

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def main():
    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    graph = ox.load_graphml(GRAPH_FILE)

    school_node = ox.distance.nearest_nodes(
        graph,
        X=SCHOOL_LON,
        Y=SCHOOL_LAT,
    )

    rankings = json.loads(
        RANKINGS_FILE.read_text(
            encoding="utf-8"
        )
    )

    baseline = build_weighted_graph(
        graph,
        upgrade=False,
    )

    before_costs, before_paths = costs_and_paths(
        baseline,
        school_node,
    )

    manifest = []

    for rank, item in enumerate(
            rankings["top_three"],
            start=1,
    ):
        print(
            f"Exporting #{rank}: {item['name']}"
        )

        upgraded = upgrade_corridor(
            baseline,
            item["segments"],
        )

        after_costs, after_paths = costs_and_paths(
            upgraded,
            school_node,
        )

        improved_nodes = [
            node
            for node, before in before_costs.items()
            if (
                    node in after_costs
                    and before - after_costs[node] > 0.001
            )
        ]

        scenario_dir = OUTPUT_DIR / str(rank)
        scenario_dir.mkdir(
            parents=True,
            exist_ok=True,
        )

        save_json(
            scenario_dir / "improved_origins.geojson",
            export_origins(
                graph,
                improved_nodes,
                before_costs,
                after_costs,
            ),
            )

        save_json(
            scenario_dir / "improved_routes.geojson",
            export_routes(
                graph,
                improved_nodes,
                before_paths,
                after_paths,
            ),
            )

        save_json(
            scenario_dir / "upgrade_corridor.geojson",
            export_corridor(graph, item),
            )

        total_reduction = sum(
            before_costs[node]
            - after_costs[node]
            for node in improved_nodes
        )

        manifest.append({
            "rank": rank,
            "name": item["name"].title(),
            "length_meters": round(
                item["length"], 1
            ),
            "improved_origin_nodes":
                len(improved_nodes),
            "total_weighted_cost_reduction":
                round(total_reduction, 1),
            "average_weighted_cost_reduction":
                round(
                    total_reduction
                    / len(improved_nodes), 1
                ) if improved_nodes else 0,
            "benefit_per_meter": round(
                total_reduction
                / item["length"], 2
            ),
            "data_path":
                f"/data/scenarios/{rank}",
        })

        print(
            f"  Improved origins: "
            f"{len(improved_nodes)}"
        )

    save_json(
        OUTPUT_DIR / "manifest.json",
        {
            "destination": "North Star Academy",
            "recommendations": manifest,
            "disclaimer": (
                "Exploratory comfort-cost model "
                "using OSM street-network nodes "
                "as origins, not student addresses."
            ),
        },
        )

    print("\nAll scenarios exported.")
    print(OUTPUT_DIR / "manifest.json")


if __name__ == "__main__":
    main()
