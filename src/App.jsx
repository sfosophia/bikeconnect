
import { useEffect, useRef, useState } from "react";
import {
  Map,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";

import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "./App.css";

setWorkerUrl(workerUrl);

const SCHOOL = {
  name: "North Star Academy",
  longitude: -122.235,
  latitude: 37.48081,
};

const EMPTY_FILTER = [
  "==",
  ["get", "origin_node"],
  "",
];

const EMPTY_GEOJSON = {
  type: "FeatureCollection",
  features: [],
};

export default function App() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const corridorBoundsRef = useRef(null);

  const [mapReady, setMapReady] = useState(false);
  const [selectedOrigin, setSelectedOrigin] = useState(null);
  const [scenario, setScenario] = useState("before");
  const [simulation, setSimulation] = useState(null);
  const [corridorError, setCorridorError] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetch("/data/simulation_results.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Simulation results unavailable");
        }
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setSimulation(data);
      })
      .catch((error) => {
        console.error("Simulation loading error:", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const map = new Map({
      container: mapContainer.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [SCHOOL.longitude, SCHOOL.latitude],
      zoom: 15,
    });

    mapRef.current = map;

    map.addControl(new NavigationControl(), "top-right");

    const schoolMarker = new Marker({
      color: "#2563eb",
    })
      .setLngLat([
        SCHOOL.longitude,
        SCHOOL.latitude,
      ])
      .addTo(map);

    map.on("load", async () => {
      if (disposed) return;

      // ---------------------------------------
      // Existing OSM bicycle network
      // ---------------------------------------

      map.addSource("bike-network", {
        type: "geojson",
        data: "/data/bike_network.geojson",
      });

      map.addLayer({
        id: "bike-network-lines",
        type: "line",
        source: "bike-network",
        paint: {
          "line-color": [
            "match",
            ["get", "facility_type"],
            "dedicated", "#16a34a",
            "bike_lane_or_shared", "#2563eb",
            "residential_unverified", "#eab308",
            "other", "#94a3b8",
            "#94a3b8",
          ],
          "line-width": 2.5,
          "line-opacity": 0.35,
        },
      });

      // ---------------------------------------
      // Selected route to school
      // ---------------------------------------

      map.addSource("improved-routes", {
        type: "geojson",
        data: "/data/improved_routes.geojson",
      });

      map.addLayer({
        id: "selected-route-outline",
        type: "line",
        source: "improved-routes",
        filter: EMPTY_FILTER,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#ffffff",
          "line-width": 10,
        },
      });

      map.addLayer({
        id: "selected-route",
        type: "line",
        source: "improved-routes",
        filter: EMPTY_FILTER,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#2563eb",
          "line-width": 5,
        },
      });

      // ---------------------------------------
      // James Avenue corridor
      // Load GeoJSON explicitly so failures
      // can be reported and diagnosed.
      // ---------------------------------------

      let corridorData = EMPTY_GEOJSON;

      try {
        const response = await fetch(
          "/data/james_upgrade.geojson",
          { cache: "no-store" }
        );

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`
          );
        }

        corridorData = await response.json();

        const features = corridorData.features ?? [];

        if (
          corridorData.type !== "FeatureCollection" ||
          features.length === 0
        ) {
          throw new Error(
            "No corridor features found"
          );
        }

        const coordinates = features.flatMap(
          (feature) =>
            feature.geometry?.type === "LineString"
              ? feature.geometry.coordinates
              : []
        );

        if (coordinates.length === 0) {
          throw new Error(
            "No LineString coordinates found"
          );
        }

        const longitudes = coordinates.map(
          (coordinate) => coordinate[0]
        );

        const latitudes = coordinates.map(
          (coordinate) => coordinate[1]
        );

        corridorBoundsRef.current = [
          [
            Math.min(...longitudes),
            Math.min(...latitudes),
          ],
          [
            Math.max(...longitudes),
            Math.max(...latitudes),
          ],
        ];

        console.log(
          "James Avenue corridor loaded:",
          features.length,
          "features",
          corridorBoundsRef.current
        );

        if (!disposed) setCorridorError("");
      } catch (error) {
        console.error(
          "James Avenue corridor loading failed:",
          error
        );

        if (!disposed) {
          setCorridorError(error.message);
        }
      }

      if (disposed) return;

      map.addSource("james-upgrade", {
        type: "geojson",
        data: corridorData,
      });

      // White outline separates the corridor
      // from the selected blue route.
      map.addLayer({
        id: "james-corridor-outline",
        type: "line",
        source: "james-upgrade",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#ffffff",
          "line-width": 17,
          "line-opacity": 1,
        },
      });

      // BEFORE: dashed orange.
      map.addLayer({
        id: "james-corridor-before",
        type: "line",
        source: "james-upgrade",
        layout: {
          "visibility": "visible",
          "line-cap": "butt",
          "line-join": "round",
        },
        paint: {
          "line-color": "#ea580c",
          "line-width": 11,
          "line-dasharray": [2, 1.5],
          "line-opacity": 1,
        },
      });

      // AFTER: solid bright green.
      // No dasharray property is specified.
      map.addLayer({
        id: "james-corridor-after",
        type: "line",
        source: "james-upgrade",
        layout: {
          "visibility": "none",
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#00b84a",
          "line-width": 12,
          "line-opacity": 1,
        },
      });

      // ---------------------------------------
      // Improved starting points
      // ---------------------------------------

      map.addSource("improved-origins", {
        type: "geojson",
        data: "/data/improved_origins.geojson",
      });

      map.addLayer({
        id: "improved-origins-circles",
        type: "circle",
        source: "improved-origins",
        paint: {
          "circle-radius": 3.5,
          "circle-color": "#16a34a",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1,
          "circle-opacity": 0.7,
        },
      });

      map.addLayer({
        id: "selected-origin-circle",
        type: "circle",
        source: "improved-origins",
        filter: [
          "==",
          ["get", "node_id"],
          "",
        ],
        paint: {
          "circle-radius": 9,
          "circle-color": "#7c3aed",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      });

      map.on(
        "click",
        "improved-origins-circles",
        (event) => {
          const feature = event.features?.[0];
          if (!feature) return;

          const p = feature.properties ?? {};

          setSelectedOrigin({
            id: String(p.node_id),
            before: Number(p.cost_before),
            after: Number(p.cost_after),
            reduction: Number(p.cost_reduction),
          });
        }
      );

      map.on(
        "mouseenter",
        "improved-origins-circles",
        () => {
          map.getCanvas().style.cursor = "pointer";
        }
      );

      map.on(
        "mouseleave",
        "improved-origins-circles",
        () => {
          map.getCanvas().style.cursor = "";
        }
      );

      setMapReady(true);
    });

    return () => {
      disposed = true;
      schoolMarker.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // -----------------------------------------
  // Update selected route and scenario
  // -----------------------------------------

  useEffect(() => {
    const map = mapRef.current;

    if (!mapReady || !map) return;

    const routeFilter = selectedOrigin
      ? [
          "all",
          [
            "==",
            ["get", "origin_node"],
            selectedOrigin.id,
          ],
          [
            "==",
            ["get", "scenario"],
            scenario,
          ],
        ]
      : EMPTY_FILTER;

    map.setFilter(
      "selected-route",
      routeFilter
    );

    map.setFilter(
      "selected-route-outline",
      routeFilter
    );

    map.setFilter(
      "selected-origin-circle",
      [
        "==",
        ["get", "node_id"],
        selectedOrigin?.id ?? "",
      ]
    );

    map.setLayoutProperty(
      "james-corridor-before",
      "visibility",
      scenario === "before" ? "visible" : "none"
    );

    map.setLayoutProperty(
      "james-corridor-after",
      "visibility",
      scenario === "after" ? "visible" : "none"
    );
  }, [mapReady, selectedOrigin, scenario]);

  // -----------------------------------------
  // Zoom to proposed improvement
  // -----------------------------------------

  function zoomToImprovement() {
    const map = mapRef.current;
    const bounds = corridorBoundsRef.current;

    if (!map || !bounds) return;

    map.fitBounds(bounds, {
      padding: 120,
      maxZoom: 18,
      duration: 800,
    });
  }

  const currentCost = selectedOrigin
    ? scenario === "before"
      ? selectedOrigin.before
      : selectedOrigin.after
    : null;

  const improvementPercent =
    selectedOrigin?.before > 0
      ? (
          (selectedOrigin.reduction /
            selectedOrigin.before) *
          100
        ).toFixed(1)
      : null;

  const impact = simulation?.impact;

  const buttonStyle = (active) => ({
    padding: "10px 14px",
    border: active
      ? "2px solid #2563eb"
      : "1px solid #cbd5e1",
    borderRadius: "8px",
    background: active ? "#dbeafe" : "#ffffff",
    color: "#1e293b",
    fontWeight: active ? 700 : 400,
    cursor: "pointer",
  });

  return (
    <div className="app">
      <header>
        <h1>BikeConnect</h1>
        <p>School Bike Access Simulator</p>
      </header>

      <main>
        <aside className="sidebar">
          <h2>North Star Academy</h2>
          <p>400 Duane Street, Redwood City</p>

          <h3>James Avenue Improvement</h3>

          <p>
            Model a protected bicycle lane along
            93.7 meters of James Avenue.
          </p>

          <div
            style={{
              display: "flex",
              gap: "8px",
              margin: "16px 0",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              style={buttonStyle(
                scenario === "before"
              )}
              onClick={() => setScenario("before")}
            >
              Before
            </button>

            <button
              type="button"
              style={buttonStyle(
                scenario === "after"
              )}
              onClick={() => setScenario("after")}
            >
              After upgrade
            </button>
          </div>

          <button
            type="button"
            onClick={zoomToImprovement}
            disabled={!corridorBoundsRef.current}
            style={{
              ...buttonStyle(false),
              marginBottom: "12px",
            }}
          >
            Zoom to James Avenue
          </button>

          <p>
            <strong>
              {scenario === "before"
                ? "Orange dashed"
                : "Green solid"}
            </strong>
            {" "}— modeled James Avenue corridor.
          </p>

          {corridorError && (
            <p style={{ color: "#b91c1c" }}>
              Corridor loading error: {corridorError}
            </p>
          )}

          <h3>Simulation Impact</h3>

          <p>
            <strong>
              {impact?.improved_origin_nodes ?? "270"}
            </strong>
            {" "}improved starting nodes
          </p>

          <p>
            <strong>
              {impact?.average_weighted_cost_reduction
                ?? "184.0"}
            </strong>
            {" "}average comfort-cost reduction
          </p>

          <p>
            <strong>
              {impact?.added_protected_meters
                ?? "93.7"}
              {" "}m
            </strong>
            {" "}modeled protected infrastructure added
          </p>

          <hr />

          <h3>Selected Route</h3>

          {selectedOrigin ? (
            <>
              <p>
                Starting node:{" "}
                <strong>{selectedOrigin.id}</strong>
              </p>

              <p>
                Viewing:{" "}
                <strong>
                  {scenario === "before"
                    ? "Before upgrade"
                    : "After upgrade"}
                </strong>
              </p>

              <p>
                Modeled cost:{" "}
                <strong>
                  {currentCost.toFixed(1)}
                </strong>
              </p>

              <p>
                Before:{" "}
                {selectedOrigin.before.toFixed(1)}
              </p>

              <p>
                After:{" "}
                {selectedOrigin.after.toFixed(1)}
              </p>

              <p style={{ color: "#15803d" }}>
                <strong>
                  Cost reduction:{" "}
                  {selectedOrigin.reduction.toFixed(1)}
                  {" "}({improvementPercent}%)
                </strong>
              </p>

              <p className="note">
                Costs are weighted meter-equivalents,
                not actual distance or travel time.
              </p>

              <button
                type="button"
                onClick={() => setSelectedOrigin(null)}
              >
                Clear selection
              </button>
            </>
          ) : (
            <p>
              Click a green starting point to display
              its modeled route to school.
            </p>
          )}

          <hr />

          <h3>Map Legend</h3>

          <p>Blue line: selected route to school</p>
          <p>Orange dashed: corridor before upgrade</p>
          <p>Green solid: proposed protected corridor</p>
          <p>Green dots: improved starting nodes</p>
          <p>Purple dot: selected starting point</p>

          <p className="note">
            Exploratory simulation using OpenStreetMap
            data and illustrative comfort weights:
            1× for modeled protected infrastructure
            and 3× for other streets. These values are
            not verified safety ratings.
          </p>
        </aside>

        <section className="map-panel">
          <div ref={mapContainer} className="map" />
        </section>
      </main>
    </div>
  );
}
