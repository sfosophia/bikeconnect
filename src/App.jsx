
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import "./App.css";

maplibregl.setWorkerUrl(workerUrl);

// Network routing destination near North Star Academy.
// Not a verified school entrance.
const SCHOOL = [-122.2345464, 37.4809451];

const EMPTY = {
  type: "FeatureCollection",
  features: [],
};

async function loadJSON(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.json();
}

function fmt(value, digits = 1) {
  return Number(value ?? 0).toLocaleString("en-US", {
    maximumFractionDigits: digits,
  });
}

function linesOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") {
    return [geometry.coordinates];
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates;
  }
  return [];
}

function coordinatesOf(geometry) {
  return linesOf(geometry).flat();
}

function originFromFeature(feature) {
  const p = feature.properties;
  return {
    node_id: String(p.node_id),
    cost_before: Number(p.cost_before),
    cost_after: Number(p.cost_after),
    cost_reduction: Number(p.cost_reduction),
    coordinates: feature.geometry.coordinates,
  };
}

function percentReduction(origin) {
  if (!origin || origin.cost_before <= 0) return 0;
  return (100 * origin.cost_reduction) / origin.cost_before;
}

function coordinateKey(point) {
  return `${Number(point[0]).toFixed(7)},${Number(point[1]).toFixed(7)}`;
}

function edgeKey(a, b) {
  return [coordinateKey(a), coordinateKey(b)].sort().join("|");
}

// Find the exact exported street segments shared by the
// selected route and the proposed corridor.
function overlappingRouteSegments(route, corridor) {
  if (!route || !corridor) return EMPTY;

  const corridorEdges = new Set();

  for (const feature of corridor.features ?? []) {
    for (const line of linesOf(feature.geometry)) {
      for (let i = 1; i < line.length; i++) {
        corridorEdges.add(edgeKey(line[i - 1], line[i]));
      }
    }
  }

  const features = [];

  for (const line of linesOf(route.geometry)) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];

      if (corridorEdges.has(edgeKey(a, b))) {
        features.push({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [a, b],
          },
        });
      }
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function chooseExample(origins, routes, corridor) {
  const afterRoutes = new Map();

  for (const feature of routes) {
    if (feature.properties.scenario === "after") {
      afterRoutes.set(
        String(feature.properties.origin_node),
        feature
      );
    }
  }

  const candidates = origins
    .map(originFromFeature)
    .filter(
      (origin) =>
        origin.cost_before > 0 &&
        origin.cost_reduction > 0 &&
        Number.isFinite(origin.cost_after) &&
        afterRoutes.has(origin.node_id)
    )
    .map((origin) => {
      const route = afterRoutes.get(origin.node_id);
      const overlap = overlappingRouteSegments(route, corridor);

      return {
        ...origin,
        overlapCount: overlap.features.length,
        percentage: percentReduction(origin),
      };
    })
    .filter((origin) => origin.overlapCount > 0);

  // Favor an understandable, substantial improvement.
  // Never invent a demonstration result.
  candidates.sort(
    (a, b) =>
      b.percentage - a.percentage ||
      b.overlapCount - a.overlapCount
  );

  return candidates[0] ?? null;
}

function addLayers(map) {
  map.addSource("bike-network", {
    type: "geojson",
    data: "/data/bike_network.geojson",
  });

  map.addLayer({
    id: "bike-network-lines",
    type: "line",
    source: "bike-network",
    paint: {
      "line-color": "#94a3b8",
      "line-width": 2,
      "line-opacity": 0.35,
    },
  });

  for (const id of [
    "routes",
    "corridor",
    "origins",
    "route-benefit",
  ]) {
    map.addSource(id, {
      type: "geojson",
      data: EMPTY,
    });
  }

  // Blue route, underneath the proposed corridor.
  map.addLayer({
    id: "route-outline",
    type: "line",
    source: "routes",
    filter: ["==", ["get", "origin_node"], ""],
    paint: {
      "line-color": "#ffffff",
      "line-width": 8,
    },
  });

  map.addLayer({
    id: "selected-route",
    type: "line",
    source: "routes",
    filter: ["==", ["get", "origin_node"], ""],
    paint: {
      "line-color": "#2563eb",
      "line-width": 5,
    },
  });

  map.addLayer({
    id: "corridor-outline",
    type: "line",
    source: "corridor",
    paint: {
      "line-color": "#ffffff",
      "line-width": 12,
    },
  });

  map.addLayer({
    id: "corridor-before",
    type: "line",
    source: "corridor",
    paint: {
      "line-color": "#f59e0b",
      "line-width": 8,
      "line-dasharray": [2, 1.5],
    },
  });

  map.addLayer({
    id: "corridor-after",
    type: "line",
    source: "corridor",
    layout: { visibility: "none" },
    paint: {
      "line-color": "#16a34a",
      "line-width": 8,
    },
  });

  // Thin yellow dashes show where the selected route uses
  // the upgraded corridor without obscuring its green color.
  map.addLayer({
    id: "route-benefit-highlight",
    type: "line",
    source: "route-benefit",
    layout: { visibility: "none" },
    paint: {
      "line-color": "#fde047",
      "line-width": 3,
      "line-dasharray": [2, 2],
      "line-opacity": 1,
    },
  });

  map.addLayer({
    id: "origin-points",
    type: "circle",
    source: "origins",
    paint: {
      "circle-radius": 4,
      "circle-color": "#22c55e",
      "circle-opacity": 0.75,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 0.5,
    },
  });

  map.addLayer({
    id: "selected-origin",
    type: "circle",
    source: "origins",
    filter: ["==", ["get", "node_id"], ""],
    paint: {
      "circle-radius": 8,
      "circle-color": "#7c3aed",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
}

const comparisonBox = {
  borderRadius: 10,
  padding: 12,
  minWidth: 0,
};

export default function App() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const dataRef = useRef(null);
  const boundsRef = useRef(null);

  const [mapReady, setMapReady] = useState(false);
  const [recommendations, setRecommendations] = useState([]);
  const [selectedRank, setSelectedRank] = useState(null);
  const [selectedOrigin, setSelectedOrigin] = useState(null);
  const [scenario, setScenario] = useState("after");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [benefitSegments, setBenefitSegments] = useState(0);

  const recommendation = recommendations.find(
    (item) => item.rank === selectedRank
  );

  function fitRoute(origin, data) {
    const map = mapRef.current;
    if (!map || !origin || !data) return;

    const route = data.routes.features.find(
      (feature) =>
        String(feature.properties.origin_node) === origin.node_id &&
        feature.properties.scenario === "after"
    );

    if (!route) return;

    const coords = coordinatesOf(route.geometry);
    if (coords.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();

    for (const point of coords) bounds.extend(point);
    bounds.extend(SCHOOL);

    map.fitBounds(bounds, {
      padding: 95,
      maxZoom: 16.5,
      duration: 650,
    });
  }

  function selectOrigin(origin, zoom = false, data = dataRef.current) {
    setSelectedOrigin(origin);

    if (zoom && origin && data) {
      fitRoute(origin, data);
    }
  }

  // Load recommendations.
  useEffect(() => {
    let cancelled = false;

    loadJSON("/data/scenarios/manifest.json")
      .then((manifest) => {
        if (cancelled) return;

        const items = manifest.recommendations ?? [];
        setRecommendations(items);

        if (items.length) {
          setSelectedRank(items[0].rank);
        } else {
          setError("No recommendations found.");
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize map.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: SCHOOL,
      zoom: 15,
    });

    mapRef.current = map;

    map.addControl(
      new maplibregl.NavigationControl(),
      "top-right"
    );

    const marker = document.createElement("div");
    marker.style.cssText = `
      width: 18px;
      height: 18px;
      background: #1d4ed8;
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 8px #0005;
      cursor: pointer;
    `;

    new maplibregl.Marker({ element: marker })
      .setLngLat(SCHOOL)
      .setPopup(
        new maplibregl.Popup({ offset: 20 }).setText(
          "North Star Academy — nearby network routing destination"
        )
      )
      .addTo(map);

    map.on("load", () => {
      addLayers(map);

      map.on("click", "origin-points", (event) => {
        const feature = event.features?.[0];
        if (!feature) return;

        selectOrigin(originFromFeature(feature));
      });

      map.on("mouseenter", "origin-points", () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", "origin-points", () => {
        map.getCanvas().style.cursor = "";
      });

      setMapReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Load each selected recommendation and automatically
  // choose a verified example route.
  useEffect(() => {
    if (!mapReady || selectedRank === null) return;

    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    async function loadScenario() {
      setLoading(true);
      setError("");
      setSelectedOrigin(null);
      setBenefitSegments(0);
      dataRef.current = null;
      boundsRef.current = null;

      for (const id of [
        "corridor",
        "origins",
        "routes",
        "route-benefit",
      ]) {
        map.getSource(id)?.setData(EMPTY);
      }

      const base = `/data/scenarios/${selectedRank}`;

      try {
        const [corridor, origins, routes] = await Promise.all([
          loadJSON(`${base}/upgrade_corridor.geojson`),
          loadJSON(`${base}/improved_origins.geojson`),
          loadJSON(`${base}/improved_routes.geojson`),
        ]);

        if (cancelled) return;

        const data = { corridor, origins, routes };
        dataRef.current = data;

        map.getSource("corridor").setData(corridor);
        map.getSource("origins").setData(origins);
        map.getSource("routes").setData(routes);

        const bounds = new maplibregl.LngLatBounds();
        let hasCoordinates = false;

        for (const feature of corridor.features) {
          for (const point of coordinatesOf(feature.geometry)) {
            bounds.extend(point);
            hasCoordinates = true;
          }
        }

        if (hasCoordinates) {
          boundsRef.current = bounds;
        }

        const example = chooseExample(
          origins.features,
          routes.features,
          corridor
        );

        if (example) {
          setSelectedOrigin(example);
          setScenario("after");
          fitRoute(example, data);
        } else if (hasCoordinates) {
          map.fitBounds(bounds, {
            padding: 100,
            maxZoom: 17,
          });
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadScenario();

    return () => {
      cancelled = true;
    };
  }, [mapReady, selectedRank]);

  // Update Before/After route and the overlapping segment.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    map.setLayoutProperty(
      "corridor-before",
      "visibility",
      scenario === "before" ? "visible" : "none"
    );

    map.setLayoutProperty(
      "corridor-after",
      "visibility",
      scenario === "after" ? "visible" : "none"
    );

    // The full corridor is green in After regardless of origin.
    // Yellow dashes appear only for a selected route in After.
    map.setLayoutProperty(
      "route-benefit-highlight",
      "visibility",
      scenario === "after" && selectedOrigin ? "visible" : "none"
    );

    const originId = selectedOrigin?.node_id ?? "";

    const filter = [
      "all",
      ["==", ["get", "origin_node"], originId],
      ["==", ["get", "scenario"], scenario],
    ];

    map.setFilter("route-outline", filter);
    map.setFilter("selected-route", filter);

    map.setFilter("selected-origin", [
      "==",
      ["get", "node_id"],
      originId,
    ]);

    const data = dataRef.current;

    if (!selectedOrigin || !data) {
      map.getSource("route-benefit")?.setData(EMPTY);
      setBenefitSegments(0);
      return;
    }

    const route = data.routes.features.find(
      (feature) =>
        String(feature.properties.origin_node) === originId &&
        feature.properties.scenario === scenario
    );

    const overlap = overlappingRouteSegments(
      route,
      data.corridor
    );

    map.getSource("route-benefit")?.setData(overlap);
    setBenefitSegments(overlap.features.length);
  }, [mapReady, selectedOrigin, scenario]);

  function showExampleRoute() {
    const data = dataRef.current;
    if (!data || loading) return;

    const example = chooseExample(
      data.origins.features,
      data.routes.features,
      data.corridor
    );

    if (example) {
      setScenario("after");
      selectOrigin(example, true);
    }
  }

  function chooseRecommendation(rank) {
    if (rank === selectedRank) return;
    setSelectedRank(rank);
    setSelectedOrigin(null);
    setScenario("after");
  }

  function zoomToCorridor() {
    const map = mapRef.current;
    const bounds = boundsRef.current;
    if (!map || !bounds) return;

    map.fitBounds(bounds, {
      padding: 110,
      maxZoom: 17,
      duration: 600,
    });
  }

  const reduction = percentReduction(selectedOrigin);

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1>BikeConnect</h1>
          <p>
            Find high-impact bicycle-network improvements
            near North Star Academy.
          </p>
        </header>

        {/* Main result: visible without scrolling */}
        <section className="sidebar-section">
          <h2>Before vs. After</h2>

          <div className="scenario-toggle">
            <button
              type="button"
              className={scenario === "before" ? "active" : ""}
              onClick={() => setScenario("before")}
            >
              Before
            </button>
            <button
              type="button"
              className={scenario === "after" ? "active" : ""}
              onClick={() => setScenario("after")}
            >
              After
            </button>
          </div>

          {selectedOrigin ? (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    ...comparisonBox,
                    background: "#fff3e0",
                    color: "#7c2d12",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700 }}>
                    BEFORE
                  </div>
                  <div
                    style={{
                      fontSize: 23,
                      fontWeight: 800,
                      lineHeight: 1.4,
                    }}
                  >
                    {fmt(selectedOrigin.cost_before)}
                  </div>
                  <div style={{ fontSize: 11 }}>
                    Weighted cost
                  </div>
                </div>

                <div
                  style={{
                    ...comparisonBox,
                    background: "#dcfce7",
                    color: "#166534",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700 }}>
                    AFTER
                  </div>
                  <div
                    style={{
                      fontSize: 23,
                      fontWeight: 800,
                      lineHeight: 1.4,
                    }}
                  >
                    {fmt(selectedOrigin.cost_after)}
                  </div>
                  <div style={{ fontSize: 11 }}>
                    Weighted cost
                  </div>
                </div>
              </div>

              <div
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  borderRadius: 10,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 34,
                    fontWeight: 800,
                    lineHeight: 1.2,
                  }}
                >
                  {fmt(reduction)}%
                </div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  Lower modeled cycling comfort cost
                </div>
              </div>

              <p className="muted">
                {benefitSegments > 0
                  ? scenario === "after"
                    ? `${benefitSegments} route segment${
                        benefitSegments === 1 ? "" : "s"
                      } highlighted in yellow where the selected route uses the proposed upgrade.`
                    : `${benefitSegments} route segment${
                        benefitSegments === 1 ? "" : "s"
                      } could benefit from the proposed upgrade. Switch to After to see the highlighted section.`
                  : "No exact corridor-edge overlap detected in the exported route."}
              </p>
            </div>
          ) : (
            <p className="muted">
              {loading
                ? "Loading example route..."
                : "Select a green origin to compare its route."}
            </p>
          )}
        </section>

        <section className="sidebar-section">
          <h2>Top 3 Recommended Upgrades</h2>
          <p className="muted">
            Ranked by modeled comfort-cost benefit per
            meter of proposed improvement.
          </p>

          <div className="recommendation-list">
            {recommendations.map((item) => (
              <button
                key={item.rank}
                type="button"
                className={
                  "recommendation-card " +
                  (selectedRank === item.rank ? "active" : "")
                }
                onClick={() => chooseRecommendation(item.rank)}
              >
                <span className="recommendation-rank">
                  #{item.rank}
                </span>
                <span className="recommendation-details">
                  <strong>{item.name}</strong>
                  <small>
                    {fmt(item.length_meters)} m proposed upgrade
                  </small>
                  <small>
                    {fmt(item.improved_origin_nodes, 0)} improved
                    network origins
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>

        {recommendation && (
          <section className="sidebar-section">
            <h2>{recommendation.name}</h2>

            <div className="metrics">
              <div className="metric">
                <strong>
                  {fmt(recommendation.length_meters)} m
                </strong>
                <span>Upgrade length</span>
              </div>
              <div className="metric">
                <strong>
                  {fmt(recommendation.improved_origin_nodes, 0)}
                </strong>
                <span>Improved origins</span>
              </div>
              <div className="metric">
                <strong>
                  {fmt(recommendation.benefit_per_meter, 0)}
                </strong>
                <span>Benefit per meter</span>
              </div>
            </div>

            <button
              type="button"
              className="zoom-button"
              onClick={zoomToCorridor}
              disabled={loading}
            >
              Zoom to improvement
            </button>
          </section>
        )}

        <section className="sidebar-section">
          <h2>Explore Routes to School</h2>

          <button
            type="button"
            className="zoom-button"
            onClick={showExampleRoute}
            disabled={loading}
          >
            Show Example Route
          </button>

          <p className="muted">
            Or click a green dot to choose another network origin.
            Purple marks the selected origin; blue marks the
            nearby school routing destination.
          </p>

          {selectedOrigin && (
            <p className="muted">
              Selected network node: {selectedOrigin.node_id}
            </p>
          )}
        </section>

        <section className="sidebar-section">
          <h2>Understanding the Result</h2>
          <p className="muted">
            The geographic route may remain unchanged.
            Upgrading a street segment lowers its modeled
            cycling comfort cost.
          </p>
          <p className="muted">
            Blue: selected route. Orange dashed: proposed
            corridor before. Green: upgraded corridor after.
            Yellow: route overlap highlighted only in After.
          </p>
        </section>

        <section className="sidebar-section">
          <p className="disclaimer">
            Exploratory OpenStreetMap-based simulation.
            Illustrative weights: protected = 1×,
            unprotected = 3×. Costs are weighted
            meter-equivalents, not travel time or measured
            safety risk. Improved origins are network nodes,
            not people or households. Proposals require
            engineering and feasibility review.
          </p>
        </section>
      </aside>

      <main className="map-area">
        <div ref={containerRef} className="map-container" />

        {loading && (
          <div className="map-message">
            Loading recommendation...
          </div>
        )}

        {error && (
          <div className="map-message error">
            {error}
          </div>
        )}
      </main>
    </div>
  );
}
