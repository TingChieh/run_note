<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ActivityError } from '#lib/api/activities.ts';
  import {
    readGlobalFootprints as scoped_readGlobalFootprints,
    type GlobalFootprintCity,
    type GlobalFootprintCountry,
    type GlobalFootprintRegion,
    type GlobalFootprints,
  } from '#lib/api/milestones.ts';
  import { GLOBAL_MAP_PALETTE } from '#lib/map/footprint-colors.ts';
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
  // A long lens: at regional zoom a wide one bulges the globe like a fisheye, which the switch to the flat map
  // then has to undo. Distance limits scale with it (see fovReach).
  const FOV_DEG = 12;
  // Share of the half field of view the globe's radius may fill; the rest leaves room for the halo.
  const GLOBE_FILL = 0.82;
  const HALO_INNER = 0.86;
  // Halftone land: dots sit about this many px apart on the home globe (spacing clamped in degrees), so a
  // phone's smaller globe is not denser than a desktop's.
  const DOT_GAP_PX = 3.1;
  const DOT_SPACING_RANGE: [number, number] = [1.2, 2.0];
  // Zoom bands in screen px per degree. Zooming in, the land fades in first, underneath the still solid dots,
  // and only then do the dots fade out, so something solid is on screen throughout (two half-faded layers at
  // once read as a pale flash).
  const DETAIL_PX_PER_DEG: [number, number] = [3.5, 5.5];
  const DOT_FADE_PX_PER_DEG: [number, number] = [5, 7];
  // Lit dots are drawn larger so a visited region reads as a bold cluster, not a few recoloured specks;
  // the selected place a little larger again.
  const LIT_DOT_SCALE = 1.5;
  const SELECTED_DOT_SCALE = 1.8;
  // First appearance: visited dots light up one after another over this long.
  const REVEAL_MS = 1400;
  // 2D/3D switch: one flight. The shape follows altitude through a band ending at the 2D home view and spanning
  // this zoom ratio, so it changes only while the camera moves, in step with it, at regional zoom.
  const SWITCH_MS = 1100;
  const MORPH_BAND = 2;
  // Last chosen view, kept on this device (3D unless the viewer chose 2D).
  const VIEW_KEY = 'runnote-footprint-view';
  // Idle globe: after this long without input it turns eastward at this speed (rad/ms, about 4°/s), but only
  // while it is seen whole enough to read as a globe (altitude above this share of the home altitude).
  const SPIN_IDLE_MS = 3500;
  const SPIN_SPEED = 0.00007;
  const SPIN_MIN_ALT_SHARE = 0.45;
  const DEFAULT_LON = 106;
  const DEFAULT_LAT = 32;

  let stageEl: HTMLDivElement;
  let hostEl: HTMLDivElement;
  let disposed = false;
  let mapReady = $state(false);
  let dark = $state(false);
  let projectionMode = $state<ProjectionMode>('globe');

  let data = $state<GlobalFootprints | null>(null);
  let loading = $state(true);
  let error = $state('');
  let refresh = $state(0);

  let selectedCountryCode = $state('');
  let selectedRegionCode = $state('');
  let selectedCityCode = $state('');
  let viewMoved = $state(false);
  // Desktop hover hint over a visited place; the rails below stay the accessible way to reach the same data.
  let hoverTip = $state<{ label: string; detail: string; x: number; y: number; flip: boolean; below: boolean } | null>(
    null,
  );

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
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // The choice still applies to this page when storage is unavailable.
    }
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
    try {
      if (localStorage.getItem(VIEW_KEY) === 'mercator') projectionMode = 'mercator';
    } catch {
      // Without storage the map opens in 3D.
    }
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
          // WebGL drawn on the CPU (no GPU: SwiftShader, llvmpipe) makes every frame expensive enough to slow
          // the whole page, so there the globe draws at 1x and does not spin on its own.
          const softwareGl = (() => {
            try {
              const gl = renderer.getContext();
              const info = gl.getExtension('WEBGL_debug_renderer_info');
              const name = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
              return /swiftshader|llvmpipe|software/i.test(String(name));
            } catch {
              return false;
            }
          })();
          renderer.setPixelRatio(softwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
          renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
          hostEl.appendChild(renderer.domElement);
          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera(FOV_DEG, 1.35, 0.02, 40);

          const pitchGroup = new THREE.Group();
          const yawGroup = new THREE.Group();
          pitchGroup.add(yawGroup);
          scene.add(pitchGroup);

          // One view space for both projections. The camera always looks straight down -z from (0, 0, 1 + alt).
          // The globe is rotated (uRot) to bring the view centre to (0, 0, 1); the flat map is shifted (uPan) to
          // put the same centre at the same point, lifted to z = 1. Each vertex morphs between the two, so the
          // centre stays put while the globe unrolls around it.
          const viewUniforms = {
            uRot: { value: new THREE.Matrix3() },
            uPan: { value: new THREE.Vector2() },
          };
          const rotX = new THREE.Matrix4();
          const rotY = new THREE.Matrix4();
          const rotInverse = new THREE.Matrix3();

          const createMorphMaterial = (
            hex: string,
            doubleSide = false,
            useVertexColor = false,
            isOverlay = true,
            shaded = false,
          ) =>
            new THREE.ShaderMaterial({
              side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
              depthWrite: !isOverlay,
              uniforms: {
                uMorph: { value: 1.0 },
                uColor: { value: new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace) },
                uUseVertColor: { value: useVertexColor ? 1.0 : 0.0 },
                uClipBack: { value: isOverlay ? 1.0 : 0.0 },
                uShade: { value: shaded ? 1.0 : 0.0 },
                uLimbColor: { value: new THREE.Color(0, 0, 0) },
                uLimbStrength: { value: 0.14 },
                uOffset: { value: new THREE.Vector2(0, 0) },
                uRot: viewUniforms.uRot,
                uPan: viewUniforms.uPan,
                uFade: { value: 1.0 },
                uFadeColor: { value: new THREE.Color() },
              },
              vertexShader: `
                attribute vec3 aFlatPos;
                attribute vec3 aVertColor;
                uniform float uMorph;
                uniform vec3 uColor;
                uniform float uUseVertColor;
                uniform vec2 uOffset;
                uniform mat3 uRot;
                uniform vec2 uPan;
                varying vec3 vCol;
                varying float vViewNz;
                void main() {
                  // uOffset shifts only the flat map, so the paper shadow collapses under the land on the globe.
                  vec3 flatPos = vec3(aFlatPos.xy + uOffset - uPan, 1.0 + aFlatPos.z);
                  vec3 p = mix(uRot * position, flatPos, uMorph);
                  vCol = mix(uColor, aVertColor, uUseVertColor);
                  vViewNz = (uRot * normalize(position)).z;
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
                }
              `,
              fragmentShader: `
                uniform float uMorph;
                uniform float uClipBack;
                uniform float uShade;
                uniform vec3 uLimbColor;
                uniform float uLimbStrength;
                uniform float uFade;
                uniform vec3 uFadeColor;
                varying vec3 vCol;
                varying float vViewNz;
                void main() {
                  if (uClipBack > 0.5 && uMorph < 0.98 && vViewNz < -0.015) discard;
                  // The rim fades toward the limb colour so the globe reads as a sphere: darker at night, an
                  // airy haze by day (darkening a pale map turns it grey). The flat map stays unshaded.
                  float rim = (1.0 - smoothstep(0.0, 0.75, vViewNz)) * uLimbStrength * uShade * (1.0 - uMorph);
                  gl_FragColor = vec4(mix(mix(uFadeColor, vCol, uFade), uLimbColor, rim), 1.0);
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
          const oceanMat = createMorphMaterial('#e1ebe6', true, false, false, true);
          const oceanMesh = new THREE.Mesh(makeGeometry(oceanGrid, true), oceanMat);
          oceanMesh.frustumCulled = false;
          oceanMesh.renderOrder = 1;
          yawGroup.add(oceanMesh);

          const landGeo = makeGeometry(geoUtil.buildSubdividedPolygons(worldFeatures, 1.0, 0.0, 4.5, 4), true);
          // The flat map is a paper cut-out: land casts a crisp offset shadow onto the water.
          const landShadowMat = createMorphMaterial('#c6d7e0', true);
          const landShadowMesh = new THREE.Mesh(landGeo, landShadowMat);
          landShadowMesh.frustumCulled = false;
          landShadowMesh.renderOrder = 2;
          yawGroup.add(landShadowMesh);

          const landMat = createMorphMaterial('#ffffff', true, false, true, true);
          const landMesh = new THREE.Mesh(landGeo, landMat);
          landMesh.frustumCulled = false;
          landMesh.renderOrder = 3;
          yawGroup.add(landMesh);

          // Zoomed out, land is a halftone of dots instead of a filled, bordered shape.
          const dotsMat = new THREE.ShaderMaterial({
            depthTest: false,
            depthWrite: false,
            // Opaque-list blending keeps the dots in renderOrder, above the region and city fills.
            blending: THREE.CustomBlending,
            blendSrc: THREE.SrcAlphaFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            blendSrcAlpha: THREE.OneFactor,
            blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
            uniforms: {
              uMorph: { value: 1.0 },
              uOpacity: { value: 1.0 },
              uSize: { value: 1.0 },
              uReveal: { value: 0.0 },
              uFacing: { value: 0.0 },
              uBase: { value: new THREE.Color() },
              uRot: viewUniforms.uRot,
              uPan: viewUniforms.uPan,
            },
            vertexShader: `
              attribute vec3 aFlatPos;
              attribute vec3 aVertColor;
              attribute float aScale;
              attribute float aDelay;
              uniform float uMorph;
              uniform float uSize;
              uniform float uReveal;
              uniform float uFacing;
              uniform vec3 uBase;
              uniform mat3 uRot;
              uniform vec2 uPan;
              varying float vViewNz;
              varying vec3 vCol;
              void main() {
                vViewNz = (uRot * normalize(position)).z;
                // Each lit dot switches on at its own moment during the reveal; unlit dots carry the base colour.
                // While the idle globe turns, visited places glow up as they come round to face the viewer and
                // dim again toward the rim.
                float lit = smoothstep(aDelay * 0.6, aDelay * 0.6 + 0.4, uReveal);
                lit *= mix(1.0, smoothstep(0.15, 0.6, vViewNz), uFacing);
                vCol = mix(uBase, aVertColor, lit);
                vec3 p = mix(uRot * position, vec3(aFlatPos.xy - uPan, 1.0 + aFlatPos.z), uMorph);
                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                // Dots shrink toward the rim, which is most of what makes the halftone read as a sphere.
                float facing = mix(mix(0.3, 1.0, clamp(vViewNz, 0.0, 1.0)), 1.0, uMorph);
                gl_PointSize = uSize * mix(1.0, aScale, lit) * facing / -mv.z;
                gl_Position = projectionMatrix * mv;
              }
            `,
            fragmentShader: `
              uniform float uOpacity;
              uniform float uMorph;
              varying float vViewNz;
              varying vec3 vCol;
              void main() {
                if (uMorph < 0.98 && vViewNz < 0.0) discard;
                float a = 1.0 - smoothstep(0.32, 0.5, length(gl_PointCoord - 0.5));
                if (a <= 0.0) discard;
                gl_FragColor = vec4(vCol, a * uOpacity);
              }
            `,
          });
          // Countries without a country outline (China) exist only as their regions; those regions stand in.
          const outlinedCountries = new Set(
            worldFeatures
              .filter((f) => (f.properties as { kind?: string })?.kind === 'country')
              .map((f) => (f.properties as { code?: string })?.code),
          );
          const dotSources = worldFeatures.filter((f) => {
            const props = f.properties as { kind?: string; country?: string };
            return props?.kind !== 'region' || !outlinedCountries.has(props.country);
          });
          // Stable pseudo-random reveal order, so the same map always lights up the same way.
          const revealDelay = (i: number) => {
            const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
            return x - Math.floor(x);
          };
          const dotSpacingFor = (w: number, h: number) => {
            const pxPerDeg = ((Math.min(w, h) / 2) * GLOBE_FILL * Math.PI) / 180;
            const spacing = Math.round((DOT_GAP_PX / pxPerDeg) * 10) / 10;
            return Math.max(DOT_SPACING_RANGE[0], Math.min(DOT_SPACING_RANGE[1], spacing));
          };
          const dotsMesh = new THREE.Points(new THREE.BufferGeometry(), dotsMat);
          let dotSpacing = 0;
          let dotsGeo = dotsMesh.geometry;
          let dotLonLat: [number, number][] = [];
          const buildDots = (spacing: number) => {
            dotSpacing = spacing;
            dotsGeo.dispose();
            dotsGeo = makeGeometry(geoUtil.buildLandDots(dotSources, spacing, 1.0, 0.0), true);
            const count = dotsGeo.getAttribute('position').count;
            dotsGeo.setAttribute('aScale', new THREE.Float32BufferAttribute(new Float32Array(count).fill(1), 1));
            dotsGeo.setAttribute(
              'aDelay',
              new THREE.Float32BufferAttribute(
                Float32Array.from({ length: count }, (_, i) => revealDelay(i)),
                1,
              ),
            );
            const positions = dotsGeo.getAttribute('position');
            dotLonLat = Array.from({ length: count }, (_, i) =>
              geoUtil.spherePointToLonLat(positions.getX(i), positions.getY(i), positions.getZ(i)),
            );
            dotsMesh.geometry = dotsGeo;
          };
          buildDots(dotSpacingFor(hostEl.clientWidth || 460, hostEl.clientHeight || 344));
          dotsMesh.frustumCulled = false;
          // After the region and city fills (which turn ocean-coloured far out) so the lit dots stay on top.
          dotsMesh.renderOrder = 6.5;
          yawGroup.add(dotsMesh);
          // A visited place smaller than the dot spacing gets one lit dot of its own at its centre.
          const extraDotsMesh = new THREE.Points(new THREE.BufferGeometry(), dotsMat);
          extraDotsMesh.frustumCulled = false;
          extraDotsMesh.renderOrder = 6.6;
          yawGroup.add(extraDotsMesh);

          const borderMat = createMorphMaterial('#d7ded5');
          const borderGeo = makeGeometry(geoUtil.buildSubdividedLines(worldFeatures, 1.0, 0.0, 4.5), true);
          const borderMesh = new THREE.LineSegments(borderGeo, borderMat);
          borderMesh.frustumCulled = false;
          borderMesh.renderOrder = 4;
          yawGroup.add(borderMesh);

          const litRegMat = createMorphMaterial('#cfe8d6', true, true, true, true);
          const litRegMesh = new THREE.Mesh(new THREE.BufferGeometry(), litRegMat);
          litRegMesh.frustumCulled = false;
          litRegMesh.renderOrder = 5;
          litRegMesh.visible = false;
          yawGroup.add(litRegMesh);

          const litCityMat = createMorphMaterial('#227b49', true, true, true, true);
          const litCityMesh = new THREE.Mesh(new THREE.BufferGeometry(), litCityMat);
          litCityMesh.frustumCulled = false;
          litCityMesh.renderOrder = 6;
          litCityMesh.visible = false;
          yawGroup.add(litCityMesh);

          interface CityMetaEntry {
            city: GlobalFootprintCity;
            region: GlobalFootprintRegion;
            country: GlobalFootprintCountry;
          }
          let cityMetaMap = new Map<string, CityMetaEntry>();

          // A camera-facing disc on the z = 0 plane, fading out just past the silhouette. Transparent objects
          // draw after the globe, so the depth test is what keeps it behind: every visible globe point has z > 0.
          const haloMat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            uniforms: {
              uColor: { value: new THREE.Color().setStyle('#dbe9e2', THREE.LinearSRGBColorSpace) },
              uOpacity: { value: 0.0 },
              uInner: { value: HALO_INNER },
            },
            vertexShader: `
              varying vec2 vXY;
              void main() {
                vXY = position.xy;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }
            `,
            fragmentShader: `
              uniform vec3 uColor;
              uniform float uOpacity;
              uniform float uInner;
              varying vec2 vXY;
              void main() {
                float fade = 1.0 - smoothstep(uInner, 1.0, length(vXY));
                gl_FragColor = vec4(uColor, fade * fade * uOpacity);
              }
            `,
          });
          const haloGeo = new THREE.CircleGeometry(1, 128);
          const halo = new THREE.Mesh(haloGeo, haloMat);
          halo.frustumCulled = false;
          halo.visible = false;
          scene.add(halo);

          const pickSphereGeo = new THREE.SphereGeometry(1.0, 32, 32);
          const pickSphereMat = new THREE.MeshBasicMaterial();
          const pickSphere = new THREE.Mesh(pickSphereGeo, pickSphereMat);
          pickSphere.visible = false;
          yawGroup.add(pickSphere);

          const morphMaterials = [oceanMat, landShadowMat, landMat, borderMat, litRegMat, litCityMat];
          // Base colours from the palette; land, borders and shadows fade between them as the zoom changes.
          const paletteColor = {
            ocean: new THREE.Color(),
            land: new THREE.Color(),
            landShadow: new THREE.Color(),
            border: new THREE.Color(),
          };
          const shadedMaterials = [oceanMat, landMat, litRegMat, litCityMat];
          const spaceColor = new THREE.Color();
          const oceanColor = new THREE.Color();
          const clearColor = new THREE.Color();

          const defaultYaw = (-(DEFAULT_LON + 90) * Math.PI) / 180;
          const defaultPitch = (DEFAULT_LAT * Math.PI) / 180;

          let homePanX = 0;
          let homePanY = 0;
          let homeDist = 0.85;
          let homeYaw = defaultYaw;
          let homePitch = defaultPitch;
          let homeGlobeDist = 4.3;

          let yaw = homeYaw;
          let pitch = homePitch;
          let camDist = homeDist;
          let tYaw = yaw;
          let tPitch = pitch;
          let tDist = camDist;
          // Fling after a drag, in screen px per ms.
          let flingX = 0;
          let flingY = 0;
          let lastFrameAt = performance.now();
          const stopFling = () => {
            flingX = 0;
            flingY = 0;
          };
          let panX = 0;
          let panY = 0;
          let tPanX = 0;
          let tPanY = 0;
          let morph = projectionMode === 'mercator' ? 1.0 : 0.0;
          let tMorph = morph;
          let dragging = false;
          let needsRender = true;
          let frameId = 0;
          let revealStart = -1;
          // Entering 3D replays the light-up on the dots alone (the fills keep the first reveal).
          let dotRevealStart = -1;
          // Idle spin: current speed (eases in and out), last input, and whether anyone is looking.
          let spin = 0;
          let lastInputAt = performance.now();
          let pointerInside = false;
          let stageVisible = true;
          const visibility = new IntersectionObserver(([entry]) => {
            stageVisible = entry?.isIntersecting ?? true;
          });
          visibility.observe(hostEl);
          // A running 2D/3D switch: one flight of centre and altitude (globe units). The shape follows altitude
          // (morphAt) when the flight crosses the band; input during the flight lands it at its end at once.
          type View = { lon: number; lat: number; alt: number };
          let transition: {
            from: View;
            to: View;
            fromMorph: number;
            toMorph: number;
            band: boolean;
            start: number;
            duration: number;
            alt: number;
          } | null = null;
          // Altitude above the surface at the last render (globe: above the sphere; flat: above the plane).
          let renderAlt = 1;
          // Any input takes the view over: it lands a running switch and restarts the idle-spin timer.
          const takeOver = () => {
            if (transition) finishTransition(transition);
            lastInputAt = performance.now();
          };
          const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
          const lonToYaw = (lon: number) => (-(lon + 90) * Math.PI) / 180;
          const yawToLon = (y: number) => wrapLon((-y * 180) / Math.PI - 90);
          const viewCentre = (): [number, number] =>
            morph >= 0.5
              ? (([lon, lat]) => [wrapLon(lon), lat] as [number, number])(geoUtil.mercator2DToLonLat(panX, panY))
              : [yawToLon(yaw), (pitch * 180) / Math.PI];

          const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

          let cachedCityFeatures: GeoFeature[] = [];
          let cachedRegionFeatures: GeoFeature[] = [];

          const tierColor = (count: number, maxCount: number, ramps: readonly [string, string, string]): RgbTuple => {
            const ratio = maxCount <= 1 ? 1 : Math.log1p(count) / Math.log1p(maxCount);
            const hex = ratio > 0.68 ? ramps[2] : ratio > 0.32 ? ramps[1] : ramps[0];
            return geoUtil.hexToRgb(hex);
          };

          const currentPalette = () => GLOBAL_MAP_PALETTE[dark ? 'dark' : 'light'];

          const rebuildChoropleth = () => {
            const pal = currentPalette();
            const regionFeatures = ((data?.region_features as GeoCollection | undefined)?.features ??
              []) as GeoFeature[];
            cachedRegionFeatures = regionFeatures;

            let maxCityCount = 1;
            if (data) {
              for (const country of data.countries) {
                for (const reg of country.regions) {
                  for (const ct of reg.cities) maxCityCount = Math.max(maxCityCount, ct.activity_count);
                }
              }
            }

            // The selected region is a shade stronger; when a city is selected, the other cities step back
            // toward their region's fill. No outline: emphasis comes from colour alone.
            const regionFill = geoUtil.hexToRgb(pal.region);
            const regionSelectedFill = geoUtil.hexToRgb(pal.regionSelected);
            const featureCode = (f: GeoFeature) => String((f.properties as { code?: string })?.code ?? '');
            litRegMesh.geometry.dispose();
            if (regionFeatures.length) {
              litRegMesh.geometry = makeGeometry(
                geoUtil.buildSubdividedPolygons(regionFeatures, 1.0, 0.0, 3.5, 3, (f) =>
                  featureCode(f) === selectedRegionCode ? regionSelectedFill : regionFill,
                ),
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

            // A region outline doubles as the city shape where city outlines are missing (outside China,
            // Taiwan), so selecting that city selects the region's shape.
            const selectedCityShapes = new Set(
              selectedCityCode
                ? [selectedCityCode, ...(cityCountMap.has(selectedRegionCode) ? [selectedRegionCode] : [])]
                : [],
            );
            const mixRgb = (a: RgbTuple, b: RgbTuple, t: number): RgbTuple => [
              a[0] + (b[0] - a[0]) * t,
              a[1] + (b[1] - a[1]) * t,
              a[2] + (b[2] - a[2]) * t,
            ];
            const cityColor = (code: string, recede: RgbTuple) => {
              const rgb = tierColor(cityCountMap.get(code) ?? 1, maxCityCount, pal.cityRamp);
              return selectedCityShapes.size && !selectedCityShapes.has(code) ? mixRgb(rgb, recede, 0.55) : rgb;
            };

            litCityMesh.geometry.dispose();
            if (cityFeatures.length) {
              litCityMesh.geometry = makeGeometry(
                geoUtil.buildSubdividedPolygons(cityFeatures, 1.0, 0.0, 2.5, 3, (f) =>
                  cityColor(featureCode(f), regionFill),
                ),
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

            // Far out, visited places light up in the halftone itself: dots in a visited region turn green, and
            // dots in a visited city take its activity tier.
            const featureBounds = (f: GeoFeature): GeoBounds => {
              const b: GeoBounds = [180, 90, -180, -90];
              const walk = (c: unknown): void => {
                if (typeof (c as number[])[0] === 'number') {
                  const [lon, lat] = c as [number, number];
                  b[0] = Math.min(b[0], lon);
                  b[1] = Math.min(b[1], lat);
                  b[2] = Math.max(b[2], lon);
                  b[3] = Math.max(b[3], lat);
                } else (c as unknown[]).forEach(walk);
              };
              const geom = f.geometry;
              if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) walk(geom.coordinates);
              return b;
            };
            const withBounds = (list: GeoFeature[]) => list.map((f) => ({ f, b: featureBounds(f) }));
            const regionBoxes = withBounds(regionFeatures);
            const cityBoxes = withBounds(cityFeatures);
            const hit = (boxes: { f: GeoFeature; b: GeoBounds }[], lon: number, lat: number) =>
              boxes.find(
                ({ f, b }) =>
                  lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && geoUtil.pointInGeoFeature(lon, lat, f),
              )?.f;
            const baseRgb = geoUtil.hexToRgb(pal.dot);
            const regionRgb = geoUtil.hexToRgb(pal.dotRegion);
            const regionSelectedRgb = geoUtil.hexToRgb(pal.dotRegionSelected);
            const regionDot = (code: string) =>
              code === selectedRegionCode
                ? { rgb: regionSelectedRgb, scale: SELECTED_DOT_SCALE }
                : { rgb: regionRgb, scale: LIT_DOT_SCALE };
            const cityDot = (code: string) => ({
              rgb: cityColor(code, regionRgb),
              scale: selectedCityShapes.has(code) ? SELECTED_DOT_SCALE : LIT_DOT_SCALE,
            });
            const dotColors = dotsGeo.getAttribute('aVertColor');
            const dotScales = dotsGeo.getAttribute('aScale');
            const litCodes = new Set<string>();
            dotLonLat.forEach(([lon, lat], i) => {
              let dot = { rgb: baseRgb, scale: 1 };
              const city = hit(cityBoxes, lon, lat);
              const region = city ? undefined : hit(regionBoxes, lon, lat);
              if (city) {
                litCodes.add(featureCode(city));
                dot = cityDot(featureCode(city));
              } else if (region) {
                litCodes.add(featureCode(region));
                dot = regionDot(featureCode(region));
              }
              dotColors.setXYZ(i, dot.rgb[0], dot.rgb[1], dot.rgb[2]);
              dotScales.setX(i, dot.scale);
            });
            dotColors.needsUpdate = true;
            dotScales.needsUpdate = true;

            const extra: { lon: number; lat: number; rgb: RgbTuple; scale: number }[] = [];
            for (const country of data?.countries ?? []) {
              for (const reg of country.regions) {
                const unlitCities = reg.cities.filter((ct) => cityCountMap.has(ct.code) && !litCodes.has(ct.code));
                for (const ct of unlitCities) extra.push({ lon: ct.lon, lat: ct.lat, ...cityDot(ct.code) });
                if (!litCodes.has(reg.code) && !reg.cities.some((ct) => litCodes.has(ct.code)) && !unlitCities.length) {
                  extra.push({ lon: reg.center[0], lat: reg.center[1], ...regionDot(reg.code) });
                }
              }
            }
            extraDotsMesh.geometry.dispose();
            const extraGeo = makeGeometry({
              sphere: new Float32Array(extra.flatMap((d) => geoUtil.lonLatToSphere(d.lon, d.lat, 1.0))),
              flat: new Float32Array(extra.flatMap((d) => geoUtil.lonLatToMercator2D(d.lon, d.lat, 0.0))),
              colors: new Float32Array(extra.flatMap((d) => d.rgb)),
            });
            extraGeo.setAttribute(
              'aScale',
              new THREE.Float32BufferAttribute(
                extra.map((d) => d.scale),
                1,
              ),
            );
            extraGeo.setAttribute(
              'aDelay',
              new THREE.Float32BufferAttribute(
                extra.map((_, i) => revealDelay(i + dotLonLat.length)),
                1,
              ),
            );
            extraDotsMesh.geometry = extraGeo;
            needsRender = true;
          };

          const setPalette = () => {
            const pal = currentPalette();
            // The clear colour is converted to sRGB on output (shader materials are not), so read these as sRGB.
            spaceColor.setStyle(pal.space);
            oceanColor.setStyle(pal.ocean);
            for (const mat of shadedMaterials) {
              mat.uniforms.uLimbColor.value.setStyle(pal.limb, THREE.LinearSRGBColorSpace);
              mat.uniforms.uLimbStrength.value = pal.limbStrength;
            }
            oceanMat.uniforms.uColor.value.setStyle(pal.ocean, THREE.LinearSRGBColorSpace);
            paletteColor.ocean.setStyle(pal.ocean, THREE.LinearSRGBColorSpace);
            paletteColor.land.setStyle(pal.land, THREE.LinearSRGBColorSpace);
            paletteColor.landShadow.setStyle(pal.landShadow, THREE.LinearSRGBColorSpace);
            paletteColor.border.setStyle(pal.border, THREE.LinearSRGBColorSpace);
            dotsMat.uniforms.uBase.value.setStyle(pal.dot, THREE.LinearSRGBColorSpace);
            haloMat.uniforms.uColor.value.setStyle(pal.halo, THREE.LinearSRGBColorSpace);
            rebuildChoropleth();
            needsRender = true;
          };

          const HALF_FOV = (FOV_DEG * Math.PI) / 360;
          const TAN_HALF_FOV = Math.tan(HALF_FOV);
          // Zoom limits, defined for a 32° lens and scaled to cover the same visible area with this one.
          const reach = geoUtil.fovReach(TAN_HALF_FOV);
          const clampFlatDist = (dist: number) => Math.max(0.024 * reach, Math.min(4.6 * reach, dist));
          const clampGlobeAlt = (alt: number) => Math.max(0.045 * reach, Math.min((homeGlobeDist - 1) * 1.25, alt));

          // Camera distance at which the whole globe fits inside the narrower field of view.
          const fitGlobeDist = (aspect: number) => {
            const half = Math.min(HALF_FOV, Math.atan(TAN_HALF_FOV * aspect));
            return 1 / Math.sin(half * GLOBE_FILL);
          };
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
            const fitted = geoUtil.fitBoundsMercator2D(targetBounds, aspect, FOV_DEG, 9.0);
            homePanX = fitted.panX;
            homePanY = clampMercatorPanY(fitted.panY, fitted.dist);
            homeDist = fitted.dist;
            const [cLon, cLat] = geoUtil.mercator2DToLonLat(homePanX, homePanY);
            homeYaw = (-(cLon + 90) * Math.PI) / 180;
            homePitch = (Math.max(-65, Math.min(65, cLat)) * Math.PI) / 180;
            homeGlobeDist = fitGlobeDist(aspect);
          };

          const updateMovedFlag = () => {
            viewMoved =
              projectionMode === 'globe'
                ? Math.abs(camDist - homeGlobeDist) > (homeGlobeDist - 1) * 0.04 ||
                  Math.abs(yaw - homeYaw) > 0.08 ||
                  Math.abs(pitch - homePitch) > 0.08
                : Math.abs(camDist - homeDist) > Math.max(0.01, homeDist * 0.05) ||
                  wrappedDeltaX(panX, homePanX) > 0.008 ||
                  Math.abs(panY - homePanY) > 0.008;
          };

          // How much bigger the flat map draws a place than the globe does, at a latitude (Mercator stretch over
          // the map's own scale). Switching keeps the centre's size by converting altitude with this.
          const flatScale = (lat: number) => WORLD_W / (2 * Math.PI) / Math.max(0.2, Math.cos((lat * Math.PI) / 180));

          // The shape as a function of altitude (globe units): a globe above the band, flat at its foot (the 2D
          // home altitude), a smootherstep in log altitude between. The camera's own motion carries the change.
          let bandFoot = 1;
          const morphAt = (alt: number) => {
            const x = Math.min(1, Math.max(0, Math.log((bandFoot * MORPH_BAND) / alt) / Math.log(MORPH_BAND)));
            return x * x * x * (x * (6 * x - 15) + 10);
          };
          // CSS `ease` (cubic-bezier(0.25, 0.1, 0.25, 1)), the curve map fly-overs commonly use.
          const ease = (x: number) => {
            const curve = (t: number, a: number, b: number) =>
              3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
            let t = x;
            for (let i = 0; i < 8; i++) {
              const err = curve(t, 0.25, 0.25) - x;
              const slope = 3 * 0.25 * (1 - t) ** 2 + 6 * (0.25 - 0.25) * t * (1 - t) + 3 * (1 - 0.25) * t * t;
              if (Math.abs(err) < 1e-5 || slope < 1e-6) break;
              t = Math.min(1, Math.max(0, t - err / slope));
            }
            return curve(t, 0.1, 1);
          };

          const stepTransition = (tr: NonNullable<typeof transition>) => {
            const t = tr.duration ? Math.min(1, Math.max(0, (performance.now() - tr.start) / tr.duration)) : 1;
            const s = ease(t);
            const lonStep = ((((tr.to.lon - tr.from.lon + 540) % 360) + 360) % 360) - 180;
            const lon = wrapLon(tr.from.lon + lonStep * s);
            const lat = tr.from.lat + (tr.to.lat - tr.from.lat) * s;
            const globeAlt = Math.exp(Math.log(tr.from.alt) + (Math.log(tr.to.alt) - Math.log(tr.from.alt)) * s);
            if (tr.band) morph = morphAt(globeAlt);
            else {
              // A flight that does not cross the band (a short hop near the ground, say): over its middle.
              const x = Math.min(1, Math.max(0, (s - 0.15) / 0.6));
              morph = tr.fromMorph + (tr.toMorph - tr.fromMorph) * x * x * x * (x * (6 * x - 15) + 10);
            }
            tr.alt = globeAlt * (1 - morph + morph * flatScale(lat));
            yaw = tYaw = lonToYaw(lon);
            pitch = tPitch = (Math.max(-72, Math.min(72, lat)) * Math.PI) / 180;
            const [fx, fy] = geoUtil.lonLatToMercator2D(lon, lat, 0);
            panX = tPanX = fx;
            panY = tPanY = fy;
            needsRender = true;
            if (t >= 1) finishTransition(tr);
          };

          // Puts the view exactly at the end of a switch, in the target projection's own terms.
          const finishTransition = (tr: NonNullable<typeof transition>) => {
            transition = null;
            morph = tMorph = tr.toMorph;
            yaw = tYaw = lonToYaw(tr.to.lon);
            pitch = tPitch = (Math.max(-72, Math.min(72, tr.to.lat)) * Math.PI) / 180;
            const [fx, fy] = geoUtil.lonLatToMercator2D(tr.to.lon, tr.to.lat, 0);
            panX = tPanX = fx;
            if (tr.toMorph) {
              camDist = tDist = tr.to.alt * flatScale(tr.to.lat);
              panY = tPanY = clampMercatorPanY(fy, camDist);
            } else {
              camDist = tDist = 1 + tr.to.alt;
              panY = tPanY = fy;
            }
            needsRender = true;
          };

          const renderFrame = () => {
            const now = performance.now();
            const reveal = revealStart < 0 ? 0 : reducedMotion ? 1 : Math.min(1, (now - revealStart) / REVEAL_MS);
            const replay =
              dotRevealStart < 0 || reducedMotion ? 1 : Math.min(1, Math.max(0, (now - dotRevealStart) / REVEAL_MS));
            const useDepth = morph < 0.98;
            for (const mat of morphMaterials) {
              mat.uniforms.uMorph.value = morph;
              mat.depthTest = useDepth;
            }

            const alt = Math.max(0.005, transition ? transition.alt : morph >= 0.5 ? camDist : camDist - 1);
            renderAlt = alt;
            viewUniforms.uRot.value.setFromMatrix4(rotX.makeRotationX(pitch).multiply(rotY.makeRotationY(yaw)));
            viewUniforms.uPan.value.set(panX, panY);
            camera.position.set(0, 0, 1 + alt);
            // Seen from distance d, the unit sphere's silhouette spans d / sqrt(d² - 1) on the z = 0 plane.
            const eye = 1 + alt;
            const haloOpacity = Math.max(0, 1 - morph * 3);
            halo.visible = haloOpacity > 0;
            if (halo.visible) {
              halo.scale.setScalar(eye / Math.sqrt(eye * eye - 1) / HALO_INNER);
              haloMat.uniforms.uOpacity.value = haloOpacity;
            }

            // How many screen px one degree spans decides between the halftone (far) and silhouettes (near).
            const stageH = Math.max(220, hostEl.clientHeight || 344);
            const pxPerUnit = stageH / 2 / TAN_HALF_FOV;
            const degToRad = Math.PI / 180;
            const mercScale = WORLD_W / (2 * Math.PI);
            const pxPerDeg = (pxPerUnit / Math.max(0.02, alt)) * degToRad * (1 - morph + morph * mercScale);
            const band = ([from, to]: [number, number]) => {
              const t = Math.min(1, Math.max(0, (pxPerDeg - from) / (to - from)));
              return t * t * (3 - 2 * t);
            };
            // The halftone belongs to the globe (its rows are even on the sphere, ragged on a plane), so the
            // flat map is always the paper cut-out.
            const detail = morph + (1 - morph) * band(DETAIL_PX_PER_DEG);
            const dotOpacity = (1 - morph) * (1 - band(DOT_FADE_PX_PER_DEG));
            landMat.uniforms.uColor.value.copy(paletteColor.ocean).lerp(paletteColor.land, detail);
            landShadowMat.uniforms.uColor.value.copy(paletteColor.ocean).lerp(paletteColor.landShadow, detail);
            borderMat.uniforms.uColor.value.copy(paletteColor.ocean).lerp(paletteColor.border, detail);
            borderMesh.visible = detail > 0.01;
            // Fully faded layers are not drawn: far out the world's land mesh, by far the heaviest, is
            // invisible, and skipping it keeps the turning globe cheap.
            landMesh.visible = detail > 0.01;
            landShadowMesh.visible = detail > 0.01 && morph > 0.01;
            dotsMat.uniforms.uOpacity.value = dotOpacity;
            dotsMesh.visible = dotOpacity > 0.01;
            extraDotsMesh.visible = dotsMesh.visible;
            dotsMat.uniforms.uMorph.value = morph;
            dotsMat.uniforms.uSize.value =
              dotSpacing * degToRad * 0.66 * (1 - morph + morph * mercScale) * pxPerUnit * renderer.getPixelRatio();
            // Region and city fills give way to the lit dots far out, and fade up from whatever lies under
            // them during the first reveal.
            const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
            dotsMat.uniforms.uReveal.value = easeOut(Math.min(reveal, replay));
            dotsMat.uniforms.uFacing.value = spin / SPIN_SPEED;
            const fillFade = detail * easeOut(reveal);
            for (const mat of [litRegMat, litCityMat]) {
              mat.uniforms.uFade.value = fillFade;
              mat.uniforms.uFadeColor.value.copy(landMat.uniforms.uColor.value);
            }
            litRegMesh.visible = fillFade > 0.01 && !!litRegMesh.geometry.getAttribute('position');
            litCityMesh.visible = fillFade > 0.01 && !!litCityMesh.geometry.getAttribute('position');
            // The land's shadow keeps a fixed screen offset (down and a little right) whatever the zoom.
            const unitsPerPx = alt / pxPerUnit;
            landShadowMat.uniforms.uOffset.value.set(1 * unitsPerPx, -2.5 * unitsPerPx);

            // Space around the globe blends into the flat map's ocean as the projection morphs.
            renderer.setClearColor(clearColor.copy(spaceColor).lerp(oceanColor, morph), 1);
            renderer.clear();
            if (morph >= 0.96) {
              const halfH = alt * TAN_HALF_FOV;
              const halfW = halfH * camera.aspect;
              const halfWorld = WORLD_W * 0.5;
              const kMin = Math.floor((panX - halfW + halfWorld) / WORLD_W);
              const kMax = Math.floor((panX + halfW + halfWorld) / WORLD_W);
              for (let k = kMin; k <= kMax; k++) {
                yawGroup.position.x = k * WORLD_W;
                renderer.render(scene, camera);
              }
              yawGroup.position.x = 0;
            } else {
              yawGroup.position.x = 0;
              renderer.render(scene, camera);
            }

            updateMovedFlag();
            needsRender = false;
          };

          const tick = () => {
            if (disposed) return;
            const now = performance.now();
            const dt = Math.min(50, now - lastFrameAt);
            lastFrameAt = now;
            if (transition) stepTransition(transition);
            else if (!dragging && (flingX || flingY)) {
              dragBy(flingX * dt, flingY * dt);
              const decay = 0.92 ** (dt / 16);
              flingX *= decay;
              flingY *= decay;
              if (Math.hypot(flingX, flingY) < 0.01) stopFling();
            }
            const canSpin =
              !reducedMotion &&
              !softwareGl &&
              stageVisible &&
              !document.hidden &&
              !pointerInside &&
              projectionMode === 'globe' &&
              !transition &&
              !dragging &&
              !flingX &&
              !flingY &&
              morph < 0.01 &&
              camDist - 1 > (homeGlobeDist - 1) * SPIN_MIN_ALT_SHARE;
            const spinTarget = canSpin && now - lastInputAt > SPIN_IDLE_MS ? SPIN_SPEED : 0;
            spin += (spinTarget - spin) * Math.min(1, dt / 700);
            if (!spinTarget && spin < SPIN_SPEED * 0.01) spin = 0;
            if (spin) {
              tYaw = yaw = yaw + spin * dt;
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
              !transition &&
              (Math.abs(dY) > 0.0004 ||
                Math.abs(dP) > 0.0004 ||
                Math.abs(dD) > 0.0004 ||
                Math.abs(dPX) > 0.0002 ||
                Math.abs(dPY) > 0.0002 ||
                Math.abs(dM) > 0.001)
            ) {
              yaw += reducedMotion ? dY : dY * speed;
              pitch += reducedMotion ? dP : dP * speed;
              camDist += reducedMotion ? dD : dD * 0.24;
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

            const reveal = revealStart < 0 ? 0 : reducedMotion ? 1 : Math.min(1, (now - revealStart) / REVEAL_MS);
            const replay =
              dotRevealStart < 0 || reducedMotion ? 1 : Math.min(1, Math.max(0, (now - dotRevealStart) / REVEAL_MS));
            if ((revealStart >= 0 && reveal < 1) || replay < 1) needsRender = true;

            if (needsRender) renderFrame();
            frameId = requestAnimationFrame(tick);
          };

          const resize = () => {
            if (disposed || !hostEl) return;
            const w = Math.max(260, hostEl.clientWidth || 460);
            const h = Math.max(220, hostEl.clientHeight || 344);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h, false);
            const spacing = dotSpacingFor(w, h);
            if (Math.abs(spacing - dotSpacing) > 0.15) {
              buildDots(spacing);
              rebuildChoropleth();
            }
            needsRender = true;
          };

          const resizeObserver = new ResizeObserver(resize);
          resizeObserver.observe(hostEl);
          resize();

          const raycaster = new THREE.Raycaster();
          let lastX = 0;
          let lastY = 0;
          let movedPx = 0;
          // Recent pointer moves, for the release velocity.
          const dragSamples: { t: number; dx: number; dy: number }[] = [];

          // Moves the view with the pointer, 1:1 at the view centre: the plane by the units a pixel spans, the
          // globe by the arc a pixel spans (wider in longitude away from the equator).
          const dragBy = (dx: number, dy: number) => {
            const pxPerUnit = Math.max(220, hostEl.clientHeight || 344) / 2 / TAN_HALF_FOV;
            const perPx = renderAlt / pxPerUnit;
            if (projectionMode === 'globe') {
              tYaw = yaw = tYaw + (dx * perPx) / Math.max(0.3, Math.cos(tPitch));
              tPitch = pitch = Math.max(-1.25, Math.min(1.25, tPitch + dy * perPx));
            } else {
              tPanX = panX = tPanX - dx * perPx;
              tPanY = panY = clampMercatorPanY(tPanY + dy * perPx, tDist);
            }
            needsRender = true;
          };

          const onPointerDown = (event: PointerEvent) => {
            clearHover();
            takeOver();
            dragging = true;
            stopFling();
            dragSamples.length = 0;
            lastX = event.clientX;
            lastY = event.clientY;
            movedPx = 0;
            hostEl.setPointerCapture(event.pointerId);
          };

          const onPointerMove = (event: PointerEvent) => {
            if (!dragging) {
              if (event.pointerType !== 'mouse') return;
              hoverX = event.clientX;
              hoverY = event.clientY;
              if (!hoverFrame) hoverFrame = requestAnimationFrame(updateHover);
              return;
            }
            const dx = event.clientX - lastX;
            const dy = event.clientY - lastY;
            lastX = event.clientX;
            lastY = event.clientY;
            movedPx += Math.hypot(dx, dy);
            dragBy(dx, dy);
            dragSamples.push({ t: event.timeStamp, dx, dy });
            while (dragSamples.length && event.timeStamp - dragSamples[0].t > 100) dragSamples.shift();
          };

          const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            clearHover();
            takeOver();
            stopFling();
            const unitScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 240 : 1;
            const rawDelta = event.deltaY * unitScale;
            if (!rawDelta) return;
            // A mouse notch (about 100) zooms about a quarter; a trackpad's stream of small deltas zooms smoothly.
            // A trackpad pinch arrives as ctrl + wheel with much smaller deltas, so it gets its own rate.
            const clampedDelta = Math.max(-240, Math.min(240, rawDelta));
            const factor = Math.exp(clampedDelta * (event.ctrlKey ? 0.012 : 0.0022));
            if (projectionMode === 'globe') {
              const prevAlt = clampGlobeAlt(tDist - 1.0);
              const nextAlt = clampGlobeAlt(prevAlt * factor);
              if (Math.abs(nextAlt - prevAlt) < 1e-6) return;
              // Zooming in drifts the centre toward the pointer, so the place under it stays roughly put.
              const target = nextAlt < prevAlt ? pointerLonLat(event.clientX, event.clientY) : null;
              if (target) {
                const pull = Math.min(0.5, 1 - nextAlt / prevAlt);
                const lon = yawToLon(tYaw);
                const lat = (tPitch * 180) / Math.PI;
                const lonStep = ((((target[0] - lon + 540) % 360) + 360) % 360) - 180;
                tYaw += Math.atan2(
                  Math.sin(lonToYaw(lon + lonStep * pull) - tYaw),
                  Math.cos(lonToYaw(lon + lonStep * pull) - tYaw),
                );
                tPitch = (Math.max(-72, Math.min(72, lat + (target[1] - lat) * pull)) * Math.PI) / 180;
                stopFling();
              }
              tDist = 1.0 + nextAlt;
              needsRender = true;
              return;
            }
            const prevDist = tDist;
            const nextDist = clampFlatDist(prevDist * factor);
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

          // [lon, lat] under a screen point, as last rendered.
          const pointerLonLat = (clientX: number, clientY: number): [number, number] | null => {
            if (transition) return null;
            const rect = hostEl.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return null;
            const ndcX = (2 * (clientX - rect.left)) / rect.width - 1;
            const ndcY = 1 - (2 * (clientY - rect.top)) / rect.height;
            if (projectionMode === 'globe') {
              raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
              pickSphere.visible = true;
              pickSphere.updateMatrixWorld(true);
              const hits = raycaster.intersectObject(pickSphere, false);
              pickSphere.visible = false;
              if (!hits.length) return null;
              rotInverse.copy(viewUniforms.uRot.value).transpose();
              const localPt = hits[0].point.clone().applyMatrix3(rotInverse).normalize();
              return geoUtil.spherePointToLonLat(localPt.x, localPt.y, localPt.z);
            }
            const visibleH = 2 * renderAlt * TAN_HALF_FOV;
            const visibleW = visibleH * (rect.width / rect.height);
            const [lon, lat] = geoUtil.mercator2DToLonLat(
              panX + ndcX * (visibleW * 0.5),
              panY + ndcY * (visibleH * 0.5),
            );
            return [wrapLon(lon), lat];
          };

          // The visited city, else the visited region, under a screen point.
          const pickAt = (
            clientX: number,
            clientY: number,
          ): { city?: CityMetaEntry; region?: GlobalFootprintRegion; country?: GlobalFootprintCountry } | null => {
            if (!data) return null;
            const point = pointerLonLat(clientX, clientY);
            if (!point) return null;
            const [lon, lat] = point;
            const hitCity = cachedCityFeatures.find((f) => geoUtil.pointInGeoFeature(lon, lat, f));
            const cityEntry = cityMetaMap.get(String((hitCity?.properties as { code?: string } | undefined)?.code));
            if (cityEntry) return { city: cityEntry };
            const hitFeature = cachedRegionFeatures.find((f) => geoUtil.pointInGeoFeature(lon, lat, f));
            const props = hitFeature?.properties as { code?: string; country_code?: string } | undefined;
            const country = data.countries.find((c) => c.code === props?.country_code);
            const region = country?.regions.find((r) => r.code === props?.code);
            return region && country ? { region, country } : null;
          };

          const onPointerUp = (event: PointerEvent) => {
            if (!dragging) return;
            dragging = false;
            if (movedPx >= 6) {
              // Fling with the speed of the last 80 ms of the drag, unless the pointer had already come to rest.
              const recent = dragSamples.filter((sample) => event.timeStamp - sample.t <= 80);
              if (!reducedMotion && recent.length >= 2 && event.timeStamp - recent[recent.length - 1].t < 40) {
                const elapsed = Math.max(16, event.timeStamp - recent[0].t);
                const speed = (sum: number) => Math.max(-3, Math.min(3, sum / elapsed));
                flingX = speed(recent.reduce((sum, sample) => sum + sample.dx, 0));
                flingY = speed(recent.reduce((sum, sample) => sum + sample.dy, 0));
              }
              return;
            }
            const picked = pickAt(event.clientX, event.clientY);
            if (picked?.city) selectCity(picked.city.city, picked.city.region.code, picked.city.country.code);
            else if (picked?.region && picked.country) selectRegion(picked.region, picked.country.code);
          };

          let hoverFrame = 0;
          let hoverX = 0;
          let hoverY = 0;
          const clearHover = () => {
            cancelAnimationFrame(hoverFrame);
            hoverFrame = 0;
            hoverTip = null;
            hostEl.style.cursor = '';
          };
          const updateHover = () => {
            hoverFrame = 0;
            const picked = pickAt(hoverX, hoverY);
            const rect = hostEl.getBoundingClientRect();
            if (!picked) {
              hoverTip = null;
              hostEl.style.cursor = '';
              return;
            }
            const place = picked.city
              ? {
                  label: `${picked.city.region.short_name} · ${picked.city.city.name}`,
                  count: picked.city.city.activity_count,
                }
              : { label: picked.region!.short_name, count: picked.region!.activity_count };
            const x = hoverX - rect.left;
            const y = hoverY - rect.top;
            hoverTip = {
              label: place.label,
              detail: `${place.count} 次活动`,
              x,
              y,
              flip: x > rect.width - 180,
              below: y < 56,
            };
            hostEl.style.cursor = 'pointer';
          };
          const onHoverEnter = () => {
            pointerInside = true;
          };
          const onHoverLeave = () => {
            pointerInside = false;
            clearHover();
          };

          const onPointerCancel = () => {
            dragging = false;
            stopFling();
          };

          hostEl.tabIndex = 0;
          hostEl.addEventListener('pointerdown', onPointerDown);
          hostEl.addEventListener('pointermove', onPointerMove);
          hostEl.addEventListener('pointerup', onPointerUp);
          hostEl.addEventListener('pointercancel', onPointerCancel);
          hostEl.addEventListener('pointerenter', onHoverEnter);
          hostEl.addEventListener('pointerleave', onHoverLeave);
          hostEl.addEventListener('wheel', onWheel, { passive: false });
          hostEl.addEventListener('keydown', handleCanvasKeydown);

          sceneHandle = {
            applyTheme: setPalette,
            syncData: (reframe) => {
              rebuildChoropleth();
              if (revealStart < 0 && data?.countries.length) revealStart = performance.now();
              if (reframe) {
                takeOver();
                computeHomeFraming();
                if (projectionMode === 'mercator') {
                  tPanX = panX = homePanX;
                  tPanY = panY = homePanY;
                  tDist = camDist = homeDist;
                } else {
                  tYaw = yaw = homeYaw;
                  tPitch = pitch = homePitch;
                  tDist = camDist = homeGlobeDist;
                }
              }
              needsRender = true;
            },
            syncSelection: rebuildChoropleth,
            focusBounds: (bounds, minSpanDeg, _center, _globeDist) => {
              takeOver();
              const w = Math.max(260, hostEl.clientWidth || 460);
              const h = Math.max(220, hostEl.clientHeight || 344);
              const aspect = w / h;
              if (projectionMode === 'globe') {
                const fitted = geoUtil.fitBoundsGlobe3D(bounds, aspect, FOV_DEG, minSpanDeg);
                const target = (-(fitted.lon + 90) * Math.PI) / 180;
                tYaw += Math.atan2(Math.sin(target - tYaw), Math.cos(target - tYaw));
                tPitch = (Math.max(-68, Math.min(68, fitted.lat)) * Math.PI) / 180;
                tDist = fitted.dist;
                stopFling();
              } else {
                const fitted = geoUtil.fitBoundsMercator2D(bounds, aspect, FOV_DEG, minSpanDeg);
                tPanX = nearestTargetPanX(fitted.panX, panX);
                tPanY = clampMercatorPanY(fitted.panY, fitted.dist);
                tDist = fitted.dist;
              }
              needsRender = true;
            },
            zoomBy: (factor) => {
              takeOver();
              stopFling();
              if (projectionMode === 'globe') {
                tDist = 1.0 + clampGlobeAlt((tDist - 1.0) * factor);
              } else {
                tDist = clampFlatDist(tDist * factor);
                tPanY = clampMercatorPanY(tPanY, tDist);
              }
              needsRender = true;
            },
            setMode: (mode) => {
              stopFling();
              const now = performance.now();
              lastInputAt = now;
              computeHomeFraming();
              const [lon, lat] = viewCentre();
              const fromAlt = renderAlt / (1 - morph + morph * flatScale(lat));
              const [flatLon, flatLat] = geoUtil.mercator2DToLonLat(homePanX, homePanY);
              bandFoot = homeDist / flatScale(flatLat);
              const toMorph = mode === 'mercator' ? 1 : 0;
              const to =
                mode === 'mercator'
                  ? { lon: wrapLon(flatLon), lat: flatLat, alt: bandFoot }
                  : { lon: yawToLon(homeYaw), lat: (homePitch * 180) / Math.PI, alt: homeGlobeDist - 1 };
              tMorph = toMorph;
              transition = {
                from: { lon, lat, alt: fromAlt },
                to,
                fromMorph: morph,
                toMorph,
                // Altitude carries the shape when the flight starts and ends on the right sides of the band
                // (this also holds when a running switch is reversed midway).
                band: Math.abs(morphAt(fromAlt) - morph) < 0.02 && morphAt(to.alt) === toMorph,
                start: now,
                duration: reducedMotion ? 0 : SWITCH_MS,
                alt: renderAlt,
              };
              // Into 3D, the footprints light up again as the globe pulls back far enough for the dots to show.
              if (mode === 'globe') dotRevealStart = now + SWITCH_MS * 0.35;
              needsRender = true;
            },
            resetView: () => {
              takeOver();
              computeHomeFraming();
              if (projectionMode === 'globe') {
                tYaw = homeYaw;
                tPitch = homePitch;
                tDist = homeGlobeDist;
                stopFling();
              } else {
                tPanX = nearestTargetPanX(homePanX, panX);
                tPanY = homePanY;
                tDist = homeDist;
              }
              needsRender = true;
            },
            nudgeRotation: (dYaw, dPitch) => {
              takeOver();
              stopFling();
              if (projectionMode === 'globe') {
                const scale = Math.max(0.04, (camDist - 1.0) / (homeGlobeDist - 1.0));
                tYaw += dYaw * scale;
                tPitch = Math.max(-1.25, Math.min(1.25, tPitch + dPitch * scale));
              } else {
                const step = camDist * TAN_HALF_FOV * 0.49;
                tPanX -= dYaw * step;
                tPanY = clampMercatorPanY(tPanY + dPitch * step, tDist);
              }
              needsRender = true;
            },
          };

          cleanupThree = () => {
            cancelAnimationFrame(frameId);
            resizeObserver.disconnect();
            visibility.disconnect();
            hostEl.removeEventListener('pointerdown', onPointerDown);
            hostEl.removeEventListener('pointermove', onPointerMove);
            hostEl.removeEventListener('pointerup', onPointerUp);
            hostEl.removeEventListener('pointercancel', onPointerCancel);
            hostEl.removeEventListener('pointerenter', onHoverEnter);
            hostEl.removeEventListener('pointerleave', onHoverLeave);
            clearHover();
            hostEl.removeEventListener('wheel', onWheel);
            hostEl.removeEventListener('keydown', handleCanvasKeydown);
            oceanMesh.geometry.dispose();
            landGeo.dispose();
            dotsGeo.dispose();
            extraDotsMesh.geometry.dispose();
            dotsMat.dispose();

            borderGeo.dispose();
            litRegMesh.geometry.dispose();
            litCityMesh.geometry.dispose();
            haloGeo.dispose();
            pickSphereGeo.dispose();
            pickSphereMat.dispose();
            haloMat.dispose();
            for (const m of morphMaterials) m.dispose();
            renderer.dispose();
            renderer.domElement.remove();
          };

          setPalette();
          computeHomeFraming();
          panX = tPanX = homePanX;
          panY = tPanY = homePanY;
          camDist = tDist = projectionMode === 'globe' ? homeGlobeDist : homeDist;
          yaw = tYaw = homeYaw;
          pitch = tPitch = homePitch;
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
    </div>
    <div class="map-totals">
      <dl class="map-stats" data-testid="global-summary" aria-label="全部时间累计点亮">
        <div>
          <dt>省/州</dt>
          <dd>{data ? data.region_count : '—'}</dd>
        </div>
        <div>
          <dt>城市</dt>
          <dd>{data ? data.city_count : '—'}</dd>
        </div>
      </dl>
      <p class="map-year">全部时间累计</p>
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

    {#if hoverTip}
      <div
        class="hover-tip"
        class:flip={hoverTip.flip}
        class:below={hoverTip.below}
        style:left={`${hoverTip.x}px`}
        style:top={`${hoverTip.y}px`}
        aria-hidden="true"
        data-testid="global-hover"
      >
        <strong>{hoverTip.label}</strong>
        <span>{hoverTip.detail}</span>
      </div>
    {/if}

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
  </div>

  {#if data}
    {#if data.countries.length}
      <div class="nav-block">
        {#if data.countries.length > 1}
          <div class="country-scroll" onwheel={horizontalWheel}>
            <div class="mode-switch compact-switch" role="group" aria-label="已点亮国家或地区">
              {#each data.countries as country}<button
                  type="button"
                  aria-pressed={selectedCountry?.code === country.code}
                  onclick={() => selectCountry(country)}
                  >{country.name} <span class="tab-count">{country.region_count}</span></button
                >{/each}
            </div>
          </div>
        {/if}

        {#if selectedCountry?.regions.length}
          <div class="chip-row" role="group" aria-label={`${selectedCountry.name}已点亮省/州`}>
            {#each selectedCountry.regions as region}
              <button
                type="button"
                class="footprint-chip"
                aria-pressed={selectedRegion?.code === region.code}
                onclick={() => selectRegion(region)}
              >
                <span>{region.short_name}</span>
                {#if region.cities.length}
                  <span class="chip-count">{region.cities.length}</span>
                {/if}
                <span class="sr-only">，已点亮，{region.activity_count} 次活动</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if activeFocus && selectedRegion}
          <div class="region-detail">
            <p class="focus-line" data-testid="global-focus">
              <strong>{activeFocus.label}</strong>
              <span class="focus-metrics">
                <span><b>{activeFocus.count}</b> 次活动</span>
                {#if activeFocus.km}<span><b>{activeFocus.km.replace(' km', '')}</b> km</span>{/if}
              </span>
            </p>
            {#if selectedRegion.cities.length}
              <div class="chip-row" role="group" aria-label={`${selectedRegion.short_name}已点亮城市`}>
                <span class="city-label">城市</span>
                {#each selectedRegion.cities as city}
                  <button
                    type="button"
                    class="footprint-chip city-chip"
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
        {/if}
      </div>
    {:else}
      <p class="empty-map">还没有点亮地区，新的跑步路线会留下你的全球足迹。</p>
    {/if}
  {/if}
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
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
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
  .map-totals {
    margin-left: auto;
    text-align: right;
  }
  .map-year {
    margin-top: 0.125rem;
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  /* Big number then a small unit, as in the goal cards beside it ("10.2 / 20 km"). */
  .map-stats {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-4);
  }
  .map-stats > div {
    display: flex;
    flex-direction: row-reverse;
    align-items: baseline;
    gap: 0.25rem;
  }
  .map-stats dt {
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .map-stats dd {
    font-size: var(--text-stat);
    font-weight: var(--weight-bold);
    line-height: var(--line-height-tight);
    color: var(--primary);
    font-variant-numeric: tabular-nums;
  }
  .globe-stage {
    position: relative;
    flex: 1 1 auto;
    overflow: hidden;
    min-height: 21.5rem;
    margin-top: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    /* The space around the 3D globe; the flat map paints its own ocean over it. */
    background: var(--background);
  }
  .globe-canvas {
    position: absolute;
    inset: 0;
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
  .hover-tip {
    position: absolute;
    z-index: 4;
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--surface);
    box-shadow: var(--shadow-popover);
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
    transform: translate(0.75rem, calc(-100% - 0.5rem));
  }
  .hover-tip.flip {
    transform: translate(calc(-100% - 0.75rem), calc(-100% - 0.5rem));
  }
  .hover-tip.below {
    transform: translate(0.75rem, 1rem);
  }
  .hover-tip.flip.below {
    transform: translate(calc(-100% - 0.75rem), 1rem);
  }
  .hover-tip strong {
    font-weight: var(--weight-semibold);
    color: var(--foreground);
  }
  .nav-block {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-3);
  }
  /* Room inside the scroller for the switch's glass rim and shadow, which draw past its box; the negative
     margin keeps the layout where it was. */
  .country-scroll {
    overflow-x: auto;
    padding: 0.75rem;
    margin: -0.75rem;
  }
  .tab-count {
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    opacity: 0.72;
    font-variant-numeric: tabular-nums;
  }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  /* Neutral until chosen, so the one selected place stands out instead of a row of equal greens. */
  .footprint-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.25rem;
    padding: 0.25rem 0.875rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--foreground);
    font-size: var(--text-small);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    cursor: pointer;
    transition:
      border-color var(--transition-control),
      background-color var(--transition-control),
      color var(--transition-control);
  }
  .chip-count {
    font-size: var(--text-caption);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  @media (hover: hover) {
    .footprint-chip:not([aria-pressed='true']):hover {
      border-color: var(--control-hover-border);
    }
  }
  .footprint-chip[aria-pressed='true'] {
    border-color: var(--primary);
    background: var(--primary-soft);
    color: var(--primary);
  }
  .footprint-chip[aria-pressed='true'] .chip-count {
    color: inherit;
  }
  .city-chip {
    min-height: 2rem;
    padding: 0.125rem 0.75rem;
  }
  .region-detail {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .focus-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.25rem var(--space-3);
    font-size: var(--text-small);
    color: var(--muted-foreground);
  }
  .focus-line strong {
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
    color: var(--foreground);
  }
  .focus-metrics {
    display: inline-flex;
    gap: var(--space-3);
    font-variant-numeric: tabular-nums;
  }
  .focus-metrics b {
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
    color: var(--foreground);
  }
  .city-label {
    margin-right: 0.25rem;
    font-size: var(--text-caption);
    color: var(--muted-foreground);
  }
  .empty-map {
    font-size: var(--text-caption);
    line-height: var(--line-height-body);
    color: var(--muted-foreground);
    margin-top: var(--space-3);
  }
  /* Beside the goal cards (dashboard two-column layout from 1200px) the map fills whatever height they set. */
  @media (min-width: 1200px) {
    .globe-stage {
      min-height: 14rem;
    }
  }
  @media (max-width: 639px) {
    .province-map-card {
      padding: 1.15rem;
    }
    .globe-stage {
      min-height: 17.5rem;
    }
  }
</style>
