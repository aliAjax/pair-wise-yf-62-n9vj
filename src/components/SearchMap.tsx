'use client';

import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import type { Projection } from '@/lib/ledger/types';

/**
 * 搜救态势图：
 * - 搜索区按状态着色；覆盖率已失效（等待重算）用琥珀色描边提示。
 * - 单位标记按最近回执状态着色：青绿=有效，琥珀=过期/失效，灰=无回执。
 * 低带宽模式下父组件直接不挂载本组件（demotiles 也不拉取）。
 */
export function SearchMap({ view }: { view: Projection }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;
    const markers: Marker[] = [];

    void import('maplibre-gl').then(({ Map, Marker: MapMarker, LngLatBounds }) => {
      if (disposed || !containerRef.current) return;
      map = new Map({
        container: containerRef.current,
        center: [121.68, 30.86],
        zoom: 8.6,
        style: 'https://demotiles.maplibre.org/style.json'
      });
      mapRef.current = map;

      map.on('load', () => {
        if (!map || disposed) return;
        const bounds = new LngLatBounds();
        view.areas.forEach((area) => {
          const b = area.fields.bounds?.value as [number, number, number, number] | undefined;
          if (!b) return;
          const status = String(area.fields.status?.value ?? '');
          const summary = view.areaCoverage[area.id];
          map!.addSource(area.id, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]]
              }
            }
          });
          map!.addLayer({
            id: `${area.id}-fill`, type: 'fill', source: area.id,
            paint: {
              'fill-color': status === 'active' ? '#0e7490' : status === 'closed' ? '#64748b' : '#f59e0b',
              'fill-opacity': status === 'closed' ? 0.08 : 0.2
            }
          });
          map!.addLayer({
            id: `${area.id}-outline`, type: 'line', source: area.id,
            paint: {
              'line-color': summary && summary.percent === null ? '#d97706' : '#0f766e',
              'line-width': summary && summary.percent === null ? 2.5 : 1,
              'line-dasharray': summary && summary.percent === null ? [2, 1] : [1, 0]
            }
          });
          bounds.extend([b[0], b[1]]);
          bounds.extend([b[2], b[3]]);
        });

        view.units.forEach((u) => {
          const p = view.latestPosition[u.id];
          const lat = p ? p.lat : Number(u.fields.homeLat?.value ?? 30.8);
          const lng = p ? p.lng : Number(u.fields.homeLng?.value ?? 121.6);
          let color = '#94a3b8';
          if (p) {
            color = p.state === 'fresh' ? '#0f766e' : p.state === 'stale' ? '#d97706' : '#dc2626';
          }
          markers.push(new MapMarker({ color }).setLngLat([lng, lat]).addTo(map!));
          bounds.extend([lng, lat]);
        });

        if (!bounds.isEmpty()) map!.fitBounds(bounds, { padding: 60 });
      });
    });

    return () => {
      disposed = true;
      markers.forEach((m) => m.remove());
      map?.remove();
      mapRef.current = null;
    };
  }, [view]);

  return <div ref={containerRef} className="map-shell" aria-label="搜救海域地图" />;
}
