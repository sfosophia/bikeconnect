

import { useEffect, useRef } from "react";
import { Map, Marker, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "./App.css";

setWorkerUrl(workerUrl);

// Approximate map center. Verify the exact school entrance later.
const SCHOOL = {
  name: "North Star Academy",
  longitude: -122.23500,
  latitude: 37.48081,
};

export default function App() {
  const mapContainer = useRef(null);

  useEffect(() => {
    const map = new Map({
      container: mapContainer.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [SCHOOL.longitude, SCHOOL.latitude],
      zoom: 15,
    });

    map.on("load", () => {
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
              "#94a3b8"
            ],
            "line-width": 3,
            "line-opacity": 0.85,
          },
        });
       });


    map.addControl(new NavigationControl(), "top-right");

    const marker = new Marker({ color: "#2563eb" })
      .setLngLat([SCHOOL.longitude, SCHOOL.latitude])
      .addTo(map);

    return () => {
      marker.remove();
      map.remove();
    };
  }, []);

  return (
    <div className="app">
      <header>
        <h1>BikeConnect</h1>
        <p>Making school cycling connections visible</p>
      </header>

      <main>
        <aside className="sidebar">
          <h2>North Star Academy</h2>
          <p>400 Duane Street, Redwood City</p>

          <h3>Our pilot project</h3>
          <p>
            Explore how proposed bicycle improvements
            could affect access to this school.
          </p>

          <p className="note">
            Bicycle safety and connectivity analysis
            will be added in the next development stage.
          </p>
        </aside>

        <section className="map-panel">
          <div ref={mapContainer} className="map" />
        </section>
      </main>
    </div>
  );
}
