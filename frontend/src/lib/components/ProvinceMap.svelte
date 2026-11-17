<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type * as ThreeNS from 'three';
  import { ActivityError } from '#lib/api/activities.ts';
  import {
    readGlobalFootprints as scoped_readGlobalFootprints,
    type GlobalFootprintCity,
    type GlobalFootprintCountry,
    type GlobalFootprintRegion,
    type GlobalFootprints,
  } from '#lib/api/milestones.ts';
  import { whenNearViewport } from '#lib/near-viewport.ts';
  import { useViewContext } from '#lib/view-context.ts';
  import type {
    ChinaCitiesData,
    DualPositionArrays,
    GeoBounds,
    GeoCollection,
    GeoFeature,
    RgbTuple,
  } from '#lib/map/globe-geometry.ts';
  import FeedbackState from './FeedbackState.svelte';
  import { watchSystemTheme } from './system-theme';

  const view = useViewContext();
  const readGlobalFootprints = view.bind(scoped_readGlobalFootprints, 1);

  type ProjectionMode = 'globe' | 'mercator';

  const DEFAULT_OVERVIEW_BOUNDS: GeoBounds = [73.5, 18.0, 135.0, 53.5];
  const DEFAULT_GLOBE_DIST = 3.55;
  const DEFAULT_LON = 106;
  const DEFAULT_LAT = 32;

  let stageEl: HTMLDivElement;
  let hostEl: HTMLDivElement;
  let disposed = false;
  let mapReady = $state(false);
  let dark = $state(false);
  let projectionMode = $state<ProjectionMode>('mercator');

  let data = $state<GlobalFootprints | null>(null);
  let loading = $state(true);
  let error = $state('');
  let refresh = $state(0);

  let selectedCountryCode = $state('');
  let selectedRegionCode = $state('');
  let selectedCityCode = $state('');
  let viewMoved = $state(false);

  const selectedCountry = $derived<GlobalFootprintCountry | null>(
    data?.countries.find((c) => c.code === selectedCountryCode) ?? data?.countries[0] ?? null,
  );
  const selectedRegion = $derived<GlobalFootprintRegion | null>(
    selectedCountry?.regions.find((r) => r.code === selectedRegionCode) ?? selectedCountry?.regions[0] ?? null,
  );
  const selectedCity = $derived<GlobalFootprintCity | null>(
    selectedRegion?.cities.find((ct) => ct.code === selectedCityCode) ?? null,
  );

  function formatKm(meters?: number): string {
    if (!meters || meters <= 0) return '';
    const km = meters / 1000;
    return `${km.toLocaleString('zh-CN', { maximumFractionDigits: km >= 100 ? 0 : 1 })} km`;
  }

  const activeFocus = $derived.by(() => {
    if (!selectedRegion) return null;
    if (selectedCity) {
      return {
        label: `${selectedRegion.short_name} · ${selectedCity.name}`,
        count: selectedCity.activity_count,
        km: formatKm(selectedCity.distance_m),
      };
    }
    return {
      label: selectedRegion.short_name,
      count: selectedRegion.activity_count,
      km: formatKm(selectedRegion.distance_m),
    };
  });

  let sceneHandle:
    | {
        applyTheme: () => void;
        syncData: (reframe: boolean) => void;
        syncSelection: () => void;
        focusBounds: (bounds: GeoBounds, minSpanDeg: number, center: [number, number], globeDist: number) => void;
        zoomBy: (factor: number) => void;
        setMode: (mode: ProjectionMode) => void;
        resetView: () => void;
        nudgeRotation: (dYaw: number, dPitch: number) => void;
      }
    | undefined;

  let loadedDataKey = '';

  $effect(() => {
    refresh;
    let active = true;
    loading = true;
    error = '';
    void readGlobalFootprints()
      .then((result) => {
        if (!active) return;
        data = result;
        if (result.countries.length) {
          const country = result.countries.find((c) => c.code === selectedCountryCode) ?? result.countries[0];
          selectedCountryCode = country.code;
          const region = country.regions.find((r) => r.code === selectedRegionCode) ?? country.regions[0];
          selectedRegionCode = region?.code ?? '';
          if (selectedCityCode && !region?.cities.some((ct) => ct.code === selectedCityCode)) {
            selectedCityCode = '';
          }
        } else {
          selectedCountryCode = '';
          selectedRegionCode = '';
          selectedCityCode = '';
        }
      })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof ActivityError && cause.status === 401) {
          data = null;
          window.location.replace('/admin?reason=expired&next=%2Fdashboard');
          return;
        }
        error = cause instanceof Error ? cause.message : '暂时无法读取足迹地图';
      })
      .finally(() => {
        if (active) loading = false;
      });
    return () => {
      active = false;
    };
  });

  $effect(() => {
    data;
    if (!mapReady || !sceneHandle) return;
    const key = data ? `${data.year ?? 'all'}-${data.activity_count}-${data.region_count}-${data.city_count}` : '';
    const reframe = key !== loadedDataKey;
    loadedDataKey = key;
    sceneHandle.syncData(reframe);
  });

  $effect(() => {
    selectedRegionCode;
    selectedCityCode;
    if (mapReady) sceneHandle?.syncSelection();
  });

  let cityBoundsLookup = new Map<string, GeoBounds>();

  function regionFocusBounds(region: GlobalFootprintRegion): GeoBounds {
    return region.bounds;
  }

  function cityFocusBounds(city: GlobalFootprintCity, region: GlobalFootprintRegion): GeoBounds {
    const exact = cityBoundsLookup.get(city.code);
    if (exact) return exact;
    const [rMinLon, rMinLat, rMaxLon, rMaxLat] = region.bounds;
    if (Math.max(rMaxLon - rMinLon, rMaxLat - rMinLat) < 5.0) return region.bounds;
    return [city.lon - 0.85, city.lat - 0.65, city.lon + 0.85, city.lat + 0.65];
  }

  function selectCountry(country: GlobalFootprintCountry) {
    selectedCountryCode = country.code;
    const firstRegion = country.regions[0];
    selectedRegionCode = firstRegion?.code ?? '';
    selectedCityCode = '';
    if (country.bounds && firstRegion) {
      sceneHandle?.focusBounds(country.bounds, 6.0, firstRegion.center, country.code === 'CHN' ? 2.45 : 2.3);
    }
  }

  function selectRegion(region: GlobalFootprintRegion, countryCode?: string) {
    if (countryCode) selectedCountryCode = countryCode;
    selectedRegionCode = region.code;
    selectedCityCode = '';
    sceneHandle?.focusBounds(regionFocusBounds(region), 2.8, region.center, 2.05);
  }

  function selectCity(city: GlobalFootprintCity, regionCode?: string, countryCode?: string) {
    if (countryCode) selectedCountryCode = countryCode;
    if (regionCode) selectedRegionCode = regionCode;
    selectedCityCode = city.code;
    const reg =
      (countryCode
        ? data?.countries
            .find((c) => c.code === countryCode)
            ?.regions.find((r) => r.code === (regionCode ?? selectedRegionCode))
        : selectedRegion) ?? null;
    if (reg) {
      sceneHandle?.focusBounds(cityFocusBounds(city, reg), 1.05, [city.lon, city.lat], 1.58);
    }
  }

  function switchProjection(next: ProjectionMode) {
    if (projectionMode === next) return;
    projectionMode = next;
    sceneHandle?.setMode(next);
  }

  function resetGlobalView() {
    selectedCityCode = '';
    sceneHandle?.resetView();
  }

  function horizontalWheel(event: WheelEvent) {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const rail = event.currentTarget as HTMLDivElement;
    if (rail.scrollWidth <= rail.clientWidth) return;
    event.preventDefault();
    rail.scrollLeft += event.deltaY;
  }

  function handleCanvasKeydown(event: KeyboardEvent) {
    if (!sceneHandle) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      sceneHandle.nudgeRotation(0.1, 0);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      sceneHandle.nudgeRotation(-0.1, 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      sceneHandle.nudgeRotation(0, -0.08);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      sceneHandle.nudgeRotation(0, 0.08);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      sceneHandle.zoomBy(0.86);
    } else if (event.key === '-') {
      event.preventDefault();
      sceneHandle.zoomBy(1.16);
    } else if (event.key === '0') {
      event.preventDefault();
      resetGlobalView();
    }
  }

  onMount(() => {
    let cleanupThree: (() => void) | undefined;
    const stopTheme = watchSystemTheme((value) => {
      dark = value;
      sceneHandle?.applyTheme();
    });

    const startScene = () => {
      void (async () => {
        try {
          const [THREE, baseModule, citiesModule, geoUtil] = await Promise.all([
            import('three'),
            import('#lib/data/world-base.json'),
            import('#lib/data/china-cities.json'),
            import('#lib/map/globe-geometry.ts'),
          ]);
          if (disposed || !hostEl) return;

          const worldFeatures = ((baseModule.default as GeoCollection).features ?? []) as GeoFeature[];
          const chinaCitiesRaw = citiesModule.default as unknown as ChinaCitiesData;
          cityBoundsLookup = geoUtil.decodeChinaCitiesBounds(chinaCitiesRaw);

          const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
          });
          renderer.autoClear = false;
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
          renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
          hostEl.appendChild(renderer.domElement);

          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera(32, 1.35, 0.005, 30);

          const pitchGroup = new THREE.Group();
          const yawGroup = new THREE.Group();
          pitchGroup.add(yawGroup);
          scene.add(pitchGroup);

          const createMorphMaterial = (hex: string, doubleSide = false, useVertexColor = false, isOverlay = true) =>
            new THREE.ShaderMaterial({
              side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
              depthWrite: !isOverlay,
              uniforms: {
                uMorph: { value: 1.0 },
                uColor: { value: new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace) },
                uUseVertColor: { value: useVertexColor ? 1.0 : 0.0 },
                uClipBack: { value: isOverlay ? 1.0 : 0.0 },
              },
              vertexShader: `
                attribute vec3 aFlatPos;
                attribute vec3 aVertColor;
                uniform float uMorph;
                uniform vec3 uColor;
                uniform float uUseVertColor;
                varying vec3 vCol;
                varying float vViewNz;
                void main() {
                  vec3 p = mix(position, aFlatPos, uMorph);
                  vCol = mix(uColor, aVertColor, uUseVertColor);
                  vViewNz = (modelViewMatrix * vec4(normalize(position), 0.0)).z;
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
                }
              `,
              fragmentShader: `
                uniform float uMorph;
                uniform float uClipBack;
                varying vec3 vCol;
                varying float vViewNz;
                void main() {
                  if (uClipBack > 0.5 && uMorph < 0.98 && vViewNz < -0.015) discard;
                  gl_FragColor = vec4(vCol, 1.0);
                }
              `,
            });

          const makeGeometry = (arrays: DualPositionArrays, fillFallbackColor = false) => {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(arrays.sphere, 3));
            g.setAttribute('aFlatPos', new THREE.Float32BufferAttribute(arrays.flat, 3));
            if (arrays.colors) {
              g.setAttribute('aVertColor', new THREE.Float32BufferAttribute(arrays.colors, 3));
            } else if (fillFallbackColor) {
              g.setAttribute('aVertColor', new THREE.Float32BufferAttribute(new Float32Array(arrays.sphere.length), 3));
            }
            return g;
          };

          const oceanGrid = geoUtil.buildOceanGrid(0.9985, 0.0);
          const oceanMat = createMorphMaterial('#e8f1ee', true, false, false);
          const oceanMesh = new THREE.Mesh(makeGeometry(oceanGrid, true), oceanMat);
          oceanMesh.frustumCulled = false;
          oceanMesh.renderOrder = 1;
          yawGroup.add(oceanMesh);

          const gratMat = createMorphMaterial('#dce8e4');
          const gratGeo = makeGeometry(geoUtil.buildGraticuleLines(1.0, 0.0), true);
          const gratMesh = new THREE.LineSegments(gratGeo, gratMat);
          gratMesh.frustumCulled = false;
          gratMesh.renderOrder = 2;
          yawGroup.add(gratMesh);

          const landMat = createMorphMaterial('#f8f7f2', true);
          const landGeo = makeGeometry(geoUtil.buildSubdividedPolygons(worldFeatures, 1.0, 0.0, 4.5, 4), true);
          const landMesh = new THREE.Mesh(landGeo, landMat);
          landMesh.frustumCulled = false;
          landMesh.renderOrder = 3;
          yawGroup.add(landMesh);

          const borderMat = createMorphMaterial('#d7ded5');
          const borderGeo = makeGeometry(geoUtil.buildSubdividedLines(worldFeatures, 1.0, 0.0, 4.5), true);
          const borderMesh = new THREE.LineSegments(borderGeo, borderMat);
          borderMesh.frustumCulled = false;
          borderMesh.renderOrder = 4;
          yawGroup.add(borderMesh);

          const litRegMat = createMorphMaterial('#bce5cb', true, true);
          const litRegMesh = new THREE.Mesh(new THREE.BufferGeometry(), litRegMat);
          litRegMesh.frustumCulled = false;
          litRegMesh.renderOrder = 5;
          litRegMesh.visible = false;
          yawGroup.add(litRegMesh);

          const litCityMat = createMorphMaterial('#1e936f', true, true);
          const litCityMesh = new THREE.Mesh(new THREE.BufferGeometry(), litCityMat);
          litCityMesh.frustumCulled = false;
          litCityMesh.renderOrder = 6;
          litCityMesh.visible = false;
          yawGroup.add(litCityMesh);

          const activeLineMat = createMorphMaterial('#105d49');
          const activeLineMesh = new THREE.LineSegments(new THREE.BufferGeometry(), activeLineMat);
          activeLineMesh.frustumCulled = false;
          activeLineMesh.renderOrder = 7;
          activeLineMesh.visible = false;
          yawGroup.add(activeLineMesh);

          interface CityMetaEntry {
            city: GlobalFootprintCity;
            region: GlobalFootprintRegion;
            country: GlobalFootprintCountry;
          }
          let cityMetaMap = new Map<string, CityMetaEntry>();

          const rimPts: ThreeNS.Vector3[] = [];
          for (let i = 0; i <= 128; i++) {
            const angle = (i / 128) * Math.PI * 2;
            rimPts.push(new THREE.Vector3(Math.cos(angle) * 1.006, Math.sin(angle) * 1.006, 0));
          }
          const globeRimMat = new THREE.LineBasicMaterial({ color: 0xc8d8d2 });
          const globeRim = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPts), globeRimMat);
          globeRim.visible = false;
          scene.add(globeRim);

          const pickSphereGeo = new THREE.SphereGeometry(1.0, 32, 32);
          const pickSphereMat = new THREE.MeshBasicMaterial();
          const pickSphere = new THREE.Mesh(pickSphereGeo, pickSphereMat);
          pickSphere.visible = false;
          yawGroup.add(pickSphere);

          const morphMaterials = [oceanMat, gratMat, landMat, borderMat, litRegMat, litCityMat, activeLineMat];

          const defaultYaw = (-(DEFAULT_LON + 90) * Math.PI) / 180;
          const defaultPitch = (DEFAULT_LAT * Math.PI) / 180;

          let homePanX = 0;
          let homePanY = 0;
          let homeDist = 0.85;
          let homeYaw = defaultYaw;
          let homePitch = defaultPitch;

          let yaw = homeYaw;
          let pitch = homePitch;
          let camDist = homeDist;
          let tYaw = yaw;
          let tPitch = pitch;
          let tDist = camDist;
          let vYaw = 0;
          let vPitch = 0;
          let panX = 0;
          let panY = 0;
          let tPanX = 0;
          let tPanY = 0;
          let morph = 1.0;
          let tMorph = 1.0;
          let dragging = false;
          let needsRender = true;
          let frameId = 0;

          const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

          let cachedCityFeatures: GeoFeature[] = [];
          let cachedRegionFeatures: GeoFeature[] = [];

          const tierColor = (count: number, maxCount: number, ramps: [string, string, string]): RgbTuple => {
            const ratio = maxCount <= 1 ? 1 : Math.log1p(count) / Math.log1p(maxCount);
            const hex = ratio > 0.68 ? ramps[2] : ratio > 0.32 ? ramps[1] : ramps[0];
            return geoUtil.hexToRgb(hex);
          };

          const currentPalette = () =>
            dark
              ? {
                  ocean: '#282624',
                  rim: '#46433f',
                  graticule: '#32302e',
                  land: '#393633',
                  border: '#2d2b29',
                  regRamp: ['#2f4a3d', '#3a5e4d', '#497560'] as [string, string, string],
                  cityRamp: ['#53a984', '#6cc59e', '#8be0ba'] as [string, string, string],
                  activeBorder: '#c8f7df',
                }
              : {
                  ocean: '#e8f1ee',
                  rim: '#cad9d3',
                  graticule: '#dce8e4',
                  land: '#f8f7f2',
                  border: '#d6dfd6',
                  regRamp: ['#d2ebd9', '#a5d8b8', '#74c196'] as [string, string, string],
                  cityRamp: ['#46a87d', '#288d65', '#17745c'] as [string, string, string],
                  activeBorder: '#105d49',
                };

          const rebuildChoropleth = () => {
            const pal = currentPalette();
            const regionFeatures = ((data?.region_features as GeoCollection | undefined)?.features ??
              []) as GeoFeature[];
            cachedRegionFeatures = regionFeatures;

            const regionCountMap = new Map<string, number>();
            let maxRegCount = 1;
            let maxCityCount = 1;
            if (data) {
              for (const country of data.countries) {
                for (const reg of country.regions) {
                  regionCountMap.set(reg.code, reg.activity_count);
                  maxRegCount = Math.max(maxRegCount, reg.activity_count);
                  for (const ct of reg.cities) maxCityCount = Math.max(maxCityCount, ct.activity_count);
                }
              }
            }

            litRegMesh.geometry.dispose();
            if (regionFeatures.length) {
              litRegMesh.geometry = makeGeometry(
                geoUtil.buildSubdividedPolygons(regionFeatures, 1.0, 0.0, 3.5, 3, (f) => {
                  const code = String((f.properties as { code?: string })?.code ?? '');
                  return tierColor(regionCountMap.get(code) ?? 1, maxRegCount, pal.regRamp);
                }),
              );
              litRegMesh.visible = true;
            } else {
              litRegMesh.geometry = new THREE.BufferGeometry();
              litRegMesh.visible = false;
            }

            const cityCountMap = new Map<string, number>();
            const visitedCityCodes = new Set<string>();
            const cityFeatures: GeoFeature[] = [];
            if (data) {
              for (const country of data.countries) {
                for (const reg of country.regions) {
                  for (const ct of reg.cities) {
                    visitedCityCodes.add(ct.code);
                    cityCountMap.set(ct.code, ct.activity_count);
                  }
                }
              }
              cityFeatures.push(...geoUtil.decodeChinaCitiesFeatures(chinaCitiesRaw, visitedCityCodes));
              const matchedCityCodes = new Set(
                cityFeatures.map((f) => String((f.properties as { code?: string })?.code ?? '')),
              );
              for (const country of data.countries) {
                for (const reg of country.regions) {
                  const hasOnlyUnmatched =
                    reg.cities.length > 0 && reg.cities.every((ct) => !matchedCityCodes.has(ct.code));
                  if (country.code !== 'CHN' || reg.code === 'CN-710000' || hasOnlyUnmatched) {
                    const rf = regionFeatures.find((f) => (f.properties as { code?: string })?.code === reg.code);
                    if (rf) {
                      cityCountMap.set(reg.code, reg.activity_count);
                      cityFeatures.push(rf);
                    }
                  }
                }
              }
            }
            cachedCityFeatures = cityFeatures;

            litCityMesh.geometry.dispose();
            if (cityFeatures.length) {
              litCityMesh.geometry = makeGeometry(
                geoUtil.buildSubdividedPolygons(cityFeatures, 1.0, 0.0, 2.5, 3, (f) => {
                  const code = String((f.properties as { code?: string })?.code ?? '');
                  return tierColor(cityCountMap.get(code) ?? 1, maxCityCount, pal.cityRamp);
                }),
              );
              litCityMesh.visible = true;
            } else {
              litCityMesh.geometry = new THREE.BufferGeometry();
              litCityMesh.visible = false;
            }

            cityMetaMap = new Map<string, CityMetaEntry>();
            if (data) {
              for (const country of data.countries) {
                for (const reg of country.regions) {
                  for (const ct of reg.cities) {
                    cityMetaMap.set(ct.code, { city: ct, region: reg, country });
                  }
                }
              }
            }
            needsRender = true;
          };

          const updateSelectionOutline = () => {
            const selectedFeatures: GeoFeature[] = [];
            if (selectedCityCode) {
              const cf = cachedCityFeatures.find(
                (f) => String((f.properties as { code?: string })?.code) === selectedCityCode,
              );
              if (cf) selectedFeatures.push(cf);
            }
            if (!selectedFeatures.length && selectedRegionCode) {
              const rf = cachedRegionFeatures.find(
                (f) => String((f.properties as { code?: string })?.code) === selectedRegionCode,
              );
              if (rf) selectedFeatures.push(rf);
            }

            activeLineMesh.geometry.dispose();
            if (selectedFeatures.length) {
              activeLineMesh.geometry = makeGeometry(
                geoUtil.buildSubdividedLines(selectedFeatures, 1.0, 0.0, 2.5),
                true,
              );
              activeLineMesh.visible = true;
            } else {
              activeLineMesh.geometry = new THREE.BufferGeometry();
              activeLineMesh.visible = false;
            }
            needsRender = true;
          };

          const setPalette = () => {
            const pal = currentPalette();
            renderer.setClearColor(new THREE.Color().setStyle(pal.ocean, THREE.LinearSRGBColorSpace), 1);
            oceanMat.uniforms.uColor.value.setStyle(pal.ocean, THREE.LinearSRGBColorSpace);
            gratMat.uniforms.uColor.value.setStyle(pal.graticule, THREE.LinearSRGBColorSpace);
            landMat.uniforms.uColor.value.setStyle(pal.land, THREE.LinearSRGBColorSpace);
            borderMat.uniforms.uColor.value.setStyle(pal.border, THREE.LinearSRGBColorSpace);
            activeLineMat.uniforms.uColor.value.setStyle(pal.activeBorder, THREE.LinearSRGBColorSpace);
            globeRimMat.color.setStyle(pal.rim, THREE.LinearSRGBColorSpace);
            rebuildChoropleth();
            needsRender = true;
          };

          const TAN_HALF_FOV = Math.tan((32 * Math.PI) / 360);
          const WORLD_W = geoUtil.MERCATOR_WORLD_WIDTH;

          const clampMercatorPanY = (py: number, dist: number) => {
            const halfH = dist * TAN_HALF_FOV;
            const maxY = Math.max(0, geoUtil.MERCATOR_MAX_Y - halfH);
            return Math.max(-maxY, Math.min(maxY, py));
          };

          const nearestTargetPanX = (targetX: number, currentX: number) => {
            const delta = ((((targetX - currentX + WORLD_W * 1.5) % WORLD_W) + WORLD_W) % WORLD_W) - WORLD_W * 0.5;
            return currentX + delta;
          };

          const wrappedDeltaX = (a: number, b: number) => {
            const delta = ((((a - b + WORLD_W * 1.5) % WORLD_W) + WORLD_W) % WORLD_W) - WORLD_W * 0.5;
            return Math.abs(delta);
          };

          const computeHomeFraming = () => {
            const w = Math.max(260, hostEl.clientWidth || 460);
            const h = Math.max(220, hostEl.clientHeight || 344);
            const aspect = w / h;
            const merged =
              data && data.countries.length ? geoUtil.mergeGeoBounds(data.countries.map((c) => c.bounds)) : null;
            const targetBounds = merged ?? DEFAULT_OVERVIEW_BOUNDS;
            const fitted = geoUtil.fitBoundsMercator2D(targetBounds, aspect, 32, 9.0);
            homePanX = fitted.panX;
            homePanY = clampMercatorPanY(fitted.panY, fitted.dist);
            homeDist = fitted.dist;
            const [cLon, cLat] = geoUtil.mercator2DToLonLat(homePanX, homePanY);
            homeYaw = (-(cLon + 90) * Math.PI) / 180;
            homePitch = (Math.max(-65, Math.min(65, cLat)) * Math.PI) / 180;
          };

          const updateMovedFlag = () => {
            viewMoved =
              projectionMode === 'globe'
                ? Math.abs(camDist - DEFAULT_GLOBE_DIST) > 0.14 ||
                  Math.abs(yaw - homeYaw) > 0.08 ||
                  Math.abs(pitch - homePitch) > 0.08
                : Math.abs(camDist - homeDist) > Math.max(0.01, homeDist * 0.05) ||
                  wrappedDeltaX(panX, homePanX) > 0.008 ||
                  Math.abs(panY - homePanY) > 0.008;
          };

          const tick = () => {
            if (disposed) return;
            if (!dragging && projectionMode === 'globe' && (Math.abs(vYaw) > 0.0001 || Math.abs(vPitch) > 0.0001)) {
              tYaw += vYaw;
              tPitch = Math.max(-1.25, Math.min(1.25, tPitch + vPitch));
              vYaw *= 0.72;
              vPitch *= 0.72;
              needsRender = true;
            }
            const dY = tYaw - yaw;
            const dP = tPitch - pitch;
            const dD = tDist - camDist;
            const dPX = tPanX - panX;
            const dPY = tPanY - panY;
            const dM = tMorph - morph;
            const speed = reducedMotion ? 1.0 : dragging ? 0.38 : 0.18;

            if (
              Math.abs(dY) > 0.0004 ||
              Math.abs(dP) > 0.0004 ||
              Math.abs(dD) > 0.0004 ||
              Math.abs(dPX) > 0.0002 ||
              Math.abs(dPY) > 0.0002 ||
              Math.abs(dM) > 0.001
            ) {
              yaw += reducedMotion ? dY : dY * speed;
              pitch += reducedMotion ? dP : dP * speed;
              camDist += reducedMotion ? dD : dD * (dragging ? 0.18 : 0.16);
              panX += reducedMotion ? dPX : dPX * speed;
              panY += reducedMotion ? dPY : dPY * speed;
              morph += reducedMotion || Math.abs(dM) < 0.004 ? dM : dM * 0.2;
              if (morph >= 0.96 && Math.abs(panX) > WORLD_W * 0.5) {
                const shift = Math.round(panX / WORLD_W) * WORLD_W;
                panX -= shift;
                tPanX -= shift;
              }
              needsRender = true;
            }

            if (needsRender) {
              const useDepth = morph < 0.98;
              for (const mat of morphMaterials) {
                mat.uniforms.uMorph.value = morph;
                mat.depthTest = useDepth;
              }

              yawGroup.rotation.y = yaw * (1 - morph);
              pitchGroup.rotation.x = pitch * (1 - morph);
              globeRim.visible = morph < 0.08;
              camera.position.set(panX * morph, panY * morph, camDist);

              renderer.clear();
              if (morph >= 0.96) {
                const halfH = camDist * TAN_HALF_FOV;
                const halfW = halfH * camera.aspect;
                const halfWorld = WORLD_W * 0.5;
                const kMin = Math.floor((panX - halfW + halfWorld) / WORLD_W);
                const kMax = Math.floor((panX + halfW + halfWorld) / WORLD_W);
                for (let k = kMin; k <= kMax; k++) {
                  yawGroup.position.x = k * WORLD_W * morph;
                  renderer.render(scene, camera);
                }
                yawGroup.position.x = 0;
              } else {
                yawGroup.position.x = 0;
                renderer.render(scene, camera);
              }

              updateMovedFlag();
              needsRender = false;
            }
            frameId = requestAnimationFrame(tick);
          };

          const resize = () => {
            if (disposed || !hostEl) return;
            const w = Math.max(260, hostEl.clientWidth || 460);
            const h = Math.max(220, hostEl.clientHeight || 344);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h, false);
            needsRender = true;
          };

          const resizeObserver = new ResizeObserver(resize);
          resizeObserver.observe(hostEl);
          resize();

          const raycaster = new THREE.Raycaster();
          let lastX = 0;
          let lastY = 0;
          let movedPx = 0;

          const onPointerDown = (event: PointerEvent) => {
            dragging = true;
            vYaw = 0;
            vPitch = 0;
            lastX = event.clientX;
            lastY = event.clientY;
            movedPx = 0;
            hostEl.setPointerCapture(event.pointerId);
          };

          const onPointerMove = (event: PointerEvent) => {
            if (!dragging) return;
            const dx = event.clientX - lastX;
            const dy = event.clientY - lastY;
            lastX = event.clientX;
            lastY = event.clientY;
            movedPx += Math.hypot(dx, dy);
            if (projectionMode === 'globe') {
              const altitudeRatio = Math.max(0.02, (camDist - 1.0) / (DEFAULT_GLOBE_DIST - 1.0));
              const sensitivity = 0.0014 * Math.min(1.15, altitudeRatio);
              const stepYaw = Math.max(-0.04, Math.min(0.04, dx * sensitivity));
              const stepPitch = Math.max(-0.04, Math.min(0.04, dy * sensitivity));
              tYaw += stepYaw;
              tPitch = Math.max(-1.25, Math.min(1.25, tPitch + stepPitch));
              vYaw = Math.max(-0.012, Math.min(0.012, stepYaw * 0.18));
              vPitch = Math.max(-0.012, Math.min(0.012, stepPitch * 0.18));
            } else {
              const stageH = Math.max(220, hostEl.clientHeight || 344);
              const visibleH = 2 * tDist * TAN_HALF_FOV;
              const worldPerPx = (visibleH / stageH) * 0.62;
              tPanX -= dx * worldPerPx;
              tPanY = clampMercatorPanY(tPanY + dy * worldPerPx, tDist);
            }
            needsRender = true;
          };

          const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            const unitScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 240 : 1;
            const rawDelta = event.deltaY * unitScale;
            if (!rawDelta) return;
            const clampedDelta = Math.max(-55, Math.min(55, rawDelta));
            const factor = Math.exp(clampedDelta * 0.0006);
            if (projectionMode === 'globe') {
              const prevSurf = Math.max(0.045, tDist - 1.0);
              const nextSurf = Math.max(0.045, Math.min(4.2, prevSurf * factor));
              const nextDist = 1.0 + nextSurf;
              if (Math.abs(nextDist - tDist) < 1e-6) return;
              tDist = nextDist;
              needsRender = true;
              return;
            }
            const prevDist = tDist;
            const nextDist = Math.max(0.024, Math.min(4.6, prevDist * factor));
            if (Math.abs(nextDist - prevDist) < 1e-6) return;

            const rect = hostEl.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const ndcX = (2 * (event.clientX - rect.left)) / rect.width - 1;
              const ndcY = 1 - (2 * (event.clientY - rect.top)) / rect.height;
              const aspect = rect.width / rect.height;
              const deltaH = (prevDist - nextDist) * TAN_HALF_FOV;
              tPanX += ndcX * deltaH * aspect;
              tPanY = clampMercatorPanY(tPanY + ndcY * deltaH, nextDist);
            }
            tDist = nextDist;
            needsRender = true;
          };

          const onPointerUp = (event: PointerEvent) => {
            if (!dragging) return;
            dragging = false;
            if (movedPx < 6 && data) {
              const rect = hostEl.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                const ndcX = (2 * (event.clientX - rect.left)) / rect.width - 1;
                const ndcY = 1 - (2 * (event.clientY - rect.top)) / rect.height;

                let lon = 0;
                let lat = 0;
                let picked = false;
                if (projectionMode === 'globe') {
                  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
                  pickSphere.visible = true;
                  pickSphere.updateMatrixWorld(true);
                  const hits = raycaster.intersectObject(pickSphere, false);
                  pickSphere.visible = false;
                  if (hits.length) {
                    const localPt = yawGroup.worldToLocal(hits[0].point.clone()).normalize();
                    [lon, lat] = geoUtil.spherePointToLonLat(localPt.x, localPt.y, localPt.z);
                    picked = true;
                  }
                } else {
                  const stageH = rect.height;
                  const visibleH = 2 * camDist * TAN_HALF_FOV;
                  const visibleW = visibleH * (rect.width / stageH);
                  const wx = panX + ndcX * (visibleW * 0.5);
                  const wy = panY + ndcY * (visibleH * 0.5);
                  const [rawLon, rawLat] = geoUtil.mercator2DToLonLat(wx, wy);
                  lon = ((((rawLon + 180) % 360) + 360) % 360) - 180;
                  lat = rawLat;
                  picked = true;
                }

                if (picked) {
                  // 1) Prefer lit city polygon hit at cursor coordinates
                  const hitCity = cachedCityFeatures.find((f) => geoUtil.pointInGeoFeature(lon, lat, f));
                  const hitCityCode = (hitCity?.properties as { code?: string } | undefined)?.code;
                  const cityEntry = hitCityCode ? cityMetaMap.get(hitCityCode) : undefined;
                  if (cityEntry) {
                    selectCity(cityEntry.city, cityEntry.region.code, cityEntry.country.code);
                    return;
                  }

                  // 2) Fallback: pick lit province/state polygon
                  const hitFeature = cachedRegionFeatures.find((f) => geoUtil.pointInGeoFeature(lon, lat, f));
                  const hitCode = (hitFeature?.properties as { code?: string; country_code?: string } | undefined)
                    ?.code;
                  const hitCountryCode = (
                    hitFeature?.properties as { code?: string; country_code?: string } | undefined
                  )?.country_code;
                  const country = data.countries.find((c) => c.code === hitCountryCode);
                  const region = country?.regions.find((r) => r.code === hitCode);
                  if (region && country) selectRegion(region, country.code);
                }
              }
            }
          };

          const onPointerCancel = () => {
            dragging = false;
          };

          hostEl.tabIndex = 0;
          hostEl.addEventListener('pointerdown', onPointerDown);
          hostEl.addEventListener('pointermove', onPointerMove);
          hostEl.addEventListener('pointerup', onPointerUp);
          hostEl.addEventListener('pointercancel', onPointerCancel);
          hostEl.addEventListener('wheel', onWheel, { passive: false });
          hostEl.addEventListener('keydown', handleCanvasKeydown);

          sceneHandle = {
            applyTheme: setPalette,
            syncData: (reframe) => {
              rebuildChoropleth();
              updateSelectionOutline();
              if (reframe) {
                computeHomeFraming();
                if (projectionMode === 'mercator') {
                  tPanX = panX = homePanX;
                  tPanY = panY = homePanY;
                  tDist = camDist = homeDist;
                } else {
                  tYaw = yaw = homeYaw;
                  tPitch = pitch = homePitch;
                  tDist = camDist = DEFAULT_GLOBE_DIST;
                }
              }
              needsRender = true;
            },
            syncSelection: updateSelectionOutline,
            focusBounds: (bounds, minSpanDeg, _center, _globeDist) => {
              const w = Math.max(260, hostEl.clientWidth || 460);
              const h = Math.max(220, hostEl.clientHeight || 344);
              const aspect = w / h;
              if (projectionMode === 'globe') {
                const fitted = geoUtil.fitBoundsGlobe3D(bounds, aspect, 32, minSpanDeg);
                const target = (-(fitted.lon + 90) * Math.PI) / 180;
                tYaw += Math.atan2(Math.sin(target - tYaw), Math.cos(target - tYaw));
                tPitch = (Math.max(-68, Math.min(68, fitted.lat)) * Math.PI) / 180;
                tDist = fitted.dist;
                vYaw = 0;
                vPitch = 0;
              } else {
                const fitted = geoUtil.fitBoundsMercator2D(bounds, aspect, 32, minSpanDeg);
                tPanX = nearestTargetPanX(fitted.panX, panX);
                tPanY = clampMercatorPanY(fitted.panY, fitted.dist);
                tDist = fitted.dist;
              }
              needsRender = true;
            },
            zoomBy: (factor) => {
              if (projectionMode === 'globe') {
                const prevSurf = Math.max(0.045, tDist - 1.0);
                tDist = 1.0 + Math.max(0.045, Math.min(4.2, prevSurf * factor));
              } else {
                tDist = Math.max(0.024, Math.min(4.6, tDist * factor));
                tPanY = clampMercatorPanY(tPanY, tDist);
              }
              needsRender = true;
            },
            setMode: (mode) => {
              tMorph = mode === 'mercator' ? 1 : 0;
              if (mode === 'mercator') {
                computeHomeFraming();
                tPanX = homePanX;
                tPanY = homePanY;
                tDist = homeDist;
              } else {
                tYaw = homeYaw;
                tPitch = homePitch;
                tDist = DEFAULT_GLOBE_DIST;
              }
              needsRender = true;
            },
            resetView: () => {
              computeHomeFraming();
              if (projectionMode === 'globe') {
                tYaw = homeYaw;
                tPitch = homePitch;
                tDist = DEFAULT_GLOBE_DIST;
                vYaw = 0;
                vPitch = 0;
              } else {
                tPanX = nearestTargetPanX(homePanX, panX);
                tPanY = homePanY;
                tDist = homeDist;
              }
              needsRender = true;
            },
            nudgeRotation: (dYaw, dPitch) => {
              if (projectionMode === 'globe') {
                const scale = Math.max(0.04, (camDist - 1.0) / (DEFAULT_GLOBE_DIST - 1.0));
                tYaw += dYaw * scale;
                tPitch = Math.max(-1.25, Math.min(1.25, tPitch + dPitch * scale));
              } else {
                const step = camDist * 0.14;
                tPanX -= dYaw * step;
                tPanY = clampMercatorPanY(tPanY + dPitch * step, tDist);
              }
              needsRender = true;
            },
          };

          cleanupThree = () => {
            cancelAnimationFrame(frameId);
            resizeObserver.disconnect();
            hostEl.removeEventListener('pointerdown', onPointerDown);
            hostEl.removeEventListener('pointermove', onPointerMove);
            hostEl.removeEventListener('pointerup', onPointerUp);
            hostEl.removeEventListener('pointercancel', onPointerCancel);
            hostEl.removeEventListener('wheel', onWheel);
            hostEl.removeEventListener('keydown', handleCanvasKeydown);
            oceanMesh.geometry.dispose();
            gratGeo.dispose();
            landGeo.dispose();
            borderGeo.dispose();
            litRegMesh.geometry.dispose();
            litCityMesh.geometry.dispose();
            activeLineMesh.geometry.dispose();
            globeRim.geometry.dispose();
            pickSphereGeo.dispose();
            pickSphereMat.dispose();
            globeRimMat.dispose();
            for (const m of morphMaterials) m.dispose();
            renderer.dispose();
            renderer.domElement.remove();
          };

          setPalette();
          computeHomeFraming();
          panX = tPanX = homePanX;
          panY = tPanY = homePanY;
          camDist = tDist = homeDist;
          yaw = tYaw = homeYaw;
          pitch = tPitch = homePitch;
          updateSelectionOutline();
          mapReady = true;
          frameId = requestAnimationFrame(tick);
        } catch {
          // Graceful fallback keeps stats and HTML country/region/city rails accessible when WebGL is unavailable.
        }
      })();
    };

    const stopWaiting = whenNearViewport(stageEl, startScene);

    return () => {
      disposed = true;
      stopWaiting();
      stopTheme();
      cleanupThree?.();
      sceneHandle = undefined;
    };
  });

  onDestroy(() => {
    disposed = true;
  });
</script>

<section class="province-map-card" aria-label="足迹地图" aria-busy={loading}>
  <div class="map-heading">
    <div>
      <p class="eyebrow">用脚步点亮地图</p>
      <h2>足迹地图</h2>
      <p class="map-year" data-testid="global-summary">
        {#if data && data.region_count > 0}
          全部时间 · 累计点亮 <strong>{data.region_count}</strong> 个省/州、<strong>{data.city_count}</strong> 座城市
        {:else}
          全部时间 · 累计全球省市足迹
        {/if}
      </p>
    </div>
  </div>

  {#if loading}
    <FeedbackState kind="loading" title="正在读取全球足迹…" />
  {:else if error}
    <FeedbackState kind="error" title={error}>
      <button type="button" class="button-secondary" onclick={() => refresh++}>重试足迹地图</button>
    </FeedbackState>
  {/if}

  <div bind:this={stageEl} class="globe-stage">
    <div
      bind:this={hostEl}
      class="globe-canvas"
      role="region"
      aria-label={`全部时间全球省市足迹视图，已点亮 ${data?.region_count ?? 0} 个省/州、${data?.city_count ?? 0} 座城市`}
      data-testid={mapReady ? 'global-map-ready' : 'global-map-loading'}
    ></div>

    <div class="stage-top-left">
      <button
        type="button"
        class="button-secondary proj-toggle-btn"
        aria-label={projectionMode === 'mercator' ? '切换为 3D 地球' : '切换为 2D 平面地图'}
        aria-pressed={projectionMode === 'globe'}
        title={projectionMode === 'mercator' ? '切换为 3D 地球' : '切换为 2D 平面地图'}
        onclick={() => switchProjection(projectionMode === 'mercator' ? 'globe' : 'mercator')}
      >
        {#if projectionMode === 'globe'}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M3.6 9h16.8M3.6 15h16.8M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18" />
          </svg>
          <span>3D</span>
        {:else}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Zm6-2v14m6-12v14" />
          </svg>
          <span>2D</span>
        {/if}
      </button>
    </div>

    <div class="stage-top-right">
      <div class="maplibregl-ctrl-group globe-zoom-ctrl">
        <button
          type="button"
          class="maplibregl-ctrl-zoom-in"
          aria-label="放大地图"
          disabled={!mapReady}
          onclick={() => sceneHandle?.zoomBy(0.86)}
        >
          <span class="zoom-glyph" aria-hidden="true">+</span>
        </button>
        <button
          type="button"
          class="maplibregl-ctrl-zoom-out"
          aria-label="缩小地图"
          disabled={!mapReady}
          onclick={() => sceneHandle?.zoomBy(1.16)}
        >
          <span class="zoom-glyph" aria-hidden="true">−</span>
        </button>
      </div>
    </div>

    <div class="stage-bottom-left">
      <button
        type="button"
        class="button-secondary locate-button"
        aria-label="回到全局"
        title="回到全局"
        disabled={!mapReady || !viewMoved}
        onclick={resetGlobalView}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3.5" /><circle cx="12" cy="12" r="8" /><path
            d="M12 1.5v3 M12 19.5v3 M1.5 12h3 M19.5 12h3"
          />
        </svg>
      </button>
    </div>

    {#if activeFocus}
      <div class="stage-focus-pill" data-testid="global-focus-pill">
        <strong>{activeFocus.label}</strong>
        <span>{activeFocus.count} 次活动</span>
        {#if activeFocus.km}
          <span>{activeFocus.km}</span>
        {/if}
      </div>
    {/if}
  </div>

  {#if data}
    {#if data.countries.length}
      <div class="nav-block">
        <div class="country-tabs" role="group" aria-label="已点亮国家或地区" onwheel={horizontalWheel}>
          {#each data.countries as country}
            <button
              type="button"
              class="footprint-chip country-tab"
              aria-pressed={selectedCountry?.code === country.code}
              onclick={() => selectCountry(country)}
            >
              <span>{country.name}</span>
              <span class="tab-count">{country.region_count}</span>
            </button>
          {/each}
        </div>

        {#if selectedCountry?.regions.length}
          <div
            class="pill-rail"
            role="group"
            aria-label={`${selectedCountry.name}已点亮省/州`}
            onwheel={horizontalWheel}
          >
            {#each selectedCountry.regions as region}
              <button
                type="button"
                class="footprint-chip region-pill"
                aria-pressed={selectedRegion?.code === region.code}
                onclick={() => selectRegion(region)}
              >
                <span>{region.short_name}</span>
                {#if region.cities.length}
                  <span class="pill-count">{region.cities.length}</span>
                {/if}
                <span class="sr-only">，已点亮，{region.activity_count} 次活动</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if selectedRegion?.cities.length}
          <div
            class="city-strip"
            role="group"
            aria-label={`${selectedRegion.short_name}已点亮城市`}
            onwheel={horizontalWheel}
          >
            <span class="city-label">城市</span>
            {#each selectedRegion.cities as city}
              <button
                type="button"
                class="footprint-chip city-link"
                aria-pressed={selectedCityCode === city.code}
                onclick={() => selectCity(city)}
              >
                <span>{city.name}</span>
                <span class="sr-only">，{city.activity_count} 次活动</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <p class="empty-map">还没有点亮地区，新的跑步路线会留下你的全球足迹。</p>
    {/if}
  {/if}

  <a href={view.href('/footprints')} class="map-link">
    探索详细路线 <span aria-hidden="true">→</span>
  </a>
</section>

<style>
  .province-map-card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: var(--space-4);
    background: var(--surface);
  }
  .map-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .eyebrow {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    margin-bottom: 0.25rem;
  }
  h2 {
    font-size: var(--text-section);
    font-weight: var(--weight-semibold);
  }
  .map-year {
    margin-top: 0.35rem;
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .map-year strong {
    color: var(--primary);
    font-weight: var(--weight-semibold);
  }
  .globe-stage {
    position: relative;
    overflow: hidden;
    height: 21.5rem;
    margin: 0.75rem 0 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
  }
  .globe-canvas {
    width: 100%;
    height: 100%;
    display: block;
    cursor: grab;
    touch-action: none;
    outline: none;
  }
  .globe-canvas:active {
    cursor: grabbing;
  }
  .globe-canvas:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
    border-radius: var(--radius-control);
  }
  .stage-top-left {
    position: absolute;
    top: 0.75rem;
    left: 0.75rem;
    z-index: 3;
  }
  .proj-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    background: var(--surface);
  }
  .stage-top-right {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    z-index: 3;
  }
  .stage-bottom-left {
    position: absolute;
    bottom: 0.75rem;
    left: 0.75rem;
    z-index: 3;
  }
  .locate-button {
    width: 2.75rem;
    padding: 0;
  }
  .zoom-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-card);
    font-weight: var(--weight-medium);
    line-height: var(--line-height-solid);
    color: var(--foreground);
  }
  .stage-focus-pill {
    position: absolute;
    right: 0.75rem;
    bottom: 0.75rem;
    z-index: 3;
    display: inline-flex;
    align-items: baseline;
    gap: 0.45rem;
    padding: 0.35rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .stage-focus-pill strong {
    color: var(--foreground);
    font-weight: var(--weight-semibold);
  }
  .nav-block {
    padding-top: 0.65rem;
    display: grid;
    gap: 0.45rem;
  }
  .country-tabs {
    display: flex;
    flex-wrap: nowrap;
    gap: 1.15rem;
    overflow-x: auto;
    scrollbar-width: none;
    border-bottom: 1px solid var(--border);
  }
  .country-tabs::-webkit-scrollbar {
    display: none;
  }
  .country-tab {
    flex: 0 0 auto;
    position: relative;
    border: 0;
    background: transparent;
    padding: 0.3rem 0.1rem 0.45rem;
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    color: var(--muted-foreground);
    cursor: pointer;
    white-space: nowrap;
    display: inline-flex;
    align-items: baseline;
    gap: 0.3rem;
  }
  .tab-count {
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    opacity: 0.72;
    font-variant-numeric: tabular-nums;
  }
  .country-tab[aria-pressed='true'] {
    color: var(--primary);
  }
  .country-tab[aria-pressed='true']::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    border-radius: 2px;
    background: var(--primary);
  }
  .pill-rail {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.4rem;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 0.05rem 0;
  }
  .pill-rail::-webkit-scrollbar {
    display: none;
  }
  .region-pill {
    flex: 0 0 auto;
    border: 1px solid transparent;
    background: var(--primary-soft);
    color: var(--primary);
    border-radius: var(--radius-pill);
    min-height: 2rem;
    padding: 0.25rem 0.75rem;
    font-size: var(--text-caption);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    transition:
      border-color var(--transition-control),
      background-color var(--transition-control);
  }
  .pill-count {
    opacity: 0.72;
    font-variant-numeric: tabular-nums;
  }
  .region-pill[aria-pressed='true'] {
    border-color: var(--primary);
  }
  .city-strip {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.25rem;
    overflow-x: auto;
    scrollbar-width: thin;
    padding-bottom: 0.1rem;
  }
  .city-label {
    flex: 0 0 auto;
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    margin-right: 0.25rem;
  }
  .city-link {
    flex: 0 0 auto;
    border: 1px solid transparent;
    background: transparent;
    color: var(--foreground);
    border-radius: var(--radius-pill);
    min-height: 1.75rem;
    padding: 0.15rem 0.55rem;
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
  }
  .city-link:hover {
    background: var(--muted);
  }
  .city-link[aria-pressed='true'] {
    background: var(--muted);
    border-color: var(--border);
    color: var(--primary);
    font-weight: var(--weight-semibold);
  }
  .empty-map {
    font-size: var(--text-caption);
    line-height: var(--line-height-body);
    color: var(--muted-foreground);
    margin-top: 0.65rem;
  }
  .map-link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--text-small);
    font-weight: var(--weight-semibold);
    color: var(--primary);
    margin-top: auto;
    padding-top: 0.65rem;
    min-height: 44px;
  }
  @media (max-width: 639px) {
    .province-map-card {
      padding: 1.15rem;
    }
    .globe-stage {
      height: 17.5rem;
    }
  }
</style>
