// ========================
// Map Initialization and Configuration
// ========================

mapboxgl.accessToken = 'YOUR_MAPBOX_TOKEN';

// ========================
// URL Parameters Parsing for Initial Map State
// ========================

const urlParams = new URLSearchParams(window.location.search);
const lngParam = parseFloat(urlParams.get('lng'));
const latParam = parseFloat(urlParams.get('lat'));
const zoomParam = parseFloat(urlParams.get('zoom'));

const isValidLng = !isNaN(lngParam) && lngParam >= -180 && lngParam <= 180;
const isValidLat = !isNaN(latParam) && latParam >= -90 && latParam <= 90;
const isValidZoom = !isNaN(zoomParam) && zoomParam >= 0 && zoomParam <= 22;

const initialCenter = (isValidLng && isValidLat) ? [lngParam, latParam] : [-60, 15];
const initialZoom = isValidZoom ? zoomParam : 3;

let userGeoIpCoords = null;
let userGeoIpZoom = 3;

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/disasterdb/cmaycljer005l01sy9qzodnrb',
  center: initialCenter,
  zoom: initialZoom
});

map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
map.addControl(new mapboxgl.ScaleControl(), 'bottom-left');

// Global Variables
let usFirePoints = [];
let australiaFirePoints = [];
let canadaFirePoints = [];
let disasterMarkers = [];
let volcanoMarkers = [];
let activePopup = null;
let historicalFiresActive = false;
let burnedAreasLayerAdded = false; 
let smokeLayerAdded = false;
let userLocationMarker = null;

const BURNED_AREA_VISIBILITY_ZOOM_THRESHOLD = 5;
const SMOKE_LAYER_HIDE_ZOOM_THRESHOLD = 8.5; 

// ========================
// New Feature Notification & Smoke Info Modal
// ========================
function showNewFeatureNotification() {
    const notificationBanner = document.getElementById('newFeatureNotification');
    const notificationBannerContent = document.getElementById('notificationBannerContent');
    const dismissBannerBtn = document.getElementById('dismissNotificationBannerBtn');
    const smokeInfoModal = document.getElementById('smokeInfoModal');
    const closeSmokeInfoModalBtn = document.getElementById('closeSmokeInfoModalBtn');

    if (!notificationBanner || !notificationBannerContent || !dismissBannerBtn || !smokeInfoModal || !closeSmokeInfoModalBtn) {
        console.warn("Notification or smoke modal elements not found.");
        return;
    }
    
    const dismissBanner = () => {
        if (notificationBanner.classList.contains('show')) {
            notificationBanner.classList.remove('show');
            document.body.classList.remove('notification-banner-visible');
            setTimeout(() => {
                notificationBanner.style.display = 'none';
            }, 400);
        }
    };

    notificationBanner.style.display = 'flex';
    document.body.classList.add('notification-banner-visible');
    setTimeout(() => {
      notificationBanner.classList.add('show');
    }, 100);

    notificationBannerContent.onclick = () => {
        dismissBanner();
        smokeInfoModal.classList.add('active');
    };

    dismissBannerBtn.onclick = (e) => {
        e.stopPropagation();
        dismissBanner();
    };

    closeSmokeInfoModalBtn.onclick = () => {
        smokeInfoModal.classList.remove('active');
    };

    window.addEventListener('click', (event) => {
        if (event.target === smokeInfoModal) {
            smokeInfoModal.classList.remove('active');
        }
    });

    setTimeout(() => {
        if (notificationBanner.classList.contains('show')) {
            dismissBanner();
        }
    }, 12000);
}

// ========================
// Helper Functions for Fire Layers
// ========================


// np: FCI footprint quads (LSA SAF MTG FRP pixel footprints). Fill layers
// drape over 3D terrain natively, so this conforms to the VE surface.
// Sits BELOW the hotspot blobs, ABOVE the perimeter layers.
function npAddFCIFootprintLayer() {
    var sourceId = 'fci-footprint';
    var layerId = 'fci-footprint-fill';
    var sourceLayerName = 'europe_fci_footprint';
    var mvtUrl = 'https://geo.firemap.live/geoserver/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=FireDB:europe_fci_footprint&STYLE=&TILEMATRIXSET=EPSG:900913&FORMAT=application/vnd.mapbox-vector-tile&TILEMATRIX=EPSG:900913:{z}&TILECOL={x}&TILEROW={y}';

    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    map.addSource(sourceId, {
        type: 'vector',
        tiles: [mvtUrl],
        minzoom: 4,
        maxzoom: 12
    });

    var beforeId = ['global-firms-hotspots', 'usa-nasa-firms-24hrs-pt', 'combined-fire-points']
        .find(function (id) { return map.getLayer(id); });

    map.addLayer({
        id: layerId,
        type: 'fill',
        source: sourceId,
        'source-layer': sourceLayerName,
        paint: {
            'fill-color': [
                'interpolate', ['linear'],
                ['to-number', ['coalesce', ['get', 'frp'], 0]],
                0,   'rgba(255,200,80,0.18)',
                50,  'rgba(255,150,50,0.30)',
                200, 'rgba(255,100,35,0.42)',
                500, 'rgba(255,60,25,0.55)'
            ],
            'fill-outline-color': 'rgba(0,0,0,0)',
            'fill-antialias': false
        }
    }, beforeId);
}

function getFireLayerPaintProperties() {
  return {
    'circle-radius': ['interpolate',['linear'],['zoom'],0,['match',['get','fire_status'],'Fire of Note',2.23,'Out of Control',1.155,'Out',0.5,'Being Held',1.2,'Under Control',1.2,0.5],12,['match',['get','fire_status'],'Fire of Note',13.781,'Out of Control',7.26,'Out',4.4,'Being Held',7.2,'Under Control',7.2,5]],
    'circle-color': ['match',['get','fire_status'],'Fire of Note','#ff0000','Out of Control','#ff4500','Out','#696969','Being Held','#ff7f50','Under Control','#ff7f50','#ff0000'],
    'circle-stroke-color': ['match',['get','fire_status'],'Fire of Note','#8B0000','Out of Control','#8B0000','Out','#8B0000','Being Held','#ffff00','Under Control','#ffff00','#000000'],
    'circle-stroke-width': ['match',['get','fire_status'],'Fire of Note',2,'Out of Control',2,'Out',1,'Being Held',1,'Under Control',1,1]
  };
}

// ========================
// FireMap Branded Oscillating Pulse Engine
// Fires with fire_status 'Fire of Note' AND heatsigfcidetections_last_hour
// > 0 get an animated two-layer pulse: breathing crimson core + expanding
// dark-red (#8B0000) shockwave ring. One rAF loop drives every pulse layer.
// ========================
const _activePulseLayers = new Set();
let _pulseAnimationId = null;
let _pulseFilterTicker = null;
var NP_PULSE_DURATION_MS = 1750;   // ms per pulse cycle
var NP_PULSE_ZOOM_SCALE = true;    // shrink the fixed px radii when zoomed out
// Optional extra recency clause: heatsigfcidetections_last_hour is baked at
// enrichment time, so if the pipeline lags, stale counts keep points pulsing
// long after the last real FCI heat sig. Flip this on to also require
// heatsigfciacqtime within NP_PULSE_MAX_AGE_MIN minutes (client-checked).
var NP_PULSE_RECENCY_GATE = false;
var NP_PULSE_MAX_AGE_MIN = 60;

// heatsigfciacqtime arrives as a padded 14-digit compact UTC string
// ('YYYYMMDDHHMMSS...'). Parse to epoch ms, or null.
function npParseCompactUtc(v) {
    if (v === null || typeof v === 'undefined') return null;
    var s = String(v).trim();
    if (!/^\d{14}$/.test(s)) return null;
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
                    +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
}

// Cutoff in the same compact format; lexicographic string comparison is
// chronologically correct for this layout, so it works inside a filter.
function npPulseCutoffStr() {
    var d = new Date(Date.now() - NP_PULSE_MAX_AGE_MIN * 60000);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return '' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
           p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
}

// Pulse gate: Fire of Note AND heatsigfcidetections_last_hour > 0.
function npPulseFilter() {
    var f = [
        'all',
        ['==', ['get', 'fire_status'], 'Fire of Note'],
        ['>', ['to-number', ['coalesce', ['get', 'heatsigfcidetections_last_hour'], 0]], 0]
    ];
    if (NP_PULSE_RECENCY_GATE) {
        f.push(['>=', ['coalesce', ['get', 'heatsigfciacqtime'], ''], npPulseCutoffStr()]);
    }
    return f;
}

function _npPulseScale() {
  if (!NP_PULSE_ZOOM_SCALE) return 1;
  var z = map.getZoom();
  if (z >= 8) return 1;
  if (z <= 3) return 0.35;
  return 0.35 + ((z - 3) / 5) * 0.65;
}

function startFirePulseAnimation() {
  if (_pulseAnimationId) return;
  if (typeof requestAnimationFrame !== 'function') return;

  function frame(timestamp) {
    const progress = (timestamp % NP_PULSE_DURATION_MS) / NP_PULSE_DURATION_MS; // 0.0 to 1.0
    const breathe = (Math.sin(progress * Math.PI * 2) + 1) / 2; // smooth sine 0 -> 1 -> 0
    const s = _npPulseScale();

    _activePulseLayers.forEach((layerId) => {
      const outerId = layerId + '-outer';

      if (map && map.getLayer(layerId) && map.getLayer(outerId)) {
        // 1. Inner crimson flare (breathing radius + blur)
        const coreRadius = (7 + breathe * 5.5) * s;
        const coreBlur = 0.15 + breathe * 0.4;
        const coreOpacity = 0.4 + breathe * 0.4;

        map.setPaintProperty(layerId, 'circle-radius', coreRadius);
        map.setPaintProperty(layerId, 'circle-blur', coreBlur);
        map.setPaintProperty(layerId, 'circle-opacity', coreOpacity);

        // 2. Outer expanding dark-red radar wave (#8B0000)
        const shockRadius = (7 + progress * 24) * s;
        const shockOpacity = Math.max(0, (1 - progress) * 0.95);
        const shockStrokeWidth = (1.2 + (1 - progress) * 2.2) * Math.max(0.5, s);

        map.setPaintProperty(outerId, 'circle-radius', shockRadius);
        map.setPaintProperty(outerId, 'circle-stroke-opacity', shockOpacity);
        map.setPaintProperty(outerId, 'circle-stroke-width', shockStrokeWidth);
        map.setPaintProperty(outerId, 'circle-opacity', shockOpacity * 0.18);
      }
    });

    _pulseAnimationId = requestAnimationFrame(frame);
  }

  _pulseAnimationId = requestAnimationFrame(frame);
}

function addFirePulsingLayer(sourceId, pulseLayerId) {
  const outerRingId = pulseLayerId + '-outer';

  if (map.getLayer(outerRingId)) map.removeLayer(outerRingId);
  if (map.getLayer(pulseLayerId)) map.removeLayer(pulseLayerId);

  const pulseFilter = npPulseFilter();

  // A. Outer expanding dark-red shockwave (#8B0000)
  map.addLayer({
    id: outerRingId,
    type: 'circle',
    source: sourceId,
    filter: pulseFilter,
    paint: {
      'circle-radius': 12,
      'circle-color': '#FF0000',
      'circle-opacity': 0.15,
      'circle-stroke-color': '#8B0000', // signature FireMap dark red
      'circle-stroke-width': 2,
      'circle-stroke-opacity': 0.9,
      'circle-blur': 0.15
    }
  });

  // B. Inner shimmering crimson/orange core
  map.addLayer({
    id: pulseLayerId,
    type: 'circle',
    source: sourceId,
    filter: pulseFilter,
    paint: {
      'circle-radius': 8,
      'circle-color': '#FF3300',
      'circle-opacity': 0.6,
      'circle-stroke-color': '#8B0000',
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': 0.85,
      'circle-blur': 0.3
    }
  });

  _activePulseLayers.add(pulseLayerId);
  startFirePulseAnimation();

  // Refresh the recency cutoff every minute so pulses expire live.
  if (!_pulseFilterTicker) {
    _pulseFilterTicker = setInterval(function () {
      var f = npPulseFilter();
      _activePulseLayers.forEach(function (id) {
        try {
          if (map.getLayer(id)) map.setFilter(id, f);
          if (map.getLayer(id + '-outer')) map.setFilter(id + '-outer', f);
        } catch (e) { }
      });
    }, 60000);
  }
}

// ========================
// np: FireMap Branded Oscillating Pulse Engine (animated).
// Outer expanding #8B0000 radar wave + inner breathing crimson core.
// One rAF loop drives every registered pulse pair; each frame guards on
// map.getLayer so style reloads / removed layers are safe.
// ========================
const _npActivePulseLayers = new Set();
let _npPulseAnimationId = null;

function npStartFirePulseAnimation() {
  if (_npPulseAnimationId) return;
  if (typeof requestAnimationFrame !== 'function') return;

  const DURATION = 1750; // ms per pulse cycle

  function frame(timestamp) {
    const progress = (timestamp % DURATION) / DURATION;           // 0.0 -> 1.0
    const breathe = (Math.sin(progress * Math.PI * 2) + 1) / 2;   // smooth 0 -> 1 -> 0

    _npActivePulseLayers.forEach((layerId) => {
      const outerId = layerId + '-outer';

      if (map && map.getLayer(layerId) && map.getLayer(outerId)) {
        // 1. Inner crimson flare (breathing radius + blur)
        const coreRadius = 7 + breathe * 5.5;
        const coreBlur = 0.15 + breathe * 0.4;
        const coreOpacity = 0.4 + breathe * 0.4;

        map.setPaintProperty(layerId, 'circle-radius', coreRadius);
        map.setPaintProperty(layerId, 'circle-blur', coreBlur);
        map.setPaintProperty(layerId, 'circle-opacity', coreOpacity);

        // 2. Outer expanding dark-red radar wave (#8B0000)
        const shockRadius = 7 + progress * 24;
        const shockOpacity = Math.max(0, (1 - progress) * 0.95);
        const shockStrokeWidth = 1.2 + (1 - progress) * 2.2;

        map.setPaintProperty(outerId, 'circle-radius', shockRadius);
        map.setPaintProperty(outerId, 'circle-stroke-opacity', shockOpacity);
        map.setPaintProperty(outerId, 'circle-stroke-width', shockStrokeWidth);
        map.setPaintProperty(outerId, 'circle-opacity', shockOpacity * 0.18);
      }
    });

    _npPulseAnimationId = requestAnimationFrame(frame);
  }

  _npPulseAnimationId = requestAnimationFrame(frame);
}

// Adds the animated outer + inner pulse pair for one source, gated by the
// given filter expression. Registers with the shared engine.
function npAddAnimatedPulseLayers(sourceId, pulseLayerId, pulseFilter) {
  const outerRingId = pulseLayerId + '-outer';

  if (map.getLayer(pulseLayerId)) map.removeLayer(pulseLayerId);
  if (map.getLayer(outerRingId)) map.removeLayer(outerRingId);

  // A. Outer expanding dark-red shockwave (#8B0000)
  map.addLayer({
    id: outerRingId,
    type: 'circle',
    source: sourceId,
    filter: pulseFilter,
    paint: {
      'circle-radius': 12,
      'circle-color': '#FF0000',
      'circle-opacity': 0.15,
      'circle-stroke-color': '#8B0000', // signature FireMap dark red
      'circle-stroke-width': 2,
      'circle-stroke-opacity': 0.9,
      'circle-blur': 0.15
    }
  });

  // B. Inner shimmering crimson/orange core
  map.addLayer({
    id: pulseLayerId,
    type: 'circle',
    source: sourceId,
    filter: pulseFilter,
    paint: {
      'circle-radius': 8,
      'circle-color': '#FF3300',
      'circle-opacity': 0.6,
      'circle-stroke-color': '#8B0000',
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': 0.85,
      'circle-blur': 0.3
    }
  });

  _npActivePulseLayers.add(pulseLayerId);
  npStartFirePulseAnimation();
}

function formatFireNameTwoLines(features) {
  if (!features || !Array.isArray(features)) return;
  features.forEach(feature => {
    if (feature.properties && feature.properties.fire_name) {
      const nameParts = feature.properties.fire_name.split(' ');
      let line1 = "";
      let line2 = "";
      const maxLengthPerLine = 10; 

      for (let i = 0; i < nameParts.length; i++) {
        if (line1.length === 0) {
          line1 = nameParts[i];
        } else if ((line1 + " " + nameParts[i]).length <= maxLengthPerLine || nameParts.length - 1 === i && line2.length === 0) {
          line1 += " " + nameParts[i];
        } else {
          if (line2.length === 0) {
            line2 = nameParts[i];
          } else {
            line2 += " " + nameParts[i];
          }
        }
      }
      feature.properties.formatted_fire_name = line1;
      if (line2) {
        feature.properties.formatted_fire_name += "\n" + line2;
      }
    } else if (feature.properties) {
      feature.properties.formatted_fire_name = feature.properties.fire_name || "Unknown Fire";
    }
  });
}

// Dynamic real-time ticking for FIRMS Hotspot Detection Age (Hours format)
let _npHotspotTicker = null;

function clearHotspotTicker() {
  if (_npHotspotTicker) {
    clearInterval(_npHotspotTicker);
    _npHotspotTicker = null;
  }
}

function _npFormatElapsed(elapsedMs) {
  if (elapsedMs <= 0) return 'detected just now';
  const totalSec = Math.floor(elapsedMs / 1000);
  const min = Math.floor(totalSec / 60);

  if (totalSec < 60)  return `${totalSec}s ago`;
  if (min < 10)       return `${min} min ${String(totalSec % 60).padStart(2, '0')} s ago`;
  if (min < 90)       return `${min} min ago`;
  if (min < 360)      return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m ago`;
  return `${Math.round(min / 60)} hours ago`;
}

function _npTickHotspots() {
  const box = document.getElementById('infoBox');
  if (!box || box.style.display === 'none') {
    clearHotspotTicker();
    return;
  }
  const els = box.querySelectorAll('[data-np-detect-epoch]');
  if (!els.length) {
    clearHotspotTicker();
    return;
  }
  const now = Date.now();
  els.forEach(el => {
    const epochSec = Number(el.dataset.npDetectEpoch);
    if (!isNaN(epochSec) && epochSec > 0) {
      const elapsedMs = Math.max(0, now - epochSec * 1000);
      el.textContent = _npFormatElapsed(elapsedMs);
    }
  });
}

function _npStartHotspotTicker() {
  clearHotspotTicker();
  _npTickHotspots();
  _npHotspotTicker = setInterval(_npTickHotspots, 1000);
}

// np: Resolve the detection epoch (unix seconds) from feature properties.
// Accepts naming variants of the FME-written attribute, then falls back to
// hour-granularity server attributes. Logs which attribute it used so the
// source is verifiable in the console on every hotspot click.
var NP_DETECT_EPOCH_KEYS = ['detect_epoch', 'detectepoch', 'detection_epoch', 'detect_epoch_utc'];
function npResolveDetectEpoch(p) {
    if (!p) return null;
    for (var i = 0; i < NP_DETECT_EPOCH_KEYS.length; i++) {
        var k = NP_DETECT_EPOCH_KEYS[i];
        var v = p[k];
        if (v === undefined || v === null || String(v).trim() === '') continue;
        var n = Number(v);
        if (isNaN(n) || n <= 0) continue;
        if (n > 1e12) n = n / 1000;               // ms -> s
        console.debug('[hotspot-age] epoch from "' + k + '" =', n);
        return { sec: n, src: k };
    }
    if (p.time_diff !== undefined && p.time_diff !== null && !isNaN(Number(p.time_diff))) {
        console.debug('[hotspot-age] NO epoch attribute in feature; fallback time_diff =',
            p.time_diff, '| keys:', Object.keys(p).join(','));
        return { sec: (Date.now() - Number(p.time_diff) * 3600000) / 1000, src: 'time_diff' };
    }
    if (p.hours_since_update !== undefined && p.hours_since_update !== null && !isNaN(Number(p.hours_since_update))) {
        console.debug('[hotspot-age] NO epoch attribute in feature; fallback hours_since_update =',
            p.hours_since_update, '| keys:', Object.keys(p).join(','));
        return { sec: (Date.now() - Number(p.hours_since_update) * 3600000) / 1000, src: 'hours_since_update' };
    }
    console.debug('[hotspot-age] no usable time attribute | keys:', Object.keys(p).join(','));
    return null;
}

function firmsHotspotToHtml(p, title) {
    _npInjectPassCardStyles();
    title = title || 'NASA FIRMS Hotspot';
    const satName = p.satellite || p.satellite_name || 'Satellite';

    const npEpoch = npResolveDetectEpoch(p);
    let epochSec = npEpoch ? npEpoch.sec : null;

    let dynamicHeadline = '';
    if (epochSec) {
        const epochMs = epochSec * 1000;
        const elapsedMs = Math.max(0, Date.now() - epochMs);
        const elapsedText = _npFormatElapsed(elapsedMs);
        
        let metaDetails = `<span class="np-plat">${_npEsc(satName)}</span>`;
        if (p.daynight) {
            const isNight = String(p.daynight).toUpperCase() === 'N';
            metaDetails += `<span class="np-glyph ${isNight ? 'np-glyph-night' : 'np-glyph-day'}" title="${isNight ? 'Night pass' : 'Daylight pass'}">${isNight ? '\u263E' : '\u2600'}</span>`;
        }

        dynamicHeadline = `
        <div class="np-headline" style="margin-bottom: 8px;">
          <div class="np-count" aria-hidden="true">
            <span class="np-count-val" data-np-detect-epoch="${epochSec}">${elapsedText}</span>
          </div>
          <div class="np-meta">${metaDetails}</div>
          <p class="np-when">${_npEsc(_npLocalFull(epochMs))}
            <span class="np-utc">${_npEsc(_npUtcLabel(epochMs))}</span>
          </p>
        </div>`;
    }

    let extraDetails = '';
    if (p.confidence !== undefined && p.confidence !== null && p.confidence !== '') {
        extraDetails += `<strong>Confidence:</strong> ${_npEsc(p.confidence)}<br>`;
    }
    if (p.frp !== undefined && p.frp !== null && p.frp !== '') {
        extraDetails += `<strong>FRP:</strong> ${_npEsc(p.frp)} MW<br>`;
    }
    if (p.brightness || p.bright_ti4) {
        extraDetails += `<strong>Brightness:</strong> ${_npEsc(p.brightness || p.bright_ti4)} K<br>`;
    }
    if (p.satellite_returns_24hrs) {
        extraDetails += `<strong>Returns (24hrs):</strong> ${_npEsc(p.satellite_returns_24hrs)}<br>`;
    }

    const primaryHtml = dynamicHeadline || `<strong>Satellite:</strong> ${_npEsc(satName)}<br>`;
    return `<h3>${_npEsc(title)}</h3>` + primaryHtml +
           (extraDetails ? `<div class="np-more-body" style="margin-top:6px;">${extraDetails}</div>` : '') +
           npFirmsDetectionNoteHTML();
}

function createFirePointInteractionHandlers(layerId, dataTransformer) {
  map.on('click', layerId, (e) => {
    if (e.features && e.features.length > 0) {
      e.preventDefault();
      const coordinates = e.features[0].geometry.coordinates.slice();
      const properties = e.features[0].properties;
      clearHotspotTicker();
      const description = dataTransformer(properties);
      const targetZoom = 10;
      document.getElementById('infoBox').innerHTML = description;
      document.getElementById('infoBox').style.display = 'block';
      if (document.querySelector('#infoBox [data-np-detect-epoch]')) {
        _npStartHotspotTicker();
      }
      renderNextPassCard(properties, coordinates);
      npRenderFDRCard(properties);
      const currentZoom = map.getZoom();
      if (currentZoom >= targetZoom) {
        map.panTo(coordinates);
      } else {
        map.flyTo({ center: coordinates, zoom: targetZoom, essential: true });
      }
    }
  });
  map.on('mouseenter', layerId, () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', layerId, () => map.getCanvas().style.cursor = '');
}

// np: VE ramp. The basemap style's vertical exaggeration is kept in full at
// every zoom EXCEPT close-up: between roughly the 1 km scale (z~12.3) and
// the 500 m scale (z~13.5) the exaggeration eases down to 1.0 -- natural
// relief, never flat -- so hotspot circles stop being swallowed by
// exaggerated slopes right where people inspect individual fires. One
// setTerrain call with a camera expression; the GPU handles the transition.
var NP_VE_HOLD_ZOOM    = 12.3;  // full style VE up to here (~1 km scale)
var NP_VE_NEUTRAL_ZOOM = 13.5;  // VE reaches NP_VE_MIN here (~500 m scale)
var NP_VE_MIN          = 1.0;   // never below natural relief
var _npVeBase = null;

function npApplyVeRamp() {
    if (typeof map === 'undefined' || typeof map.getTerrain !== 'function') return;
    var t;
    try { t = map.getTerrain(); } catch (e) { return; }
    if (!t || !t.source) return; // basemap has no terrain
    // Remember the style's numeric VE on first sight; after our expression
    // is installed, getTerrain() returns the expression, not the number.
    if (typeof t.exaggeration === 'number') _npVeBase = t.exaggeration;
    var baseVE = (_npVeBase !== null) ? _npVeBase : 1.5;
    if (baseVE <= NP_VE_MIN) return; // nothing to ramp
    try {
        map.setTerrain({
            source: t.source,
            exaggeration: ['interpolate', ['linear'], ['zoom'],
                NP_VE_HOLD_ZOOM, baseVE,
                NP_VE_NEUTRAL_ZOOM, NP_VE_MIN
            ]
        });
        console.debug('[terrain] VE ramp installed:', baseVE, '-> ' + NP_VE_MIN +
            ' between z' + NP_VE_HOLD_ZOOM + ' and z' + NP_VE_NEUTRAL_ZOOM);
    } catch (e) {
        console.warn('[terrain] VE ramp failed:', e && e.message);
    }
}

// np: Keep the broad satellite hotspot layers stacked BELOW the authoritative
// agency fire stacks (pulse + circle + labels). Layer adds are async (WFS
// fetches resolve in any order), so this is called after each hotspot layer
// add and after each agency layer add. Idempotent.
function npMoveHotspotsBelowAgencyPoints() {
    const npAgencyIds = [
        'fire-points-europe-pulse-outer',
        'fire-points-europe-pulse', 'fire-points-europe', 'fire-points-europe-labels-fon',
        'fire-points-aus-pulse-outer', 'fire-points-aus-pulse', 'fire-points-aus', 'fire-points-aus-labels-fon',
        'usa-fire-points-pulse-outer', 'usa-fire-points-pulse', 'usa-fire-points', 'usa-fire-points-labels-fon',
        'canada-fire-points-pulse-outer', 'canada-fire-points-pulse', 'canada-fire-points', 'canada-fire-points-labels-fon'
    ];
    const npStyle = map.getStyle();
    if (!npStyle || !npStyle.layers) return;
    // Anchor on the LOWEST agency layer in actual render order, so hotspots
    // land below all of them regardless of fetch completion order.
    const npAnchor = npStyle.layers.find(l => npAgencyIds.indexOf(l.id) !== -1);
    if (!npAnchor) return;
    // Moving each in this sequence to just-below the anchor yields, bottom
    // to top: perimeters, FCI footprint, hotspot blobs, agency stacks.
    ['burned-areas-mvt-fill', 'burned-areas-mvt-outline',
     'fci-footprint-fill',
     'global-firms-hotspots', 'usa-nasa-firms-24hrs-pt', 'combined-fire-points'].forEach(id => {
        if (map.getLayer(id)) {
            try { map.moveLayer(id, npAnchor.id); } catch (err) { console.error('np layer order:', err.message); }
        }
    });
}

// np: Collapsed-by-default caveat block appended to satellite hotspot popups.
// Native <details> element: #infoBox is filled via innerHTML, which destroys
// bound listeners, so no JS handlers can be used here.
function npFirmsDetectionNoteHTML() {
    return `
    <details class="np-firms-note">
      <summary>&#9432; About satellite hotspots</summary>
      <div class="np-firms-note-body">
        <p><strong>A hotspot is a heat detection, not a confirmed fire.</strong>
        Each point marks the centre of a satellite pixel roughly 375&nbsp;m to
        2&nbsp;km across. The heat source sits somewhere inside that footprint,
        not necessarily at the centre.</p>
        <p><strong>No detection does not mean no fire.</strong> Cloud, thick
        smoke and dense canopy all hide fires, and each satellite only sees a
        given location on its overpass.</p>
        <p class="np-firms-note-warn">Do not use this layer for evacuation or
        life-safety decisions. Follow your local fire agency.</p>
      </div>
    </details>`;
}

// np: Collapsed caveat for FCI heat-sig detections in the fire infobox.
// Names the sensor and warns about geostationary false positives. Native
// <details> (innerHTML rendering destroys listeners).
function npFciDetectionNoteHTML() {
    _npInjectPassCardStyles();
    return `
    <details class="np-firms-note">
      <summary>&#9432; About these heat detections</summary>
      <div class="np-firms-note-body">
        <p>Heat signatures come from <strong>Meteosat MTG FCI</strong>, a
        geostationary satellite that rescans Europe every few minutes --
        near-real-time detection, but with coarse pixels a few kilometres
        across.</p>
        <p><strong>Geostationary detections can be false positives.</strong>
        Sun glint, hot bare ground and cloud edges can all register as heat,
        and the source location is approximate.</p>
        <p class="np-firms-note-warn">Do not use these detections for
        evacuation or life-safety decisions. Follow your local fire
        agency.</p>
      </div>
    </details>`;
}

function npHeatDetectedHtml(p) {
    const ms = npParseCompactUtc(p.heatsigfciacqtime);
    if (ms === null) return '';
    const epochSec = ms / 1000;
    const elapsed = _npFormatElapsed(Math.max(0, Date.now() - ms));
    return `<strong>Last heat detection (MTG FCI):</strong> <span style="color:#FF4500; font-weight:bold;" data-np-detect-epoch="${epochSec}">${elapsed}</span><br>`;
}

function usaFirePropertiesToHtml(p) {
    let heatSigHtml = '';
    if (p.heatsigfcidetections_last_hour !== undefined && p.heatsigfcidetections_last_hour !== null && String(p.heatsigfcidetections_last_hour).trim() !== '') {
      heatSigHtml = `<br><strong>Heat sigs (recent hours):</strong> <span style="color:#FF4500; font-weight:bold;">${p.heatsigfcidetections_last_hour}</span>`;
      const npHd = npHeatDetectedHtml(p);
      if (npHd) heatSigHtml += `<br>` + npHd.replace(/<br>$/, '');
      heatSigHtml += npFciDetectionNoteHTML();
    }
    const npPrimary = `<strong>Status:</strong> ${p.fire_status||'Unknown'}<br><strong>Size (acres):</strong> ${npFmtArea(p.size_acres)}<br><strong>Daily Acres:</strong> ${p.daily_acres||'Unknown'}<br><strong>Percent Contained:</strong> ${p.percent_contained||'Unknown'}%${heatSigHtml}`;
    const npRest = `<strong>Cause:</strong> ${p.fire_cause||'Unknown'}<br><strong>Total Personnel:</strong> ${p.totalincidentpersonnel||'Unknown'}<br><strong>Duration (days):</strong> ${p.fire_duration_days||'Unknown'}<br><strong>Ignition Date:</strong> ${p.ignition_date||'Unknown'}<br><strong>Last Update (days ago):</strong> ${p.last_update_days||'Unknown'}`;
    return `<h3>${p.fire_name||'Unknown Fire'}</h3>` + npInfoBoxLayout(npPrimary, npRest);
}

function genericFirePropertiesToHtml(p) {
    const riskColorMap = {
        'Low': '#28a745',
        'Moderate': '#007bff',
        'High': '#ffc107',
        'Very High': '#fd7e14',
        'Extreme': '#dc3545',
        'Very Extreme': '#dc3545'
    };
    const defaultRiskColor = '#6c757d'; 
    let riskHtml = '';
    let riskValueProperty;
    const riskLabel = 'Daily fire danger risk:'; 

    const hasFdrCard = (typeof p.fdr_daily !== 'undefined' && p.fdr_daily !== null) ||
                       (typeof p.fwi_daily !== 'undefined' && p.fwi_daily !== null) ||
                       (typeof p.fwi_d2 !== 'undefined' && p.fwi_d2 !== null) ||
                       (typeof p.fwi_d1 !== 'undefined' && p.fwi_d1 !== null) ||
                       (typeof p.fwi !== 'undefined' && p.fwi !== null);

    if (!hasFdrCard && typeof p.fwi_daily !== 'undefined' && p.fwi_daily !== null) riskValueProperty = p.fwi_daily;

    if (typeof riskValueProperty !== 'undefined') {
        const displayRiskValue = String(riskValueProperty).trim() || 'Unknown';
        const riskColor = riskColorMap[displayRiskValue] || defaultRiskColor;
        let fontWeightStyle = (displayRiskValue === 'Very Extreme') ? "font-weight: bold;" : "";
        riskHtml = `<strong>${riskLabel}</strong> <span style="color: ${riskColor}; ${fontWeightStyle}">${displayRiskValue}</span><br>`;
    }

    let weatherHtml = '';
    if (typeof p.wind_string !== 'undefined' && p.wind_string !== null && p.wind_string !== '' || typeof p.wind_dir !== 'undefined' && p.wind_dir !== null && p.wind_dir !== '') {
        weatherHtml += `<strong>Wind:</strong> ${p.wind_string || 'N/A'}`;
        if (typeof p.wind_dir !== 'undefined' && p.wind_dir !== null && p.wind_dir !== '') weatherHtml += ` (${p.wind_dir})`;
        weatherHtml += `<br>`;
    }
    if (typeof p.temp_string !== 'undefined' && p.temp_string !== null && p.temp_string !== '') weatherHtml += `<strong>Temperature:</strong> ${p.temp_string || 'N/A'}<br>`;
    if (typeof p.rh_pct !== 'undefined' && p.rh_pct !== null) weatherHtml += `<strong>Relative Humidity:</strong> ${p.rh_pct}%<br>`;

    let lastUpdateHtml = `<strong>Last Update:</strong> Unknown<br>`;
    if (typeof p.lastupdate_hours !== 'undefined' && p.lastupdate_hours !== null) lastUpdateHtml = `<strong>Last Update (hours):</strong> ${p.lastupdate_hours}<br>`;
    else if (typeof p.lastupdate_firedb !== 'undefined' && p.lastupdate_firedb !== null) lastUpdateHtml = `<strong>Last Update:</strong> ${p.lastupdate_firedb || 'Unknown'}<br>`;
    
    let heatSigHtml = npHeatDetectedHtml(p);
    if (p.heatsigfcidetections_last_hour !== undefined && p.heatsigfcidetections_last_hour !== null && String(p.heatsigfcidetections_last_hour).trim() !== '') {
      heatSigHtml += `<strong>Heat sigs (recent hours):</strong> <span style="color:#FF4500; font-weight:bold;">${p.heatsigfcidetections_last_hour}</span><br>`;
    }
    if (heatSigHtml) heatSigHtml += npFciDetectionNoteHTML();

    const npPrimary = `<strong>Status:</strong> ${p.fire_status || 'Unknown'}<br>` +
           `<strong>Size (ha):</strong> ${npFmtArea(p.size_ha)}<br>` +
           `${heatSigHtml}` +
           `${riskHtml}`;
    const npRest = `${weatherHtml}` +
           `<strong>Fire ID:</strong> ${p.fire_id_source || 'Unknown'}<br>` +
           `<strong>Cause:</strong> ${p.fire_cause || 'Unknown'}<br>` +
           `<strong>Duration (days):</strong> ${p.duration_days || 'Unknown'}<br>` +
           `<strong>Ignition Date:</strong> ${p.ignition_date || 'Unknown'}<br>` +
           `${lastUpdateHtml}`;
    return `<h2>${p.fire_name || 'Unknown Fire'}</h2>` + npInfoBoxLayout(npPrimary, npRest);
}

// ========================
// Smoke Layer
// ========================
function addSmokeLayer() {
    const sourceId = 'smoke-wmts-source'; const layerId = 'smoke-raster-layer';
    if (map.getLayer(layerId)) map.removeLayer(layerId); if (map.getSource(sourceId)) map.removeSource(sourceId);
    map.addSource(sourceId, {
        'type': 'raster',
        'tiles': ['https://geo.firemap.live/geoserver/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=FireDB:smoke_latest&STYLE=rasters:smoke_style&TILEMATRIXSET=EPSG:900913x2&TILEMATRIX=EPSG:900913x2:{z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png&TRANSPARENT=TRUE'],
        'tileSize': 512,
        'bounds': [-176.85, 16.05, -18.82, 80.25]
    });
    const smokeCheckbox = document.getElementById('smoke-layer-toggle');
    const isChecked = smokeCheckbox ? smokeCheckbox.checked : true;
    const currentZoom = map.getZoom();
    const initialVisibility = (isChecked && currentZoom < SMOKE_LAYER_HIDE_ZOOM_THRESHOLD) ? 'visible' : 'none'; 
    const smokeSlider = document.getElementById('smokeOpacitySlider');
    const initialOpacity = smokeSlider && !isNaN(parseInt(smokeSlider.value)) ? parseInt(smokeSlider.value) / 100 : 0.6;
    map.addLayer({
        'id': layerId, 'type': 'raster', 'source': sourceId,
        'paint': { 'raster-opacity': initialOpacity, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
        'layout': { 'visibility': initialVisibility }
    });
    smokeLayerAdded = true;
}

function handleZoomForSmokeLayer() {
    if (!smokeLayerAdded || !map.getLayer('smoke-raster-layer')) return;
    const smokeCheckbox = document.getElementById('smoke-layer-toggle');
    if (smokeCheckbox && smokeCheckbox.checked) {
        const currentZoom = map.getZoom();
        map.setLayoutProperty('smoke-raster-layer', 'visibility', currentZoom < SMOKE_LAYER_HIDE_ZOOM_THRESHOLD ? 'visible' : 'none');
    } else if (map.getLayer('smoke-raster-layer')) {
         map.setLayoutProperty('smoke-raster-layer', 'visibility', 'none');
    }
}

// ========================
// Fire Points Layers (GeoJSON)
// ========================
function addUSAFirePointsLayer() {
    const sourceId = 'usa-fire-data';
    const circleLayerId = 'usa-fire-points';
    const labelLayerId = circleLayerId + '-labels-fon'; 
    const pulseLayerId = circleLayerId + '-pulse';
    const url = 'https://geo.firemap.live/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=FireDB%3Ausa_fire_pt_active&outputFormat=application%2Fjson';

    if (map.getLayer(labelLayerId)) map.removeLayer(labelLayerId);
    if (map.getLayer(circleLayerId)) map.removeLayer(circleLayerId);
    if (map.getLayer(pulseLayerId + '-outer')) map.removeLayer(pulseLayerId + '-outer');
    if (map.getLayer(pulseLayerId)) map.removeLayer(pulseLayerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    fetch(url).then(r => r.json()).then(d => {
        if (!d || d.type !== 'FeatureCollection') throw new Error('Inv USA GeoJSON');
        formatFireNameTwoLines(d.features);

        usFirePoints = d.features;
        map.addSource(sourceId, { type: 'geojson', data: d });

        addFirePulsingLayer(sourceId, pulseLayerId);

        map.addLayer({
            id: circleLayerId,
            type: 'circle',
            source: sourceId,
            paint: getFireLayerPaintProperties()
        });
        createFirePointInteractionHandlers(circleLayerId, usaFirePropertiesToHtml);

        map.addLayer({
            id: labelLayerId,
            type: 'symbol',
            source: sourceId,
            minzoom: 4, 
            filter: ['==', ['get', 'fire_status'], 'Fire of Note'],
            layout: {
                'text-field': ['get', 'formatted_fire_name'],
                'text-font': ['Lexend Bold', 'Open Sans Bold', 'Arial Unicode MS Bold'], 
                'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 7, 13, 10, 15],
                'text-offset': [0, 0.8], 
                'text-anchor': 'top',   
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'text-max-width': 8, 
                'text-line-height': 1.1 
            },
            paint: {
                'text-color': '#FFFFFF', 
                'text-halo-color': '#8B0000', 
                'text-halo-width': 1.5, 
                'text-halo-blur': 0.5
            }
        });
        npMoveHotspotsBelowAgencyPoints();

    }).catch(e => console.error(`USA Fire Err: ${e.message}`));
}

function addCanadaFirePointsLayer() {
    const sourceId = 'canada-fire-data'; 
    const circleLayerId = 'canada-fire-points';
    const labelLayerId = circleLayerId + '-labels-fon';
    const pulseLayerId = circleLayerId + '-pulse';
    const url = 'https://geo.firemap.live/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=FireDB%3Afire_pt_cad_active&outputFormat=application%2Fjson';
    
    if (map.getLayer(labelLayerId)) map.removeLayer(labelLayerId);
    if (map.getLayer(circleLayerId)) map.removeLayer(circleLayerId);
    if (map.getLayer(pulseLayerId + '-outer')) map.removeLayer(pulseLayerId + '-outer');
    if (map.getLayer(pulseLayerId)) map.removeLayer(pulseLayerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    fetch(url).then(r=>r.json()).then(d=>{
        if(!d||d.type!=='FeatureCollection')throw new Error('Inv Canada GeoJSON');
        formatFireNameTwoLines(d.features);

        canadaFirePoints = d.features; 
        map.addSource(sourceId,{type:'geojson',data:d});
        
        addFirePulsingLayer(sourceId, pulseLayerId);

        map.addLayer({id:circleLayerId,type:'circle',source:sourceId,paint:getFireLayerPaintProperties()});
        createFirePointInteractionHandlers(circleLayerId,genericFirePropertiesToHtml);

        map.addLayer({
            id: labelLayerId,
            type: 'symbol',
            source: sourceId,
            minzoom: 4, 
            filter: ['==', ['get', 'fire_status'], 'Fire of Note'],
            layout: {
                'text-field': ['get', 'formatted_fire_name'],
                'text-font': ['Lexend Bold', 'Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 7, 13, 10, 15],
                'text-offset': [0, 0.8], 
                'text-anchor': 'top',   
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'text-max-width': 8, 
                'text-line-height': 1.1
            },
            paint: {
                'text-color': '#FFFFFF', 
                'text-halo-color': '#8B0000', 
                'text-halo-width': 1.5, 
                'text-halo-blur': 0.5
            }
        });
        npMoveHotspotsBelowAgencyPoints();
    }).catch(e=>console.error(`Canada Fire Err: ${e.message}`));
}

function addAustralianFirePointsLayer() {
    const sourceId = 'fire-data-aus'; 
    const circleLayerId = 'fire-points-aus';
    const labelLayerId = circleLayerId + '-labels-fon';
    const pulseLayerId = circleLayerId + '-pulse';
    const url = 'https://geo.firemap.live/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=FireDB%3Afire_pt_aus_active&outputFormat=application%2Fjson';
    
    if (map.getLayer(labelLayerId)) map.removeLayer(labelLayerId);
    if (map.getLayer(circleLayerId)) map.removeLayer(circleLayerId);
    if (map.getLayer(pulseLayerId + '-outer')) map.removeLayer(pulseLayerId + '-outer');
    if (map.getLayer(pulseLayerId)) map.removeLayer(pulseLayerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    fetch(url).then(r=>r.json()).then(d=>{
        if(!d||d.type!=='FeatureCollection')throw new Error('Inv AUS GeoJSON');
        formatFireNameTwoLines(d.features);
        australiaFirePoints=d.features; 
        map.addSource(sourceId,{type:'geojson',data:d});
        
        addFirePulsingLayer(sourceId, pulseLayerId);

        map.addLayer({id:circleLayerId,type:'circle',source:sourceId,paint:getFireLayerPaintProperties()});
        createFirePointInteractionHandlers(circleLayerId,genericFirePropertiesToHtml);

        map.addLayer({
            id: labelLayerId,
            type: 'symbol',
            source: sourceId,
            minzoom: 4, 
            filter: ['==', ['get', 'fire_status'], 'Fire of Note'],
            layout: {
                'text-field': ['get', 'formatted_fire_name'],
                'text-font': ['Lexend Bold', 'Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 7, 13, 10, 15],
                'text-offset': [0, 0.8], 
                'text-anchor': 'top',   
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'text-max-width': 8, 
                'text-line-height': 1.1
            },
            paint: {
                'text-color': '#FFFFFF', 
                'text-halo-color': '#8B0000', 
                'text-halo-width': 1.5, 
                'text-halo-blur': 0.5
            }
        });
        npMoveHotspotsBelowAgencyPoints();
    }).catch(e=>console.error(`AUS Fire Err: ${e.message}`));
}

function addEuropeFirePointsLayer() {
    const sourceId = 'fire-data-europe'; 
    const circleLayerId = 'fire-points-europe';
    const labelLayerId = circleLayerId + '-labels-fon';
    const pulseLayerId = circleLayerId + '-pulse';
    const url = 'https://geo.firemap.live/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=FireDB%3Amodis_ba_pt_7day&outputFormat=application%2Fjson';
    
    if (map.getLayer(labelLayerId)) map.removeLayer(labelLayerId);
    if (map.getLayer(circleLayerId)) map.removeLayer(circleLayerId);
    if (map.getLayer(pulseLayerId)) map.removeLayer(pulseLayerId);
    if (map.getLayer(pulseLayerId + '-outer')) map.removeLayer(pulseLayerId + '-outer');
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    fetch(url).then(r=>r.json()).then(d=>{
        if(!d||d.type!=='FeatureCollection')throw new Error('Inv Europe GeoJSON');
        formatFireNameTwoLines(d.features);
        map.addSource(sourceId,{type:'geojson',data:d});
        
        // Animated pulse, tight gate: Fire of Note + FCI detections in the
        // last hour + acquisition genuinely recent (NP_PULSE_MAX_AGE_MIN).
        npAddAnimatedPulseLayers(sourceId, pulseLayerId, npPulseFilter());

        map.addLayer({id:circleLayerId,type:'circle',source:sourceId,paint:getFireLayerPaintProperties()});
        createFirePointInteractionHandlers(circleLayerId,genericFirePropertiesToHtml);

        map.addLayer({
            id: labelLayerId,
            type: 'symbol',
            source: sourceId,
            minzoom: 4, 
            filter: ['==', ['get', 'fire_status'], 'Fire of Note'],
            layout: {
                'text-field': ['get', 'formatted_fire_name'],
                'text-font': ['Lexend Bold', 'Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 7, 13, 10, 15],
                'text-offset': [0, 0.8], 
                'text-anchor': 'top',   
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'text-max-width': 8, 
                'text-line-height': 1.1
            },
            paint: {
                'text-color': '#FFFFFF', 
                'text-halo-color': '#8B0000', 
                'text-halo-width': 1.5, 
                'text-halo-blur': 0.5
            }
        });
        npMoveHotspotsBelowAgencyPoints();
    }).catch(e=>console.error(`Europe Fire Err: ${e.message}`));
}

function addCombinedSatelliteHotspotLayer() { 
    const sourceId = 'combined-fire-data'; const layerId = 'combined-fire-points';
    const url = 'https://geo.firemap.live/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=FireDB%3Acombined_fire_pt_active&outputFormat=application%2Fjson';
    if (map.getLayer(layerId)) map.removeLayer(layerId); if (map.getSource(sourceId)) map.removeSource(sourceId);
    fetch(url).then(r => r.json()).then(d => {
        if (!d || d.type !== 'FeatureCollection') throw new Error('Inv Combined GeoJSON');
        map.addSource(sourceId, { type: 'geojson', data: d });
        map.addLayer({
            id: layerId, type: 'circle', source: sourceId, layout: {},
            paint: { 
                    'circle-radius': ['let', 'time_decay_factor_radius', ['coalesce', ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'time_diff']], 0], 0, 1.0, 12, 0.9, 24, 0.7, 48, 0.5 ], 1.0], ['interpolate', ['linear'], ['zoom'], 0, ['*', ['match', ['get', 'activity_rating'], 'Low', 0.8, 'Medium', 1.2, 'High', 2.0, 0.8], ['var', 'time_decay_factor_radius'] ], 3, ['*', ['match', ['get', 'activity_rating'], 'Low', 1, 'Medium', 2.5, 'High', 4.5, 1], ['var', 'time_decay_factor_radius'] ], 6, ['*', ['match', ['get', 'activity_rating'], 'Low', 3, 'Medium', 6, 'High', 10.5, 3], ['var', 'time_decay_factor_radius'] ]]],
                    'circle-color': ['match', ['get', 'activity_rating'], 'Low', 'rgba(204,204,0,0.85)', 'Medium', 'rgba(255,128,0,0.85)', 'High', 'rgba(255,0,0,1)', 'rgba(204,204,0,0.85)' ],
                    'circle-opacity': ['let', 'time_decay_factor_opacity', ['coalesce', ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'time_diff']], 0], 0, 1.0, 12, 0.8, 24, 0.6, 48, 0.3 ], 1.0 ], ['interpolate', ['linear'], ['zoom'], 0, ['*', 0.4, ['var', 'time_decay_factor_opacity']], 3, ['*', 0.6, ['var', 'time_decay_factor_opacity']], 6, ['*', 0.9, ['var', 'time_decay_factor_opacity']]]],
                    'circle-stroke-color': ['match', ['get', 'activity_rating'], 'Low', 'rgba(150,150,0,0.7)', 'Medium', 'rgba(200,100,0,0.7)', 'High', 'rgba(200,0,0,0.8)', 'rgba(150,150,0,0.7)' ],
                    'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 3, 0.8, 6, 1.2 ],
                    'circle-stroke-opacity': ['let', 'time_decay_factor_stroke_opacity', ['coalesce', ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'time_diff']], 0], 0, 0.8, 12, 0.6, 24, 0.4, 48, 0.2 ], 0.8 ], ['interpolate', ['linear'], ['zoom'], 0, ['*', 0.4, ['var', 'time_decay_factor_stroke_opacity']], 3, ['*', 0.5, ['var', 'time_decay_factor_stroke_opacity']], 6, ['*', 0.7, ['var', 'time_decay_factor_stroke_opacity']]]]
            }
        });
        createFirePointInteractionHandlers(layerId, p => firmsHotspotToHtml(p, 'Satellite HotSpot'));
        npMoveHotspotsBelowAgencyPoints();
    }).catch(e => console.error(`Combined Hotspot Err: ${e.message}, URL: ${url}`));
}

function addDisasterLayer() {
    let allDisasterData=null;
    function fetchDisasterData(){
        fetch('https://geo.firemap.live/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=FireDB%3AGDACS_7D&outputFormat=application%2Fjson')
            .then(r=>{if(!r.ok)throw new Error(r.statusText);return r.json();})
            .then(d=>{
                if(!d||d.type!=='FeatureCollection')throw new Error('Invalid GDACS GeoJSON');
                allDisasterData=d; renderVisibleDisasterPoints();
                const disasterCheckbox = document.getElementById('disaster-points');
                if (disasterCheckbox && !disasterCheckbox.checked) disasterMarkers.forEach(m => m.getElement().style.display = 'none');
            }).catch(e=>console.error('GDACS Error:',e.message));
    }
    function renderVisibleDisasterPoints(){ 
        if(!allDisasterData || !map.getStyle() || !map.isStyleLoaded()) return;
        disasterMarkers.forEach(m=>m.remove()); disasterMarkers=[];
        const disasterCheckbox = document.getElementById('disaster-points');
        if (disasterCheckbox && !disasterCheckbox.checked) return;
        const mapBounds = map.getBounds();
        const iconMap={'Earthquake_Green':'https://firemap.live/map_icons/EQ_L.png','Earthquake_Orange':'https://firemap.live/map_icons/EQ_M.png','Earthquake_Red':'https://firemap.live/map_icons/EQ_H.png','Flood_Green':'https://firemap.live/map_icons/FL_L.png','Flood_Orange':'https://firemap.live/map_icons/FL_M.png','Flood_Red':'https://firemap.live/map_icons/FL_H.png','Tropical Cyclone_Green':'https://firemap.live/map_icons/CY_L.png','Tropical Cyclone_Orange':'https://firemap.live/map_icons/CY_M.png','Tropical Cyclone_Red':'https://firemap.live/map_icons/CY_H.png','Drought_Green':'https://firemap.live/map_icons/DR_L.png','Drought_Orange':'https://firemap.live/map_icons/DR_M.png','Drought_Red':'https://firemap.live/map_icons/DR_H.png'};
        const visibleFeatures = allDisasterData.features.filter(feature => {
            const geom = feature.geometry; let coords = [];
            if (geom.type === 'Point') coords = geom.coordinates; 
            else if (geom.type === 'MultiPoint' && geom.coordinates.length > 0) coords = geom.coordinates[0];
            if (Array.isArray(coords) && coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
                let lng = coords[0]; const mapCenterLng = map.getCenter().lng;
                while (lng < mapCenterLng - 180) lng += 360; while (lng > mapCenterLng + 180) lng -= 360;
                return mapBounds.contains([lng, coords[1]]);
            } return false;
        });
        const sortedFeatures = visibleFeatures.sort((a,b)=>{const alertPriority={'Red':3,'Orange':2,'Green':1};return(alertPriority[b.properties.alert_type]||0)-(alertPriority[a.properties.alert_type]||0);});
        sortedFeatures.forEach(f=>{
            const{disaster_type,alert_type,description,link}=f.properties;
            let coords=f.geometry.type==='Point'?f.geometry.coordinates:f.geometry.coordinates[0];
            let displayLng = coords[0]; const mapCenterLng = map.getCenter().lng;
            while (displayLng < mapCenterLng - 180) displayLng += 360; while (displayLng > mapCenterLng + 180) displayLng -= 360;
            const displayCoords = [displayLng, coords[1]];
            const iconKey=`${disaster_type}_${alert_type}`; const iconUrl=iconMap[iconKey];
            if(iconUrl){
                const markerEl=document.createElement('img');markerEl.src=iconUrl;markerEl.className='disaster-marker';
                const marker=new mapboxgl.Marker({element:markerEl}).setLngLat(displayCoords).addTo(map);
                disasterMarkers.push(marker);
                const popupContent=`<div style="font-family:Nunito,sans-serif;color:#333"><p style="margin:0 0 5px 0">${description||'No Description'}</p>${link?`<a href="${link}" target="_blank" style="color:#1a73e8">More Info</a>`:''}</div>`;
                const popup=new mapboxgl.Popup({offset:25,closeOnClick:false}).setHTML(popupContent);
                markerEl.addEventListener('click',e=>{e.stopPropagation();if(activePopup&&activePopup!==popup)activePopup.remove();if(popup.isOpen()){popup.remove();activePopup=null;}else{popup.setLngLat(displayCoords).addTo(map);activePopup=popup;}});
            }
        });
    }
    fetchDisasterData(); map.on('moveend', debounce(renderVisibleDisasterPoints, 300));
}

// ========================
// Hotspot age from detect_epoch (unix seconds), computed client-side.
// ========================
function npEpochAge(detectEpoch) {
    let n = Number(detectEpoch);
    if (detectEpoch === null || typeof detectEpoch === 'undefined' ||
        detectEpoch === '' || isNaN(n) || n <= 0) return null;
    if (n > 1e12) n = n / 1000;
    let ms = Date.now() - n * 1000;
    if (ms < 0) ms = 0;
    const min = Math.floor(ms / 60000);
    let label;
    if (min < 60) label = `${min} min ago`;
    else label = `${Math.round(min / 60)} h ago`;
    return { ms, label };
}

function addUSAFIRMSPointsLayer() {
    const sourceId = 'usa-nasa-firms-24hrs-pt'; 
    const layerId = 'usa-nasa-firms-24hrs-pt';
    const sourceLayerName = 'usa_nasa_firms_24hrs_pt';
    const mvtUrl = 'https://geo.firemap.live/geoserver/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=FireDB:usa_nasa_firms_24hrs_pt&STYLE=&TILEMATRIXSET=EPSG:900913&FORMAT=application/vnd.mapbox-vector-tile&TILEMATRIX=EPSG:900913:{z}&TILECOL={x}&TILEROW={y}';
    
    const MIN_FIRMS_ZOOM = BURNED_AREA_VISIBILITY_ZOOM_THRESHOLD;
    const FIRMS_MID_TRANSITION_ZOOM = MIN_FIRMS_ZOOM + 1.5;
    const FIRMS_DETAIL_ZOOM_START = MIN_FIRMS_ZOOM + 4;
    const ORIGINAL_BLUR_ZOOMED_IN = 0.9;
    const ORIGINAL_OPACITY_ZOOMED_IN = 0.69;
    const ORIGINAL_RADIUS_ZOOMED_IN = 11;
    const ORIGINAL_STROKE_WIDTH_ZOOMED_IN = 1;
    const BROAD_RADIUS_MIN = 1.0;
    const BROAD_OPACITY_MIN = 0.015;
    const BROAD_BLUR_MIN = 0.2;
    const BROAD_STROKE_WIDTH_MIN = 0.05;
    const MID_RADIUS = (BROAD_RADIUS_MIN + ORIGINAL_RADIUS_ZOOMED_IN) / 2;
    const MID_BLUR = (BROAD_BLUR_MIN + ORIGINAL_BLUR_ZOOMED_IN) / 2;
    const MID_OPACITY = (BROAD_OPACITY_MIN + ORIGINAL_OPACITY_ZOOMED_IN) / 2;
    const MID_STROKE_WIDTH = (BROAD_STROKE_WIDTH_MIN + ORIGINAL_STROKE_WIDTH_ZOOMED_IN) / 2;

    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    map.addSource(sourceId, {
        type: 'vector',
        tiles: [mvtUrl],
        minzoom: MIN_FIRMS_ZOOM,
        maxzoom: 11,
        bounds: [-170, 18, -52, 74]
    });

    const timeBasedColorGradient = [
        'interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'time_diff']], 49],
        0,  '#D50000',
        3,  '#FF1A00',
        6,  '#FF4500',
        12, '#FF5A36', 18, '#FFA500', 24, '#FFB732',
        30, '#FFC864', 36, '#FFD996', 42, '#FFEACC', 48, '#FFF5E0'
    ];

    map.addLayer({
        id: layerId,
        type: 'circle',
        source: sourceId,
        'source-layer': sourceLayerName,
        minzoom: MIN_FIRMS_ZOOM,
        layout: {
            'circle-sort-key': ['-', 48, ['coalesce', ['to-number', ['get', 'time_diff']], 49]]
        },
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], MIN_FIRMS_ZOOM, BROAD_RADIUS_MIN, FIRMS_MID_TRANSITION_ZOOM, MID_RADIUS, FIRMS_DETAIL_ZOOM_START, ORIGINAL_RADIUS_ZOOMED_IN],
            'circle-blur': ['interpolate', ['linear'], ['zoom'], MIN_FIRMS_ZOOM, BROAD_BLUR_MIN, FIRMS_MID_TRANSITION_ZOOM, MID_BLUR, FIRMS_DETAIL_ZOOM_START, ORIGINAL_BLUR_ZOOMED_IN],
            'circle-color': timeBasedColorGradient,
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], MIN_FIRMS_ZOOM, BROAD_OPACITY_MIN, FIRMS_MID_TRANSITION_ZOOM, MID_OPACITY, FIRMS_DETAIL_ZOOM_START, ORIGINAL_OPACITY_ZOOMED_IN],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], MIN_FIRMS_ZOOM, BROAD_STROKE_WIDTH_MIN, FIRMS_MID_TRANSITION_ZOOM, MID_STROKE_WIDTH, FIRMS_DETAIL_ZOOM_START, ORIGINAL_STROKE_WIDTH_ZOOMED_IN],
            'circle-stroke-color': timeBasedColorGradient,
            'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], MIN_FIRMS_ZOOM, BROAD_OPACITY_MIN, FIRMS_MID_TRANSITION_ZOOM, MID_OPACITY, FIRMS_DETAIL_ZOOM_START, ORIGINAL_OPACITY_ZOOMED_IN]
        }
    });

    createFirePointInteractionHandlers(layerId, p => firmsHotspotToHtml(p, 'NASA FIRMS Hotspot'));
    npMoveHotspotsBelowAgencyPoints();
}

// ========================
// Global Satellite Hotspot Layer (MVT - FireDB:firms_hotspot_pt_slim)
// ========================
function addGlobalFIRMSLayer() {
    const sourceId = 'global-firms-hotspots';
    const layerId = 'global-firms-hotspots';
    const sourceLayerName = 'firms_hotspot_pt_slim';
    const mvtUrl = 'https://geo.firemap.live/geoserver/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=FireDB:firms_hotspot_pt_slim&STYLE=&TILEMATRIXSET=EPSG:900913&FORMAT=application/vnd.mapbox-vector-tile&TILEMATRIX=EPSG:900913:{z}&TILECOL={x}&TILEROW={y}';
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    map.addSource(sourceId, {
        type: 'vector',
        tiles: [mvtUrl],
        minzoom: 5,
        maxzoom: 10
    });

    const ageGradient = [
        'interpolate', ['linear'],
        ['to-number', ['coalesce', ['get', 'hours_since_update'], 49]],
        0,  '#D50000',
        12, '#E62200',
        20, '#FF4500',
        28, '#FF8C00',
        36, '#FFB732',
        42, '#FFD996',
        48, '#FFF5E0'
    ];
    map.addLayer({
        id: layerId,
        type: 'circle',
        source: sourceId,
        'source-layer': sourceLayerName,
        minzoom: 5,
        layout: {
            'circle-sort-key': ['-', 48, ['to-number', ['coalesce', ['get', 'hours_since_update'], 49]]]
        },
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.0, 6.5, 6, 9, 11],
            'circle-blur':   ['interpolate', ['linear'], ['zoom'], 5, 0.2, 6.5, 0.55, 9, 0.9],
            'circle-color': ageGradient,
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.015, 6.5, 0.35, 9, 0.69],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0.05, 6.5, 0.5, 9, 1],
            'circle-stroke-color': ageGradient,
            'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.015, 6.5, 0.35, 9, 0.69]
        }
    });

    createFirePointInteractionHandlers(layerId, p => firmsHotspotToHtml(p, 'Satellite Hotspot'));
    npMoveHotspotsBelowAgencyPoints();
}

// ========================
// Burned Areas Layer (MVT IMPLEMENTATION for FireDB:fire_pg_combined)
// ========================
function setupBurnedAreasMVTLayer() {
    const sourceId = 'burned-areas-mvt-source'; 
    const fillLayerId = 'burned-areas-mvt-fill';   
    const outlineLayerId = 'burned-areas-mvt-outline'; 
    const sourceLayerName = 'fire_pg_combined'; 
    const mvtUrl = 'https://geo.firemap.live/geoserver/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=FireDB:fire_pg_combined&STYLE=&TILEMATRIXSET=EPSG:900913&FORMAT=application/vnd.mapbox-vector-tile&TILEMATRIX=EPSG:900913:{z}&TILECOL={x}&TILEROW={y}';

    if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
    if (map.getLayer(outlineLayerId)) map.removeLayer(outlineLayerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    map.addSource(sourceId, {
        type: 'vector',
        tiles: [mvtUrl],
        minzoom: 5, 
        maxzoom: 12 
    });
    burnedAreasLayerAdded = true; 

    const beforeAgencyLayerId = [
        'usa-fire-points-labels-fon', 'usa-fire-points',
        'canada-fire-points-labels-fon', 'canada-fire-points',
        'fire-points-aus-labels-fon', 'fire-points-aus',
        'fire-points-europe-labels-fon', 'fire-points-europe'
    ].find(id => map.getLayer(id));

    map.addLayer({
        'id': fillLayerId, 'type': 'fill', 'source': sourceId, 'source-layer': sourceLayerName,
        'minzoom': BURNED_AREA_VISIBILITY_ZOOM_THRESHOLD, 
        'paint': { 'fill-color': '#FFFF00', 'fill-opacity': 0.2 },
        'layout': { 'visibility': 'none' } 
    }, beforeAgencyLayerId); 

    map.addLayer({
        'id': outlineLayerId, 'type': 'line', 'source': sourceId, 'source-layer': sourceLayerName,
        'minzoom': BURNED_AREA_VISIBILITY_ZOOM_THRESHOLD, 
        'paint': { 'line-color': '#8B0000', 'line-width': 1.8 },
        'layout': { 'visibility': 'none' } 
    }, beforeAgencyLayerId); 
    
    handleZoomForBurnedAreas(); 
}

function handleZoomForBurnedAreas() {
    const checkbox = document.getElementById('burned-areas-toggle');
    const isChecked = checkbox ? checkbox.checked : false;
    const currentZoom = map.getZoom();
    const fillLayerId = 'burned-areas-mvt-fill';
    const outlineLayerId = 'burned-areas-mvt-outline';

    const shouldBeVisible = isChecked && currentZoom >= BURNED_AREA_VISIBILITY_ZOOM_THRESHOLD;

    if (!burnedAreasLayerAdded) { 
        if (shouldBeVisible) { 
            setupBurnedAreasMVTLayer(); 
        }
        return; 
    }
    
    if (map.getLayer(fillLayerId)) map.setLayoutProperty(fillLayerId, 'visibility', shouldBeVisible ? 'visible' : 'none');
    if (map.getLayer(outlineLayerId)) map.setLayoutProperty(outlineLayerId, 'visibility', shouldBeVisible ? 'visible' : 'none');
}

// ========================
// Info Box & Map Click
// ========================
map.on('click', (e) => {
    let clickedOnMarker = false;
    if (e.originalEvent && e.originalEvent.target) {
        let el = e.originalEvent.target;
        while (el && el !== map.getContainer()) {
            if (el.classList && (el.classList.contains('mapboxgl-marker') || el.classList.contains('disaster-marker'))) {
                clickedOnMarker = true;
                break;
            }
            el = el.parentElement;
        }
    }

    if (clickedOnMarker) { 
        return;
    }
    
    if (e.defaultPrevented) {
        return;
    }

    const pointLayersWithOwnHandlers = [
        'usa-fire-points', 
        'canada-fire-points', 
        'fire-points-aus',
        'fire-points-europe', 
        'combined-fire-points', 'combined-fire-points-3d',
        'usa-nasa-firms-24hrs-pt', 'usa-nasa-firms-24hrs-pt-3d',
        'global-firms-hotspots', 'global-firms-hotspots-3d'
    ].filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') === 'visible');

    let featuresFromPointLayers = [];
    if (pointLayersWithOwnHandlers.length > 0) {
        try {
            featuresFromPointLayers = map.queryRenderedFeatures(e.point, { layers: pointLayersWithOwnHandlers });
        } catch (err) { console.error("Error querying point layers in generic click:", err); }
    }

    if (featuresFromPointLayers.length > 0) {
        return; 
    }
    
    const otherQueryableLayers = [
        'historical-layer', 
        'burned-areas-mvt-fill'
    ].filter(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') === 'visible');

    let featuresFromOtherLayers = [];
    if (otherQueryableLayers.length > 0) {
        try {
            featuresFromOtherLayers = map.queryRenderedFeatures(e.point, { layers: otherQueryableLayers });
        } catch (err) { console.error("Error querying other layers in generic click:", err); }
    }

    if (featuresFromOtherLayers.length > 0) {
        e.preventDefault(); 
        if (featuresFromOtherLayers[0].layer.id === 'historical-layer') {
            renderHistoricalInfo(featuresFromOtherLayers[0]);
        } else if (featuresFromOtherLayers[0].layer.id === 'burned-areas-mvt-fill') {
            const infoBox = document.getElementById('infoBox');
            if (infoBox) { infoBox.innerHTML = ''; infoBox.style.display = 'none'; }
            clearNextPassCard();
            clearHotspotTicker();
            if (activePopup) { activePopup.remove(); activePopup = null; }
        }
    } else {
        const infoBox = document.getElementById('infoBox');
        if (infoBox) {
            infoBox.innerHTML = '';
            infoBox.style.display = 'none';
        }
        clearNextPassCard();
        clearHotspotTicker();
        if (activePopup) { 
            activePopup.remove(); 
            activePopup = null; 
        }
    }
});

// ========================
// Debounce & Search
// ========================
function debounce(f,d){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>f.apply(this,a),d);};}
function searchFires(q){ 
    const lQ=q.toLowerCase();
    const uR=(usFirePoints||[]).filter(f=>f.properties.fire_name&&f.properties.fire_name.toLowerCase().includes(lQ));
    const aR=(australiaFirePoints||[]).filter(f=>f.properties.fire_name&&f.properties.fire_name.toLowerCase().includes(lQ));
    const cR=(canadaFirePoints||[]).filter(f=>f.properties.fire_name&&f.properties.fire_name.toLowerCase().includes(lQ));
    return[...uR,...aR, ...cR];
}
function displayResults(fires){ 
    const rC=document.getElementById('searchResults');rC.innerHTML='';if(fires.length===0){rC.innerHTML='<li>No results.</li>';return;}fires.forEach(fire=>{const li=document.createElement('li');li.textContent=`${fire.properties.fire_name} (${fire.geometry.coordinates[1].toFixed(2)},${fire.geometry.coordinates[0].toFixed(2)})`;li.style.cursor='pointer';li.addEventListener('click',()=>{const p=fire.properties;const d=p.size_acres?usaFirePropertiesToHtml(p):genericFirePropertiesToHtml(p);document.getElementById('infoBox').innerHTML=d;document.getElementById('infoBox').style.display='block';if(document.querySelector('#infoBox [data-np-detect-epoch]')){_npStartHotspotTicker();}renderNextPassCard(p,fire.geometry.coordinates);npRenderFDRCard(p);map.flyTo({center:fire.geometry.coordinates,zoom:10,essential:true});document.getElementById('searchPanel').classList.remove('active');});rC.appendChild(li);});
}

// ========================
// Layer List Panel
// ========================
function toggleLayer(layerId,isChecked){ 
    if(layerId==='disaster-points'){
        disasterMarkers.forEach(m=>m.getElement().style.display=isChecked?'block':'none');
        if (isChecked && typeof renderVisibleDisasterPoints === 'function') renderVisibleDisasterPoints();
    } else if(layerId==='volcano-points'){
        volcanoMarkers.forEach(m=>m.getElement().style.display=isChecked?'block':'none');
    } else if (layerId === 'smoke-layer-toggle') {
        if (!smokeLayerAdded || !map.getLayer('smoke-raster-layer')) return;
        if (isChecked) { handleZoomForSmokeLayer(); } 
        else { if (map.getLayer('smoke-raster-layer')) { map.setLayoutProperty('smoke-raster-layer', 'visibility', 'none');}}
    } else if(layerId==='burned-areas-toggle'){ 
        handleZoomForBurnedAreas(); 
    } else if (layerId === 'hurricane-tracks') {
        if (typeof npToggleHurricanes === 'function') npToggleHurricanes(isChecked);
    } else if (layerId === 'satellite-orbit') {
        if (typeof npToggleSatellites === 'function') npToggleSatellites(isChecked);
    } else if (layerId === 'usa-fire-points' || layerId === 'canada-fire-points' || layerId === 'fire-points-aus' || layerId === 'fire-points-europe') {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', isChecked ? 'visible' : 'none');
        const labelLayerId = layerId + '-labels-fon';
        if (map.getLayer(labelLayerId)) map.setLayoutProperty(labelLayerId, 'visibility', isChecked ? 'visible' : 'none');
        const pulseLayerId = layerId + '-pulse';
        if (map.getLayer(pulseLayerId)) map.setLayoutProperty(pulseLayerId, 'visibility', isChecked ? 'visible' : 'none');
        if (map.getLayer(pulseLayerId + '-outer')) map.setLayoutProperty(pulseLayerId + '-outer', 'visibility', isChecked ? 'visible' : 'none');
    } else { 
        if(map.getLayer(layerId)) map.setLayoutProperty(layerId,'visibility',isChecked?'visible':'none');
        else console.warn(`Layer ${layerId} not found for toggle.`);
    }
}

// ========================
// Volcano Layers
// ========================
function removeVolcanoLayers(){volcanoMarkers.forEach(m=>m.remove());volcanoMarkers=[];}
function addVolcanoLayers(){ 
    removeVolcanoLayers();
    const volcanoCheckbox = document.getElementById('volcano-points');
    const isVolcanoChecked = volcanoCheckbox ? volcanoCheckbox.checked : false;
    fetch('https://geo.firemap.live/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=FireDB%3Avolcano_active_score&outputFormat=application%2Fjson')
     .then(r=>r.json()).then(d=>{
        if(!d||d.type!=='FeatureCollection')throw new Error('Inv Volcano GeoJSON');
        const cM=(fS,iU,s)=>{
            d.features.filter(f=>f.properties.volcano_heat_score_daily===fS).forEach(f=>{
                const el=document.createElement('div');el.className='marker volcano-marker';el.style.backgroundImage=`url(${iU})`;el.style.width=s;el.style.height=s;el.style.backgroundSize='cover';
                el.style.display = isVolcanoChecked ? 'block' : 'none';
                const pP=new mapboxgl.Popup({offset:25,closeOnClick:false}).setHTML(`<div style="font-family:Nunito,sans-serif;color:#333"><strong>Volcano:</strong> ${f.properties.volcanoname||'N/A'}<br><strong>Country:</strong> ${f.properties.country||'N/A'}<br><strong>Elev:</strong> ${f.properties.elevation||'N/A'}m<br><strong>Score:</strong> ${f.properties.volcano_heat_score_daily||'N/A'}</div>`);
                const mK=new mapboxgl.Marker(el).setLngLat(f.geometry.coordinates).setPopup(pP).addTo(map);
                volcanoMarkers.push(mK);
                el.addEventListener('click',e=>{e.stopPropagation();if(activePopup&&activePopup!==pP)activePopup.remove();if(pP.isOpen()){pP.remove();activePopup=null;}else{pP.addTo(map);activePopup=pP;}});
            });
        };
        cM('High','https://firemap.live/map_icons/volcano_high.png','20px');cM('Medium','https://firemap.live/map_icons/volcano_medium.png','20px');cM('Low','https://firemap.live/map_icons/volcano_low.png','20px');cM('No Activity','https://firemap.live/map_icons/volcano_zero.png','12px');
    }).catch(e=>console.error('Volcano Err:',e.message));
}

// ========================
// Button Event Listeners & UI
// ========================
document.getElementById('logoBtn').addEventListener('click',() => { npApplyDefaultView(true); });
document.getElementById('toggleLayersBtn').addEventListener('click',()=>document.getElementById('layerListPanel').classList.toggle('active'));
document.getElementById('closeLayerList').addEventListener('click',()=>document.getElementById('layerListPanel').classList.remove('active'));
document.getElementById('layerListForm').addEventListener('change',e=>{if(e.target&&e.target.type==='checkbox')toggleLayer(e.target.id,e.target.checked);});
document.getElementById('basemapBtn').addEventListener('click',()=>document.getElementById('basemapDropdown').classList.toggle('active'));
document.getElementById('basemapSelector').addEventListener('change',e=>{map.setStyle(e.target.value);document.getElementById('basemapDropdown').classList.remove('active');});
document.getElementById('searchBtn').addEventListener('click',()=>document.getElementById('searchPanel').classList.add('active'));
document.getElementById('locateMeBtn').addEventListener('click', () => {
    const locateBtn = document.getElementById('locateMeBtn');
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }
    locateBtn.classList.add('locating');

    const success = (position) => {
        const { latitude, longitude } = position.coords;

        if (userLocationMarker) {
            userLocationMarker.remove();
        }

        const markerEl = document.createElement('div');
        markerEl.className = 'user-location-marker';

        userLocationMarker = new mapboxgl.Marker(markerEl)
            .setLngLat([longitude, latitude])
            .addTo(map);

        map.panTo([longitude, latitude]);
        
        locateBtn.classList.remove('locating');
    };

    const error = (err) => {
        locateBtn.classList.remove('locating');
        console.error(`Geolocation Error (${err.code}): ${err.message}`);
        let alertMsg = "An unknown error occurred while trying to find you.";
        if (err.code === err.PERMISSION_DENIED) alertMsg = "Location access was denied. To use this feature, please enable location services in your browser settings.";
        if (err.code === err.POSITION_UNAVAILABLE) alertMsg = "Your location information is currently unavailable.";
        if (err.code === err.TIMEOUT) alertMsg = "The request to get your location timed out.";
        alert(alertMsg);
    };

    navigator.geolocation.getCurrentPosition(success, error, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
});
document.getElementById('closeSearchPanel').addEventListener('click',()=>{document.getElementById('searchPanel').classList.remove('active');document.getElementById('searchInput').value='';document.getElementById('searchResults').innerHTML='';});
document.getElementById('searchInput').addEventListener('keypress',e=>{if(e.key==='Enter')displayResults(searchFires(e.target.value.trim()));});
document.getElementById('aboutBtn').addEventListener('click',()=>document.getElementById('aboutPanel').classList.add('active'));
document.getElementById('closeAboutPanel').addEventListener('click',()=>document.getElementById('aboutPanel').classList.remove('active'));
const legendBtn = document.getElementById('legendBtn'); const legendPanel = document.getElementById('legendPanel'); const closeLegendPanelBtn = document.getElementById('closeLegendPanel'); const smokeLegendTrigger = document.getElementById('smokeLegendTrigger'); const smokeColorRampPopup = document.getElementById('smokeColorRampPopup'); let smokeLegendTimeout;
if (legendBtn && legendPanel) { legendBtn.addEventListener('click', () => { const isActive = legendPanel.classList.toggle('active'); legendBtn.setAttribute('aria-expanded', isActive); if (!isActive && smokeColorRampPopup) { smokeColorRampPopup.style.display = 'none';}}); }
if (closeLegendPanelBtn && legendPanel) { closeLegendPanelBtn.addEventListener('click', () => { legendPanel.classList.remove('active'); if(legendBtn) legendBtn.setAttribute('aria-expanded', 'false'); if (smokeColorRampPopup) smokeColorRampPopup.style.display = 'none'; }); }
if (smokeLegendTrigger && smokeColorRampPopup) { smokeLegendTrigger.addEventListener('mouseenter', () => { clearTimeout(smokeLegendTimeout); smokeColorRampPopup.style.display = 'block'; }); smokeLegendTrigger.addEventListener('mouseleave', () => { smokeLegendTimeout = setTimeout(() => { if (!smokeColorRampPopup.matches(':hover')) { smokeColorRampPopup.style.display = 'none';}}, 300);}); smokeColorRampPopup.addEventListener('mouseenter', () => { clearTimeout(smokeLegendTimeout); }); smokeColorRampPopup.addEventListener('mouseleave', () => { smokeLegendTimeout = setTimeout(() => { smokeColorRampPopup.style.display = 'none'; }, 300); }); }

// ========================
// Historical Fires Integration (MVT)
// ========================
function renderHistoricalInfo(feature) { 
  const p = feature.properties;
  const formatArea = (areaValue) => { if (areaValue === null || typeof areaValue === 'undefined' || String(areaValue).trim() === '') return 'N/A'; const num = parseFloat(String(areaValue).replace(/,/g, '')); return !isNaN(num) ? num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 }) : String(areaValue); };
  let displayIgnitionDate = p.ignitiondate || 'N/A';
  if (p.ignitiondate) { try { const dateObj = new Date(p.ignitiondate); if (!isNaN(dateObj.getTime())) { displayIgnitionDate = dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } else { displayIgnitionDate = String(p.ignitiondate);}} catch (e) { console.warn("Could not parse ignitiondate:", p.ignitiondate, e); displayIgnitionDate = String(p.ignitiondate);}}
  const html = `<h3>${p.fire_name || 'Historical Fire Event'}</h3><strong>Year:</strong> ${p.year || 'N/A'}<br><strong>Ignition Date:</strong> ${displayIgnitionDate}<br><strong>Area (Acres):</strong> ${formatArea(p.area_ac)}<br><strong>Area (Hectares):</strong> ${formatArea(p.area_ha)}`;
  const box = document.getElementById('infoBox'); box.innerHTML = html; box.style.display = 'block'; clearNextPassCard(); clearHotspotTicker();
}
function handleHistoricalClick(e){if(e.features&&e.features.length>0 && e.features[0].layer.id === 'historical-layer')renderHistoricalInfo(e.features[0]);} 
function handleHistoricalMouseEnter(e){if(e.features && e.features.length > 0 && e.features[0].layer.id === 'historical-layer') map.getCanvas().style.cursor='pointer';}
function handleHistoricalMouseLeave(){map.getCanvas().style.cursor='';}
function bindHistoricalEvents(lId){ 
    if(!map.getLayer(lId)){console.warn(`No layer: ${lId} to bind events`);return;} map.off('click',lId,handleHistoricalClick);map.off('mouseenter',lId,handleHistoricalMouseEnter);map.off('mouseleave',lId,handleHistoricalMouseLeave); map.on('click',lId,handleHistoricalClick);map.on('mouseenter',lId,handleHistoricalMouseEnter);map.on('mouseleave',lId,handleHistoricalMouseLeave);
}
function _updateHistoricalUIVisibility() { 
    const panel = document.getElementById('historicalFiresPanel'); const button = document.getElementById('historicalFiresBtn'); if (!panel || !button) { console.warn("Historical UI elements not found."); return; } if (historicalFiresActive) { panel.style.display = 'block'; button.classList.add('active'); } else { panel.style.display = 'none'; button.classList.remove('active'); }
}
function activateHistoricalFires(){ 
    const sourceId = 'historical-fires'; const layerId = 'historical-layer';
    const url = 'https://geo.firemap.live/geoserver/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=FireDB:fire_pg_historical_2025&STYLE=&TILEMATRIXSET=EPSG:900913&FORMAT=application/vnd.mapbox-vector-tile&TILEMATRIX=EPSG:900913:{z}&TILECOL={x}&TILEROW={y}';
    if(!map.getSource(sourceId)){ map.addSource(sourceId,{type:'vector',tiles:[url],minzoom:0,maxzoom:14});} 
    if(!map.getLayer(layerId)){ map.addLayer({id:layerId,type:'fill',source:sourceId,'source-layer':'fire_pg_historical_2025',paint:{'fill-color':'#FF5722','fill-opacity':0.2,'fill-outline-color':'#BF360C'},layout:{visibility:'none'}}); bindHistoricalEvents(layerId);}
    document.getElementById('year-input').value = ''; document.getElementById('show-all').checked = true;
    historicalFiresActive = true; _updateHistoricalUIVisibility(); updateHistoricalFilter();
}
function deactivateHistoricalFires(){ historicalFiresActive = false; _updateHistoricalUIVisibility(); if(map.getLayer('historical-layer'))map.setLayoutProperty('historical-layer','visibility','none');}
function updateHistoricalFilter(){ 
    if(!historicalFiresActive){ if(map.getLayer('historical-layer')) map.setLayoutProperty('historical-layer', 'visibility', 'none'); return;}
    const yearInputEl = document.getElementById('year-input'); const showAllCheckboxEl = document.getElementById('show-all');
    const year = yearInputEl.value.trim(); const showAll = showAllCheckboxEl.checked;
    const historicalLayerId = 'historical-layer';
    if(!map.getLayer(historicalLayerId)) return; 
    if(showAll){
        yearInputEl.value = ''; map.setFilter(historicalLayerId, null); map.setLayoutProperty(historicalLayerId,'visibility','visible');
        return;
    }
    if(!year || !/^\d{4}$/.test(year)){ map.setLayoutProperty(historicalLayerId,'visibility','none'); return; }
    map.setFilter(historicalLayerId, ['==', ['to-number', ['get', 'year']], parseInt(year)]);
    map.setLayoutProperty(historicalLayerId,'visibility','visible');
}
const hFB=document.getElementById('historicalFiresBtn'); if(hFB){ hFB.addEventListener('click',(event)=>{ event.stopPropagation(); if(historicalFiresActive){ deactivateHistoricalFires();} else { activateHistoricalFires();}}); }
const yIEl=document.getElementById('year-input'); if(yIEl){ yIEl.addEventListener('input',debounce(()=>{ const showAllCheckbox = document.getElementById('show-all'); if (showAllCheckbox) showAllCheckbox.checked = false; updateHistoricalFilter();},500));}
const sACEl=document.getElementById('show-all'); if(sACEl){ sACEl.addEventListener('change', ()=>{ updateHistoricalFilter(); });}

// ========================
// Map Event Listeners and Initial Layer Loading
// ========================
function addAllLayers() {
    addSmokeLayer();
    addGlobalFIRMSLayer();
    addUSAFIRMSPointsLayer(); 
    npAddFCIFootprintLayer();
    addCombinedSatelliteHotspotLayer(); 
    setupBurnedAreasMVTLayer(); 
    addEuropeFirePointsLayer(); 
    addUSAFirePointsLayer(); 
    addCanadaFirePointsLayer(); 
    addAustralianFirePointsLayer(); 
    addDisasterLayer(); 
    addVolcanoLayers();
    npAddHurricaneLayer();
    npAddSatelliteLayer();
    npApplyVeRamp();

    const layerCheckboxes = [
        'combined-fire-points', 'usa-fire-points', 'canada-fire-points',
        'fire-points-aus', 'fire-points-europe', 'usa-nasa-firms-24hrs-pt',
        'global-firms-hotspots', 'burned-areas-toggle', 'smoke-layer-toggle',
        'satellite-orbit', 'hurricane-tracks'
    ];
    layerCheckboxes.forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) {
            if (id === 'burned-areas-toggle') handleZoomForBurnedAreas();
            else if (id === 'smoke-layer-toggle') {
                if (smokeLayerAdded && map.getLayer('smoke-raster-layer')) {
                     if (checkbox.checked) handleZoomForSmokeLayer();
                     else map.setLayoutProperty('smoke-raster-layer', 'visibility', 'none');
                }
            } else toggleLayer(id, checkbox.checked);
        }
    });
}

map.on('load', function() {
  addAllLayers(); 
  map.on('zoomend', handleZoomForSmokeLayer);
  map.on('zoomend', handleZoomForBurnedAreas); 
  historicalFiresActive = false;
  _updateHistoricalUIVisibility();
  showNewFeatureNotification();
});

map.on('style.load', function() {
  console.log("Map 'style.load' event triggered. Re-adding all layers.");
  
  burnedAreasLayerAdded = false; smokeLayerAdded = false;
  usFirePoints = []; australiaFirePoints = []; canadaFirePoints = [];
  disasterMarkers.forEach(marker => marker.remove()); disasterMarkers = [];
  volcanoMarkers.forEach(marker => marker.remove()); volcanoMarkers = [];

  const wasHistoricalActiveBeforeStyleChange = historicalFiresActive;
  historicalFiresActive = false; _updateHistoricalUIVisibility();

  const baMVTSrcId = 'burned-areas-mvt-source';
  const baMVTFillId = 'burned-areas-mvt-fill'; const baMVTOutlineId = 'burned-areas-mvt-outline';
  if (map.getLayer(baMVTFillId)) map.removeLayer(baMVTFillId);
  if (map.getLayer(baMVTOutlineId)) map.removeLayer(baMVTOutlineId);
  if (map.getSource(baMVTSrcId)) map.removeSource(baMVTSrcId);

  const histSourceId = 'historical-fires'; const histLayerId = 'historical-layer';
  if (map.getLayer(histLayerId)) map.removeLayer(histLayerId);
  if (map.getSource(histSourceId)) map.removeSource(histSourceId);
  
  addAllLayers(); 

  if (document.getElementById('smoke-layer-toggle')) {
      const smokeCheckbox = document.getElementById('smoke-layer-toggle');
      if (smokeLayerAdded && map.getLayer('smoke-raster-layer')) {
            if (smokeCheckbox.checked) handleZoomForSmokeLayer();
            else map.setLayoutProperty('smoke-raster-layer', 'visibility', 'none');
      }
  }
  
  if (wasHistoricalActiveBeforeStyleChange) activateHistoricalFires(); 
  else deactivateHistoricalFires(); 
});

document.addEventListener('DOMContentLoaded', () => { 
    const smokeSlider = document.getElementById('smokeOpacitySlider');
    const smokeOpacityValueDisplay = document.getElementById('smokeOpacityValue');
    if (smokeSlider) {
        if (smokeOpacityValueDisplay) smokeOpacityValueDisplay.textContent = `${smokeSlider.value}%`;
        smokeSlider.addEventListener('input', function() {
            const opacity = parseInt(this.value) / 100;
            if (map && map.getLayer && map.getLayer('smoke-raster-layer')) {
                 map.setPaintProperty('smoke-raster-layer', 'raster-opacity', opacity);
            }
            if (smokeOpacityValueDisplay) smokeOpacityValueDisplay.textContent = `${this.value}%`;
        });
    }
});

// ============================================================
// Next-Pass Info Card
// ============================================================

const NEXT_PASS_TYPENAME   = 'FireDB:satellite_next_pass_northamerica';
const NEXT_PASS_WFS        = 'https://geo.firemap.live/geoserver/ows';
const NEXT_PASS_MAX_KM     = 100;
const NEXT_PASS_TLE_STALE_H = 48;
const NEXT_PASS_RUN_STALE_H = 6;
const NEXT_PASS_MAX_FEATURES = 200;
const NEXT_PASS_MAX_ROWS   = Infinity;
const NEXT_PASS_HEADLINE_TIERS = ['excellent', 'good', 'fair'];

const NP_CACHE_TTL_MS = 5 * 60 * 1000;
const _npCache = new Map();

let _npTicker  = null;
let _npTickMs  = 0;
let _npAbort   = null;
let _npToken   = 0;

function clearNextPassCard() {
  if (_npTicker) { clearInterval(_npTicker); _npTicker = null; _npTickMs = 0; }
  if (_npAbort)  { _npAbort.abort(); _npAbort = null; }
  _npToken++;
  const el = document.getElementById('nextPassCard');
  if (el) el.remove();
}

function _npNum(v) {
  if (v === null || typeof v === 'undefined' || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function _npIsYes(v) { return String(v || '').trim().toLowerCase() === 'yes'; }

function _npNowUtc() { return Date.now(); }

function _npUtcMs(v) {
  if (!v) return null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}
function _npEsc(s) {
  return String(s === null || typeof s === 'undefined' ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _npKm(lon1, lat1, lon2, lat2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function _npCountdown(msUntilPeak, inProgress, msUntilEnd) {
  if (msUntilEnd !== null && typeof msUntilEnd !== 'undefined' && msUntilEnd <= 0) {
    return 'pass complete';
  }
  if (inProgress || msUntilPeak <= 0) return 'in view now';

  const totalSec = Math.floor(msUntilPeak / 1000);
  const min = Math.floor(totalSec / 60);

  if (min < 10)  return `in ${min} min ${String(totalSec % 60).padStart(2, '0')} s`;
  if (min < 90)  return `in ${min} min`;
  if (min < 360) return `in ${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
  return `in ${Math.round(min / 60)} hours`;
}

function _npLocalTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function _npLocalFull(ms) {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });
}
function _npUtcLabel(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

function _npReason(p) {
  const sf = _npNum(p.swath_frac);
  const geom = sf === null ? 'View geometry unknown'
             : sf < 0.3    ? 'Near nadir'
             : sf < 0.7    ? 'Mid-swath'
                           : 'Near the swath edge';

  const light = _npIsYes(p.is_night) ? 'at night' : 'in daylight';

  const tier = _npTier(p);
  if (!tier) return `${geom} ${light}.`;

  const verdict = tier === 'excellent' ? 'the best look ahead, cloud permitting'
                : tier === 'good'      ? 'a solid look, cloud permitting'
                : tier === 'fair'      ? 'a usable look, cloud permitting'
                                       : 'a weak look at best';

  return `${geom} ${light} — ${verdict}.`;
}

const NP_TIER_LABEL = { excellent: 'Best', good: 'Good', fair: 'OK', marginal: 'Poor' };
const NP_TIER_HINT = {
  excellent: 'Best viewing conditions for this pass',
  good:      'Good viewing conditions for this pass',
  fair:      'Usable viewing conditions for this pass',
  marginal:  'Weak viewing conditions for this pass'
};

function _npTier(p) {
  const t = String((p && p.detection_tier) || '').trim().toLowerCase();
  return ['excellent', 'good', 'fair', 'marginal'].includes(t) ? t : null;
}

function _npTierBadge(p) {
  const t = _npTier(p);
  return t ? `<span class="np-tier np-tier-${t}" title="${_npEsc(NP_TIER_HINT[t])}">` +
             `${NP_TIER_LABEL[t]}</span>` : '';
}

function _npTierText(p) {
  const t = _npTier(p);
  if (!t) return '';
  return `<span class="np-tt np-tt-${t}" title="${_npEsc(NP_TIER_HINT[t])}">${NP_TIER_LABEL[t]}</span>`;
}

function _npGlyph(p) {
  const night = _npIsYes(p.is_night);
  const solar = _npNum(p.solar_elev_deg);
  const detail = solar === null ? '' : ` (sun ${solar.toFixed(0)}° at the fire)`;
  const label = night ? `Night pass${detail}` : `Daylight pass${detail}`;
  return `<span class="np-glyph ${night ? 'np-glyph-night' : 'np-glyph-day'}" role="img" ` +
         `aria-label="${_npEsc(label)}" title="${_npEsc(label)}">${night ? '\u263E' : '\u2600'}</span>`;
}

function _npParseAll(features) {
  return (features || [])
    .map(f => {
      const p = (f && f.properties) || {};
      const peak = _npUtcMs(p.pass_peak_utc);
      const end  = _npUtcMs(p.pass_end_utc);
      let lon = null, lat = null;
      if (f && f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
        lon = _npNum(f.geometry.coordinates[0]);
        lat = _npNum(f.geometry.coordinates[1]);
      }
      return { p, peak, end, lon, lat, inProgress: _npIsYes(p.in_progress) };
    })
    .filter(r => r.peak !== null)
    .sort((a, b) => a.peak - b.peak);
}

function _npUpcoming(rows) {
  const now = _npNowUtc();
  return rows.filter(r => (r.end !== null ? r.end : r.peak) > now - 60000);
}

function _npPickGroup(rows, coordinates) {
  if (!rows.length) return { rows: [], rejected: false };

  const groups = new Map();
  rows.forEach(r => {
    const k = (r.p.fire_id === null || typeof r.p.fire_id === 'undefined') ? '_nofireid' : String(r.p.fire_id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });

  const haveCoords = Array.isArray(coordinates) &&
                     _npNum(coordinates[0]) !== null && _npNum(coordinates[1]) !== null;

  if (!haveCoords) {
    return groups.size === 1 ? { rows, rejected: false } : { rows: [], rejected: true };
  }

  let best = null, bestKm = Infinity;
  groups.forEach(g => {
    const pts = g.filter(r => r.lon !== null && r.lat !== null);
    if (!pts.length) return;
    const km = Math.min(...pts.map(r => _npKm(coordinates[0], coordinates[1], r.lon, r.lat)));
    if (km < bestKm) { bestKm = km; best = g; }
  });

  if (!best) return { rows: groups.size === 1 ? rows : [], rejected: groups.size > 1 };
  if (bestKm > NEXT_PASS_MAX_KM) {
    console.warn(`[next-pass] nearest name match is ${bestKm.toFixed(0)} km away — discarded`);
    return { rows: [], rejected: true };
  }
  return { rows: best, rejected: false };
}

function _npTick() {
  const card = document.getElementById('nextPassCard');
  if (!card) { clearNextPassCard(); return; }

  const now = _npNowUtc();
  let soonest = Infinity;

  card.querySelectorAll('[data-np-peak]').forEach(el => {
    const peak = Number(el.dataset.npPeak);
    const endRaw = el.dataset.npEnd;
    const end = endRaw ? Number(endRaw) : null;
    const diff = peak - now;
    if (diff > 0 && diff < soonest) soonest = diff;
    el.textContent = _npCountdown(diff, el.dataset.npInprogress === '1', end === null ? null : end - now);
    if (end !== null && end - now <= 0) el.classList.add('np-done');
  });

  const want = soonest < 10 * 60 * 1000 ? 1000 : 20000;
  if (want !== _npTickMs) {
    clearInterval(_npTicker);
    _npTickMs = want;
    _npTicker = setInterval(_npTick, want);
  }
}

function _npStartTicker() {
  if (_npTicker) clearInterval(_npTicker);
  _npTickMs = 1000;
  _npTicker = setInterval(_npTick, _npTickMs);
  _npTick();
}

function npFmtArea(v) {
  const n = Number(String(v).replace(/,/g, ''));
  if (v === null || typeof v === 'undefined' || String(v).trim() === '' || isNaN(n)) return 'Unknown';
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function npInfoBoxLayout(primaryHtml, restHtml) {
  return `<div class="np-primary">${primaryHtml}</div>` +
         (restHtml && restHtml.trim()
           ? `<details class="np-more"><summary>More details</summary>` +
             `<div class="np-more-body">${restHtml}</div></details>`
           : '') +
         `<div id="npCardSlot"></div>`;
}

function _npMount(html) {
  const box = document.getElementById('infoBox');
  if (!box) return null;
  const existing = document.getElementById('nextPassCard');
  if (existing) existing.remove();
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const node = wrap.firstElementChild;
  const slot = document.getElementById('npCardSlot');
  if (slot) slot.appendChild(node); else box.appendChild(node);
  return node;
}

function _npShell(inner, title) {
  return `<section id="nextPassCard" class="np-card" role="region" aria-labelledby="npCardTitle">
    <h3 id="npCardTitle" class="np-title">${title || 'Hotspot forecast'}</h3>
    ${inner}
  </section>`;
}

function _npNote(text) {
  return _npShell(`<p class="np-note">${_npEsc(text)}</p>`);
}

function _npCountdownEl(row, cls) {
  return `<span class="${cls}" data-np-peak="${row.peak}"` +
         (row.end !== null ? ` data-np-end="${row.end}"` : '') +
         (row.inProgress ? ` data-np-inprogress="1"` : '') + `>…</span>`;
}

function _npHeadlineIndex(rows) {
  const i = rows.findIndex(r => NEXT_PASS_HEADLINE_TIERS.includes(_npTier(r.p)));
  return i >= 0 ? i : 0;
}

function _npBuild(rows) {
  const headIdx   = _npHeadlineIndex(rows);
  const head      = rows[headIdx];
  const p         = head.p;
  const isQuality = NEXT_PASS_HEADLINE_TIERS.includes(_npTier(p));
  const anyTiers  = rows.some(r => _npTier(r.p));

  const platform = _npEsc(p.platform || 'Unknown platform');
  const sensor   = _npEsc(p.sensor || '');

  const headline = `
    <div class="np-headline">
      <div class="np-count" aria-hidden="true">${_npCountdownEl(head, 'np-count-val')}</div>
      <p class="np-sr">Peak at ${_npEsc(_npLocalFull(head.peak))}, ${_npEsc(_npUtcLabel(head.peak))}.</p>
      <div class="np-meta">
        <span class="np-plat">${platform}</span>
        ${sensor ? `<span class="np-sep" aria-hidden="true">·</span><span class="np-sensor">${sensor}</span>` : ''}
        ${_npGlyph(p)}
        ${_npTierBadge(p)}
      </div>
      <p class="np-when">${_npEsc(_npLocalFull(head.peak))}
        <span class="np-utc">${_npEsc(_npUtcLabel(head.peak))}</span></p>
      <p class="np-reason">${_npEsc(_npReason(p))}</p>
    </div>`;

  const remaining = rows.filter((r, i) => i !== headIdx);
  const rest = remaining.slice(0, Math.max(0, NEXT_PASS_MAX_ROWS - 1));
  const hidden = remaining.length - rest.length;
  let timeline = '';
  if (rest.length) {
    const body = rest.map(r => {
      const q = r.p;
      const tier = _npTierText(q);
      const sensor = _npEsc(q.sensor || '');
      const sub = sensor && tier ? `${sensor} · ${tier}` : (sensor || tier);
      return `<tr>
        <th scope="row" class="np-c-time" title="${_npEsc(_npUtcLabel(r.peak))}">${_npEsc(_npLocalTime(r.peak))}${_npGlyph(q)}</th>
        <td class="np-c-sat">${_npEsc(q.platform || '—')}${sub ? `<span class="np-c-sensor">${sub}</span>` : ''}</td>
        <td class="np-c-in">${_npCountdownEl(r, 'np-row-count')}</td>
      </tr>`;
    }).join('');

    timeline = `
      <details class="np-timeline">
        <summary>${hidden > 0
          ? `Showing ${rest.length} of ${remaining.length} other passes`
          : `${rest.length} other pass${rest.length === 1 ? '' : 'es'} ahead`}</summary>
        <table class="np-table">
          <caption class="np-sr">Upcoming satellite passes over this fire, soonest first. Times are local.</caption>
          <thead><tr>
            <th scope="col" class="np-w-time">Time</th>
            <th scope="col" class="np-w-sat">Satellite</th>
            <th scope="col" class="np-w-in">In</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </details>`;
  }

  const marginalNote = (anyTiers && !isQuality)
    ? `<p class="np-advisory">No strong pass ahead. Showing the soonest.</p>` : '';

  const maxTle = rows.reduce((m, r) => {
    const epoch = _npUtcMs(r.p.tle_epoch_utc);
    const a = epoch !== null ? (_npNowUtc() - epoch) / 3600000 : _npNum(r.p.tle_age_h);
    return a !== null && a > m ? a : m;
  }, 0);
  const tleNote = maxTle > NEXT_PASS_TLE_STALE_H
    ? `<p class="np-advisory">Orbital elements are ${Math.round(maxTle)} h old. Timings may drift.</p>` : '';

  const runMs = _npUtcMs(head.p.datetimenow);
  const runAgeH = runMs !== null ? (_npNowUtc() - runMs) / 3600000 : null;
  const runNote = (runAgeH !== null && runAgeH > NEXT_PASS_RUN_STALE_H)
    ? `<p class="np-advisory">Predictions generated ${Math.round(runAgeH)} h ago.</p>` : '';

  return _npShell(headline + timeline + marginalNote + runNote + tleNote,
                  'Hotspot forecast');
}

async function renderNextPassCard(fireProps, coordinates) {
  clearNextPassCard();
  _npInjectPassCardStyles();
  _npInstallInfoBoxClose();

  const box = document.getElementById('infoBox');
  if (!box) return;

  const fireName = fireProps && fireProps.fire_name;
  if (!fireName || !String(fireName).trim()) return;

  const token = _npToken;
  _npMount(_npNote('Checking upcoming passes…'));

  const cql = `fire_name='${String(fireName).replace(/'/g, "''")}'`;
  const url = NEXT_PASS_WFS +
    '?service=WFS&version=1.0.0&request=GetFeature' +
    '&typeName=' + encodeURIComponent(NEXT_PASS_TYPENAME) +
    '&outputFormat=' + encodeURIComponent('application/json') +
    '&maxFeatures=' + NEXT_PASS_MAX_FEATURES +
    '&cql_filter=' + encodeURIComponent(cql);

  const cached = _npCache.get(fireName);
  let features;

  if (cached && Date.now() - cached.t < NP_CACHE_TTL_MS) {
    features = cached.features;
  } else {
    _npAbort = new AbortController();
    try {
      const res = await fetch(url, { signal: _npAbort.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      features = (data && data.features) || [];
      _npCache.set(fireName, { t: Date.now(), features });
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.warn('[next-pass] WFS request failed:', err);
      if (token === _npToken) _npMount(_npNote('Pass predictions did not load. Reselect the fire to retry.'));
      return;
    }
    if (token !== _npToken) return;
  }

  const parsed   = _npParseAll(features);
  const upcoming = _npUpcoming(parsed);
  const picked   = _npPickGroup(upcoming, coordinates);

  if (!picked.rows.length) {
    let msg;
    if (picked.rejected) {
      msg = 'No pass predictions matched this fire location.';
    } else if (parsed.length) {
      const last = parsed[parsed.length - 1];
      msg = `Every predicted pass has already run — the last was ${_npLocalFull(last.peak)}. ` +
            'The prediction run is behind.';
    } else {
      msg = 'No passes predicted in the next 24 hours. Predictions cover North America only.';
    }
    _npMount(_npNote(msg));
    return;
  }

  _npMount(_npBuild(picked.rows));
  _npStartTicker();
}

// ------------------------------------------------------------
// Remembered map view.
// ------------------------------------------------------------
const NP_REMEMBER_VIEW = true;
const NP_VIEW_KEY = 'firemap.view';
const NP_DEFAULT_VIEW = { center: [-40, 35], zoom: 2 };

function npView() {
  const b = map.getBounds(), c = map.getCenter();
  const r = n => Number(n.toFixed(4));
  const out = {
    bounds: `{ bounds: [[${r(b.getWest())}, ${r(b.getSouth())}], [${r(b.getEast())}, ${r(b.getNorth())}]] }`,
    fixed:  `{ center: [${r(c.lng)}, ${r(c.lat)}], zoom: ${Number(map.getZoom().toFixed(2))} }`
  };
  return out;
}
let npRestoredView = false;

function npSaveView() {
  if (!NP_REMEMBER_VIEW || typeof map === 'undefined') return;
  try {
    const c = map.getCenter();
    localStorage.setItem(NP_VIEW_KEY, JSON.stringify({
      lng: Number(c.lng.toFixed(5)),
      lat: Number(c.lat.toFixed(5)),
      zoom: Number(map.getZoom().toFixed(2))
    }));
  } catch (e) { }
}

function npRestoreView() {
  if (!NP_REMEMBER_VIEW || typeof map === 'undefined') return false;
  if (typeof isValidLng !== 'undefined' && isValidLng && isValidLat) return false;
  try {
    const v = JSON.parse(localStorage.getItem(NP_VIEW_KEY) || 'null');
    if (!v) return false;
    const ok = n => typeof n === 'number' && isFinite(n);
    if (!ok(v.lng) || !ok(v.lat) || !ok(v.zoom)) return false;
    if (v.lng < -180 || v.lng > 180 || v.lat < -90 || v.lat > 90 || v.zoom < 0 || v.zoom > 22) return false;
    map.jumpTo({ center: [v.lng, v.lat], zoom: v.zoom });
    return true;
  } catch (e) { return false; }
}

function npApplyDefaultView(animate) {
  if (typeof map === 'undefined') return;
  const v = NP_DEFAULT_VIEW;
  if (Array.isArray(v.bounds)) {
    map.fitBounds(v.bounds, { padding: 20, animate: !!animate, duration: animate ? 1000 : 0 });
  } else if (animate) {
    map.flyTo({ center: v.center, zoom: v.zoom, essential: true });
  } else {
    map.jumpTo({ center: v.center, zoom: v.zoom });
  }
}

function npInstallViewMemory() {
  if (typeof map === 'undefined') return;
  if (NP_REMEMBER_VIEW) {
    npRestoredView = npRestoreView();
    map.on('moveend', debounce(npSaveView, 600));
  }
  if (!npRestoredView && !(typeof isValidLng !== 'undefined' && isValidLng && isValidLat)) {
    npApplyDefaultView(false);
  }
}
npInstallViewMemory();

// ------------------------------------------------------------
// Locate control.
// The stock mapboxgl.GeolocateControl used to be added here at 'bottom-right',
// which duplicated the toolbar's #locateMeBtn. The toolbar button is the one we
// keep (custom marker + styling); the map control has been removed.
// ------------------------------------------------------------
function npClearStaleGeoIp() {
  try { localStorage.removeItem('firemap.geoip'); } catch (e) { }
}
npClearStaleGeoIp();

// ------------------------------------------------------------
// Close affordance for #infoBox.
// ------------------------------------------------------------
function closeInfoBox() {
  const box = document.getElementById('infoBox');
  if (box) { box.innerHTML = ''; box.style.display = 'none'; }
  clearNextPassCard();
  clearHotspotTicker();
  if (typeof activePopup !== 'undefined' && activePopup) { activePopup.remove(); activePopup = null; }
}

function _npInstallInfoBoxClose() {
  const box = document.getElementById('infoBox');
  if (!box || box.dataset.npCloseInstalled === '1') return;
  box.dataset.npCloseInstalled = '1';
  _npInjectPassCardStyles();

  const ensure = () => {
    if (box.style.display === 'none' || !box.innerHTML.trim()) return;
    if (box.querySelector('.np-close')) return;
    const rail = document.createElement('div');
    rail.className = 'np-close-rail';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'np-close';
    b.setAttribute('aria-label', 'Close fire details');
    b.title = 'Close';
    b.textContent = '\u00D7';
    b.addEventListener('click', e => { e.stopPropagation(); closeInfoBox(); });
    rail.appendChild(b);
    box.insertBefore(rail, box.firstChild);
  };

  new MutationObserver(ensure).observe(box, {
    childList: true, attributes: true, attributeFilter: ['style']
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && box.style.display !== 'none' && box.innerHTML.trim()) closeInfoBox();
  });

  ensure();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _npInstallInfoBoxClose);
} else {
  _npInstallInfoBoxClose();
}

// ------------------------------------------------------------
// Styles. Injected once.
// ------------------------------------------------------------
function _npInjectPassCardStyles() {
  if (document.getElementById('npCardStyles')) return;
  const s = document.createElement('style');
  s.id = 'npCardStyles';
  s.textContent = `
  .np-close-rail { position: sticky; top: 0; height: 0; z-index: 6; }
  .np-close {
    position: absolute; right: -2px; top: -4px;
    background: rgba(43,43,43,0.94); border: 0; color: #C9C9C9;
    font-size: 18px; line-height: 1; padding: 3px 7px;
    cursor: pointer; border-radius: 4px; font-family: inherit;
  }
  .np-close:hover { background: rgba(255,255,255,0.16); color: #FFFFFF; }
  .np-close:focus-visible { outline: 2px solid #FF6347; outline-offset: 1px; }
  #infoBox h2, #infoBox h3 { padding-right: 26px; }

  .np-primary { font-size: 11px; line-height: 1.5; }

  .np-more { margin-top: 8px; }
  .np-more > summary {
    font-size: 10px; color: #FF6347; cursor: pointer;
    padding: 3px 0; list-style: none; user-select: none;
  }
  .np-more > summary::-webkit-details-marker { display: none; }
  .np-more > summary::before { content: '▸ '; }
  .np-more[open] > summary::before { content: '▾ '; }
  .np-more > summary:focus-visible,
  .np-more > summary:focus { outline: 2px solid #FF6347; outline-offset: 2px; border-radius: 2px; }
  .np-more-body { font-size: 11px; line-height: 1.5; margin-top: 2px; }

  #npCardSlot:empty { display: none; }

  .np-card {
    margin-top: 10px; padding-top: 8px;
    border-top: 1px solid rgba(255,255,255,0.15);
  }
  .np-title {
    font-size: 11px !important; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.06em;
    color: #FF6347; margin: 0 0 6px 0 !important;
  }
  .np-note { font-size: 10px; color: #C9C9C9; margin: 0; line-height: 1.35; }

  .np-headline {
    background: rgba(255,255,255,0.05);
    border-left: 2px solid #FF6347;
    border-radius: 4px; padding: 7px 8px;
  }
  .np-count { font-size: 20px; font-weight: 700; line-height: 1.1; color: #FFFFFF; }
  .np-count .np-done { color: #9A9A9A; }
  .np-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 4px; }
  .np-plat { font-size: 11px; font-weight: 700; color: #FFFFFF; }
  .np-sensor { font-size: 10px; color: #C9C9C9; }
  .np-sep { color: #7A7A7A; font-size: 10px; }
  .np-when { font-size: 10px; color: #C9C9C9; margin: 4px 0 0 0 !important; line-height: 1.3; }
  .np-utc { display: block; font-size: 9px; color: #8F8F8F; }
  .np-reason { font-size: 10px; color: #E8E8E8; margin: 5px 0 0 0 !important; line-height: 1.35; }

  .np-glyph { font-size: 11px; line-height: 1; cursor: help; }
  .np-glyph-night { color: #9EC5FF; }
  .np-glyph-day   { color: #FFD37A; }

  .np-tier {
    font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    padding: 1px 5px; border-radius: 3px; color: #FFFFFF; white-space: nowrap;
  }
  .np-tier-excellent { background: #28a745; }
  .np-tier-good      { background: #007bff; }
  .np-tier-fair      { background: #ffc107; color: #2b2b2b; }
  .np-tier-marginal  { background: #6c757d; }
  .np-tier-unknown   { background: #4a4a4a; }

  .np-timeline { margin-top: 8px; }
  .np-timeline > summary {
    font-size: 10px; color: #FF6347; cursor: pointer;
    padding: 3px 0; list-style: none; user-select: none;
  }
  .np-timeline > summary::-webkit-details-marker { display: none; }
  .np-timeline > summary::before { content: '▸ '; display: inline-block; transition: none; }
  .np-timeline[open] > summary::before { content: '▾ '; }
  .np-timeline > summary:focus-visible,
  .np-timeline > summary:focus { outline: 2px solid #FF6347; outline-offset: 2px; border-radius: 2px; }

  .np-table { width: 100%; border-collapse: collapse; margin-top: 3px; table-layout: fixed; }
  .np-w-time { width: 28%; } .np-w-sat { width: 42%; } .np-w-in { width: 30%; }
  .np-table th, .np-table td {
    text-align: left; font-size: 10px; font-weight: normal;
    padding: 3px 4px 3px 0; vertical-align: middle;
    border-bottom: 1px solid rgba(255,255,255,0.07);
  }
  .np-table thead th {
    font-size: 9px; color: #8F8F8F; text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid rgba(255,255,255,0.15);
  }
  .np-c-time { color: #FFFFFF; font-weight: 700 !important; white-space: nowrap; }
  .np-c-time .np-glyph { margin-left: 4px; font-size: 10px; }
  .np-c-sat { color: #E8E8E8; line-height: 1.2; }
  .np-c-sensor { display: block; font-size: 9px; color: #8F8F8F; }
  .np-c-in { color: #C9C9C9; text-align: right; white-space: nowrap; padding-right: 0 !important; }

  .np-tt { font-weight: 700; font-size: 10px; }
  .np-tt-excellent { color: #5FD07C; }
  .np-tt-good      { color: #5AA9FF; }
  .np-tt-fair      { color: #FFC94D; }
  .np-tt-marginal  { color: #C2C9D0; }
  .np-row-count.np-done { color: #7A7A7A; }

  .np-advisory {
    font-size: 9px; color: #FFC107; margin: 6px 0 0 0 !important; line-height: 1.35;
  }

  /* Satellite hotspot caveats. Collapsed by default so the popup stays small. */
  #infoBox .np-firms-note { margin-top: 8px; }
  #infoBox .np-firms-note > summary {
    font-size: 10px; color: #FF6347; cursor: pointer;
    padding: 3px 0; list-style: none; user-select: none;
  }
  #infoBox .np-firms-note > summary::-webkit-details-marker { display: none; }
  #infoBox .np-firms-note > summary::before { content: '▸ '; }
  #infoBox .np-firms-note[open] > summary::before { content: '▾ '; }
  #infoBox .np-firms-note-body p {
    font-size: 10px; line-height: 1.4; color: #C9C9C9; margin: 5px 0 0 0 !important;
  }
  #infoBox .np-firms-note-body strong { color: #E8E8E8; }
  #infoBox .np-firms-note-body .np-firms-note-warn {
    color: #FFC107; font-size: 9px; line-height: 1.35;
  }

  .np-sr {
    position: absolute !important; width: 1px; height: 1px;
    padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
  }

  @media (max-width: 768px) {
    .np-card { margin-top: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.15); }
    .np-count { font-size: 17px; }
    .np-table th, .np-table td { font-size: 9px; }
    .np-c-sensor, .np-utc { font-size: 8px; }
  }
  `;
  document.head.appendChild(s);
}

// ============================================================
// Fire Danger Rating & FWI card (today + next 2 days, trend arrows)
// ============================================================

(function () {
  'use strict';

  var NP_FDR_STYLE_ID = 'np-fdr-styles';
  var NP_FDR_TODAY_MINUS = false;

  var NP_FDR_RATINGS = {
    low:      { label: 'Low',      bg: '#57A639', fg: '#0f2405', rank: 0 },
    moderate: { label: 'Moderate', bg: '#F2C744', fg: '#332600', rank: 1 },
    high:     { label: 'High',     bg: '#F28C28', fg: '#2b1600', rank: 2 },
    vhigh:    { label: 'V. high',  bg: '#E5484D', fg: '#ffffff', rank: 3 },
    extreme:  { label: 'Extreme',  bg: '#8B1A1A', fg: '#ffffff', rank: 4 }
  };

  var NP_FDR_ALIASES = {
    low: 'low', verylow: 'low', vlow: 'low',
    moderate: 'moderate', mod: 'moderate', medium: 'moderate',
    high: 'high',
    veryhigh: 'vhigh', vhigh: 'vhigh', vh: 'vhigh',
    extreme: 'extreme', veryextreme: 'extreme'
  };

  var NP_FDR_TRENDS = {
    up:     'fa-arrow-trend-up',
    down:   'fa-arrow-trend-down',
    steady: 'fa-minus'
  };

  function npNormFDRRating(v) {
    if (v === null || typeof v === 'undefined' || v === '') return null;
    var s = String(v).trim().toLowerCase().replace(/[\s._\-\/]+/g, '');
    if (!s) return null;
    if (NP_FDR_ALIASES[s]) return NP_FDR_ALIASES[s];
    
    // Numeric FWI to standard Danger Rating classes
    var n = Number(String(v).trim());
    if (!isNaN(n)) {
      if (n < 5.2) return 'low';
      if (n < 11.2) return 'moderate';
      if (n < 21.3) return 'high';
      if (n < 38.0) return 'vhigh';
      return 'extreme';
    }
    return null;
  }

  function _fdrEsc(s) {
    return String(s === null || typeof s === 'undefined' ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function npInjectFDRStyles() {
    if (document.getElementById(NP_FDR_STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = NP_FDR_STYLE_ID;
    s.textContent =
      '.np-fdr-card{background:#1F1F1F;border:1px solid #3a3a3a;border-radius:12px;' +
        'padding:10px 12px;color:#EDEDED;font-family:"Lexend",sans-serif;' +
        'width:100%;box-sizing:border-box;margin-top:8px;}' +
      '.np-fdr-head{display:flex;align-items:center;gap:6px;margin-bottom:8px;}' +
      '.np-fdr-head i{font-size:15px;color:#FF6347;}' +
      '.np-fdr-title{font-size:13px;font-weight:600;letter-spacing:.02em;}' +
      '.np-fdr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;}' +
      '.np-fdr-day{text-align:center;}' +
      '.np-fdr-daylbl{font-size:11px;color:#9a9a9a;margin-bottom:4px;}' +
      '.np-fdr-chip{font-size:11.5px;font-weight:600;border-radius:6px;padding:3px 2px;' +
        'display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;}' +
      '.np-fdr-chip i{font-size:10px;}';
    document.head.appendChild(s);
  }

  function npFDRDayLabels() {
    var labels = ['Today'];
    for (var i = 1; i <= 2; i++) {
      labels.push(new Date(Date.now() + i * 86400000)
        .toLocaleDateString(undefined, { weekday: 'short' }));
    }
    return labels;
  }

  function npFDRDaysFromProps(p) {
    if (!p) return [];

    var d1 = (p.fdr_daily !== undefined && p.fdr_daily !== null) ? p.fdr_daily
           : ((p.fwi_daily !== undefined && p.fwi_daily !== null) ? p.fwi_daily
           : ((p.fwi_d1 !== undefined && p.fwi_d1 !== null) ? p.fwi_d1 : p.fwi));

    var d2 = (p.fdr_nextday !== undefined && p.fdr_nextday !== null) ? p.fdr_nextday
           : ((p.fwi_d2 !== undefined && p.fwi_d2 !== null) ? p.fwi_d2
           : ((p.fwi_nextday !== undefined && p.fwi_nextday !== null) ? p.fwi_nextday : null));

    var d3 = (p.fdr_nextday_plus1 !== undefined && p.fdr_nextday_plus1 !== null) ? p.fdr_nextday_plus1
           : ((p.fwi_d3 !== undefined && p.fwi_d3 !== null) ? p.fwi_d3
           : ((p.fwi_nextday_plus1 !== undefined && p.fwi_nextday_plus1 !== null) ? p.fwi_nextday_plus1
           : ((p.fwi_d2_plus1 !== undefined && p.fwi_d2_plus1 !== null) ? p.fwi_d2_plus1 : null)));

    var raw = [d1, d2, d3];
    var labels = npFDRDayLabels();
    var out = [], prevRank = null;

    for (var i = 0; i < raw.length; i++) {
      if (raw[i] === null || typeof raw[i] === 'undefined' || raw[i] === '') continue;
      var key = npNormFDRRating(raw[i]);
      if (!key) continue;
      var rank = NP_FDR_RATINGS[key].rank;
      var trend = null;
      if (prevRank !== null) trend = rank > prevRank ? 'up' : rank < prevRank ? 'down' : 'steady';
      else if (NP_FDR_TODAY_MINUS && i === 0) trend = 'steady';
      out.push({ label: labels[i], rating: key, trend: trend });
      prevRank = rank;
    }
    return out;
  }

  function npBuildFDRDay(day) {
    var key = NP_FDR_RATINGS[day.rating] ? day.rating : npNormFDRRating(day.rating);
    if (!key) return '';
    var r = NP_FDR_RATINGS[key];
    var icon = day.trend && NP_FDR_TRENDS[day.trend]
      ? ' <i class="fa-solid ' + NP_FDR_TRENDS[day.trend] + '"></i>' : '';
    return (
      '<div class="np-fdr-day">' +
        '<div class="np-fdr-daylbl">' + _fdrEsc(day.label) + '</div>' +
        '<div class="np-fdr-chip" style="background:' + r.bg + ';color:' + r.fg + ';">' +
          r.label + icon +
        '</div>' +
      '</div>'
    );
  }

  function npUpdateFDR(days) {
    var grid = document.querySelector('#infoBox .np-fdr-grid') ||
               document.querySelector('.np-fdr-grid');
    if (!grid || !Array.isArray(days)) return;
    var rows = days.slice(0, 3);
    grid.style.gridTemplateColumns = 'repeat(' + Math.max(1, rows.length) + ',minmax(0,1fr))';
    grid.innerHTML = rows.map(npBuildFDRDay).join('');
  }

  function npClearFDRCard() {
    var el = document.querySelector('#infoBox .np-fdr-card');
    if (el) el.remove();
  }

  function npRenderFDRCard(fireProps) {
    var box = document.getElementById('infoBox');
    if (!box) return;
    npClearFDRCard();
    var days = npFDRDaysFromProps(fireProps);
    if (!days.length) return;
    npInjectFDRStyles();
    var card = document.createElement('div');
    card.className = 'np-fdr-card';
    card.innerHTML =
      '<div class="np-fdr-head">' +
        '<i class="fa-solid fa-fire"></i>' +
        '<span class="np-fdr-title">Fire danger rating</span>' +
      '</div>' +
      '<div class="np-fdr-grid"></div>';
    var primary = box.querySelector('.np-primary');
    if (primary) primary.insertAdjacentElement('afterend', card);
    else box.appendChild(card);
    npUpdateFDR(days);
  }

  window.npRenderFDRCard = npRenderFDRCard;
  window.npClearFDRCard = npClearFDRCard;
  window.npUpdateFDR = npUpdateFDR;
})();

// ============================================================
// Hurricane Track Layer
// ============================================================

(function () {
  'use strict';

  var NP_HURR_TYPENAME     = 'FireDB:google_deepmindhurricanetracks';
  var NP_HURR_WFS          = 'https://geo.firemap.live/geoserver/ows';
  var NP_HURR_SAMPLE       = 0;
  var NP_HURR_REFRESH_MIN  = 15;
  var NP_HURR_MAX_FEATURES = 20000;
  var NP_HURR_LOOKBACK_H   = 6;
  var NP_HURR_TICK_MS      = 1000;

  var NP_HURR_STYLE_ID = 'np-hurr-styles';
  var NP_HURR_LINE_SRC = 'hurricane-tracks-src';
  var NP_HURR_LINE_ID  = 'hurricane-tracks';
  var NP_HURR_FIX_SRC  = 'hurricane-fixes-src';
  var NP_HURR_FIX_ID   = 'hurricane-fix-points';
  var NP_HURR_FIXLBL_ID = 'hurricane-fix-labels';
  var NP_HURR_LABEL_MINZOOM = 5;

  var NP_HURR_CATS = [
    { min: 137, key: 'c5', label: 'Category 5 Hurricane', color: '#D96BE8', size: 30 },
    { min: 113, key: 'c4', label: 'Category 4 Hurricane', color: '#FF5A5A', size: 27 },
    { min: 96,  key: 'c3', label: 'Category 3 Hurricane', color: '#FF8C42', size: 25 },
    { min: 83,  key: 'c2', label: 'Category 2 Hurricane', color: '#FFB84D', size: 23 },
    { min: 64,  key: 'c1', label: 'Category 1 Hurricane', color: '#FFE066', size: 21 },
    { min: 34,  key: 'ts', label: 'Tropical Storm',       color: '#4DD0C7', size: 18 },
    { min: 0,   key: 'td', label: 'Tropical Depression',  color: '#6EC1FF', size: 16 }
  ];
  function _hurrCat(kt) {
    if (kt === null || typeof kt === 'undefined' || isNaN(kt)) {
      return { key: 'unk', label: 'Unknown intensity', color: '#9AA4AD', size: 16 };
    }
    for (var i = 0; i < NP_HURR_CATS.length; i++) {
      if (kt >= NP_HURR_CATS[i].min) return NP_HURR_CATS[i];
    }
    return NP_HURR_CATS[NP_HURR_CATS.length - 1];
  }

  function _hurrMs(v) {
    if (v === null || typeof v === 'undefined') return null;
    var s = String(v).trim();
    if (/^\d{14}$/.test(s)) {
      return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
                      +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
    }
    return _npUtcMs(s);
  }

  var _tracks  = new Map();
  var _markers = new Map();
  var _ticker = null;
  var _refresher = null;
  var _lastFetch = 0;
  var _fetching = false;
  var _zoomBound = false;

  function _hurrCql(withSample) {
    var parts = [];
    if (withSample && NP_HURR_SAMPLE !== null) parts.push('sample=' + NP_HURR_SAMPLE);
    if (NP_HURR_LOOKBACK_H !== null) {
      var d = new Date(Date.now() - NP_HURR_LOOKBACK_H * 3600000);
      parts.push('valid_time AFTER ' + d.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    }
    return parts.join(' AND ');
  }

  function _hurrFetch(noSampleRetry) {
    if (_fetching) return;
    _fetching = true;
    var cql = _hurrCql(!noSampleRetry);
    var url = NP_HURR_WFS + '?service=WFS&version=1.0.0&request=GetFeature' +
      '&typeName=' + encodeURIComponent(NP_HURR_TYPENAME) +
      '&outputFormat=' + encodeURIComponent('application/json') +
      '&maxFeatures=' + NP_HURR_MAX_FEATURES +
      (cql ? '&cql_filter=' + encodeURIComponent(cql) : '');
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      _fetching = false;
      var feats = (d && d.features) || [];
      if (!feats.length && !noSampleRetry && NP_HURR_SAMPLE !== null) {
        _hurrFetch(true);
        return;
      }
      _lastFetch = Date.now();
      _hurrIngest(feats);
      _hurrRebuild();
    }).catch(function (e) {
      _fetching = false;
      console.error('Hurricane Err:', e.message);
    });
  }

  function _hurrIngest(features) {
    var rows = [];
    features.forEach(function (f) {
      var p = (f && f.properties) || {};
      var t = _hurrMs(p.valid_time);
      if (t === null) return;
      var lon = null, lat = null;
      if (f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
        lon = _npNum(f.geometry.coordinates[0]);
        lat = _npNum(f.geometry.coordinates[1]);
      }
      if (lon === null) lon = _npNum(p.lon);
      if (lat === null) lat = _npNum(p.lat);
      if (lon === null || lat === null) return;
      rows.push({
        id: String(p.track_id || 'Unknown storm'),
        sample: _npNum(p.sample),
        initMs: _hurrMs(p.init_time),
        t: t, lon: lon, lat: lat,
        kt: _npNum(p.maximum_sustained_wind_speed_knots),
        hpa: _npNum(p.minimum_sea_level_pressure_hpa),
        leadH: _npNum(p.lead_time_hours),
        rmwKm: _npNum(p.radius_of_maximum_winds_km),
        r34: [_npNum(p.radius_34_knot_winds_ne_km), _npNum(p.radius_34_knot_winds_se_km),
              _npNum(p.radius_34_knot_winds_sw_km), _npNum(p.radius_34_knot_winds_nw_km)]
      });
    });

    var newestInit = new Map();
    rows.forEach(function (r) {
      var cur = newestInit.get(r.id);
      if (r.initMs !== null && (typeof cur === 'undefined' || r.initMs > cur)) newestInit.set(r.id, r.initMs);
    });

    var chosenSample = new Map();
    rows.forEach(function (r) {
      var ni = newestInit.get(r.id);
      if (r.initMs !== null && typeof ni !== 'undefined' && r.initMs !== ni) return;
      if (r.sample === null) return;
      var cur = chosenSample.get(r.id);
      if (NP_HURR_SAMPLE !== null && cur === NP_HURR_SAMPLE) return;
      if (NP_HURR_SAMPLE !== null && r.sample === NP_HURR_SAMPLE) { chosenSample.set(r.id, r.sample); return; }
      if (typeof cur === 'undefined' || r.sample < cur) chosenSample.set(r.id, r.sample);
    });

    _tracks.clear();
    rows.forEach(function (r) {
      var ni = newestInit.get(r.id);
      if (r.initMs !== null && typeof ni !== 'undefined' && r.initMs !== ni) return;
      var cs = chosenSample.get(r.id);
      if (typeof cs !== 'undefined') { if (r.sample !== cs) return; }
      else if (r.sample !== null) return;
      var tr = _tracks.get(r.id);
      if (!tr) { tr = { pts: [], initMs: r.initMs, sample: r.sample, peakKt: null, now: null }; _tracks.set(r.id, tr); }
      tr.pts.push(r);
      if (r.kt !== null && (tr.peakKt === null || r.kt > tr.peakKt)) tr.peakKt = r.kt;
    });

    var now = Date.now();
    Array.from(_tracks.keys()).forEach(function (id) {
      var tr = _tracks.get(id);
      tr.pts.sort(function (a, b) { return a.t - b.t; });
      for (var i = 1; i < tr.pts.length; i++) {
        var prev = tr.pts[i - 1].lon, cur = tr.pts[i].lon;
        while (cur - prev > 180) cur -= 360;
        while (cur - prev < -180) cur += 360;
        tr.pts[i].lon = cur;
      }
      if (!tr.pts.length || tr.pts[tr.pts.length - 1].t <= now) _tracks.delete(id);
    });
    console.log('[hurricane] tracks loaded:', _tracks.size);
  }

  function _hurrOn() {
    var cb = document.getElementById('hurricane-tracks');
    return cb ? cb.checked : true;
  }

  function _hurrLineData() {
    var fc = { type: 'FeatureCollection', features: [] };
    _tracks.forEach(function (tr, id) {
      if (tr.pts.length < 2) return;
      fc.features.push({
        type: 'Feature',
        properties: { track_id: id, color: _hurrCat(tr.peakKt).color },
        geometry: { type: 'LineString', coordinates: tr.pts.map(function (p) { return [p.lon, p.lat]; }) }
      });
    });
    return fc;
  }

  function _hurrFixLabel(ms) {
    return new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric' });
  }
  function _hurrPointData() {
    var now = Date.now();
    var fc = { type: 'FeatureCollection', features: [] };
    _tracks.forEach(function (tr, id) {
      var color = _hurrCat(tr.peakKt).color;
      tr.pts.forEach(function (p) {
        if (p.t <= now) return;
        fc.features.push({
          type: 'Feature',
          properties: { track_id: id, color: color, label: _hurrFixLabel(p.t) },
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] }
        });
      });
    });
    return fc;
  }

  function _hurrRebuild() {
    if (typeof map === 'undefined' || !map.getStyle) return;
    _hurrInjectStyles();

    if (map.getLayer(NP_HURR_LINE_ID)) map.removeLayer(NP_HURR_LINE_ID);
    if (map.getSource(NP_HURR_LINE_SRC)) map.removeSource(NP_HURR_LINE_SRC);
    map.addSource(NP_HURR_LINE_SRC, { type: 'geojson', data: _hurrLineData() });
    map.addLayer({
      id: NP_HURR_LINE_ID, type: 'line', source: NP_HURR_LINE_SRC,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1, 6, 2, 9, 3],
        'line-opacity': 0.55,
        'line-dasharray': [1, 2]
      },
      layout: { 'line-cap': 'round', 'visibility': _hurrOn() ? 'visible' : 'none' }
    });

    if (map.getLayer(NP_HURR_FIXLBL_ID)) map.removeLayer(NP_HURR_FIXLBL_ID);
    if (map.getLayer(NP_HURR_FIX_ID)) map.removeLayer(NP_HURR_FIX_ID);
    if (map.getSource(NP_HURR_FIX_SRC)) map.removeSource(NP_HURR_FIX_SRC);
    map.addSource(NP_HURR_FIX_SRC, { type: 'geojson', data: _hurrPointData() });
    map.addLayer({
      id: NP_HURR_FIX_ID, type: 'circle', source: NP_HURR_FIX_SRC,
      minzoom: NP_HURR_LABEL_MINZOOM,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], NP_HURR_LABEL_MINZOOM, 2, 9, 3.5],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.85,
        'circle-stroke-color': '#1F1F1F',
        'circle-stroke-width': 1
      },
      layout: { 'visibility': _hurrOn() ? 'visible' : 'none' }
    });
    map.addLayer({
      id: NP_HURR_FIXLBL_ID, type: 'symbol', source: NP_HURR_FIX_SRC,
      minzoom: NP_HURR_LABEL_MINZOOM,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Lexend Bold', 'Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], NP_HURR_LABEL_MINZOOM, 9, 9, 12],
        'text-offset': [0, 0.8],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'visibility': _hurrOn() ? 'visible' : 'none'
      },
      paint: {
        'text-color': '#FFFFFF',
        'text-halo-color': '#1F1F1F',
        'text-halo-width': 1.4,
        'text-halo-blur': 0.4
      }
    });

    if (!_zoomBound && map.on) {
      _zoomBound = true;
      map.on('zoom', _hurrQueueSizes);
      map.on('zoomend', _hurrApplySizes);
    }

    _hurrSyncMarkers();
    if (_tracks.size) _hurrStartTicker();
  }

  function _hurrSyncMarkers() {
    Array.from(_markers.keys()).forEach(function (id) {
      if (!_tracks.has(id)) { _markers.get(id).marker.remove(); _markers.delete(id); }
    });
    _tracks.forEach(function (tr, id) {
      if (_markers.has(id)) return;
      var el = document.createElement('div');
      el.className = 'np-hurr-marker';
      el.innerHTML = '<span class="np-hurr-scale"><i class="fa-solid fa-hurricane"></i></span>';
      el.title = id;
      el.style.display = _hurrOn() ? 'block' : 'none';
      el.addEventListener('click', function (e) { e.stopPropagation(); _hurrShowInfo(id); });
      var p0 = tr.pts[0];
      var marker = new mapboxgl.Marker({ element: el }).setLngLat([p0.lon, p0.lat]).addTo(map);
      el.firstElementChild.style.transform = 'scale(' + _hurrScale().toFixed(3) + ')';
      _markers.set(id, { marker: marker, el: el, scaleEl: el.firstElementChild,
                         icon: el.firstElementChild.firstElementChild, catKey: null, cw: null });
    });
  }

  function _hurrScale() {
    var z = (typeof map !== 'undefined' && map.getZoom) ? map.getZoom() : 4;
    if (z <= 3) return 0.75;
    if (z >= 9) return 1.7;
    if (z <= 6) return 0.75 + ((z - 3) / 3) * 0.25;
    return 1.0 + ((z - 6) / 3) * 0.7;
  }
  var _lastScale = null;
  var _sizeRaf = null;
  function _hurrApplySizes() {
    var s = _hurrScale();
    if (_lastScale !== null && Math.abs(s - _lastScale) < 0.01) return;
    _lastScale = s;
    var t = 'scale(' + s.toFixed(3) + ')';
    _markers.forEach(function (m) { if (m.scaleEl) m.scaleEl.style.transform = t; });
  }
  function _hurrQueueSizes() {
    if (_sizeRaf) return;
    _sizeRaf = requestAnimationFrame(function () { _sizeRaf = null; _hurrApplySizes(); });
  }

  function _hurrTick() {
    var now = Date.now();
    _tracks.forEach(function (tr, id) {
      var m = _markers.get(id);
      if (!m) return;
      if (m.el.style.display === 'none') return;
      var pts = tr.pts, a = null, b = null;
      for (var i = 0; i < pts.length; i++) {
        if (pts[i].t <= now) a = pts[i]; else { b = pts[i]; break; }
      }
      var lon, lat, kt;
      if (!a) {
        a = pts[0]; b = pts[0]; lon = a.lon; lat = a.lat; kt = a.kt;
      } else if (!b) {
        b = a; lon = a.lon; lat = a.lat; kt = a.kt;
      } else {
        var frac = Math.max(0, Math.min(1, (now - a.t) / (b.t - a.t)));
        lon = a.lon + (b.lon - a.lon) * frac;
        lat = a.lat + (b.lat - a.lat) * frac;
        kt = (a.kt !== null && b.kt !== null) ? a.kt + (b.kt - a.kt) * frac
           : (a.kt !== null ? a.kt : b.kt);
      }
      m.marker.setLngLat([lon, lat]);
      tr.now = { lon: lon, lat: lat, kt: kt, a: a, b: b };

      var cat = _hurrCat(kt);
      if (m.catKey !== cat.key) {
        m.catKey = cat.key;
        m.icon.style.color = cat.color;
        m.icon.style.fontSize = cat.size + 'px';
      }
      var wantCw = lat < 0;
      if (m.cw !== wantCw) { m.cw = wantCw; m.el.classList.toggle('np-hurr-cw', wantCw); }
    });
  }

  function _hurrStartTicker() {
    if (_ticker) return;
    _ticker = setInterval(_hurrTick, NP_HURR_TICK_MS);
    _hurrTick();
  }

  function _hurrShowInfo(id) {
    var tr = _tracks.get(id);
    var box = document.getElementById('infoBox');
    if (!tr || !box) return;
    clearNextPassCard();
    clearHotspotTicker();
    var s = tr.now || {};
    var a = s.a, b = s.b;
    var cat = _hurrCat(s.kt);
    var primary =
      '<strong>Status:</strong> <span style="color:' + cat.color + '; font-weight: bold;">' + _npEsc(cat.label) + '</span><br>' +
      (s.kt !== null && typeof s.kt !== 'undefined'
        ? '<strong>Max sustained wind:</strong> ' + Math.round(s.kt) + ' kt (' + Math.round(s.kt * 1.852) + ' km/h)<br>' : '') +
      (a && a.hpa !== null ? '<strong>Min pressure:</strong> ' + Math.round(a.hpa) + ' hPa<br>' : '') +
      (a ? '<strong>Last fix:</strong> ' + _npEsc(_npLocalFull(a.t)) + '<br>' : '') +
      (b && b !== a ? '<strong>Next fix:</strong> ' + _npEsc(_npLocalFull(b.t)) + '<br>' : '');
    var rest =
      (tr.initMs !== null ? '<strong>Model run:</strong> ' + _npEsc(_npLocalFull(tr.initMs)) + '<br>' : '') +
      (tr.sample !== null ? '<strong>Ensemble member:</strong> ' + tr.sample + '<br>' : '') +
      (a && a.leadH !== null ? '<strong>Lead time:</strong> ' + Math.round(a.leadH) + ' h<br>' : '') +
      (a && a.rmwKm !== null ? '<strong>Radius of max winds:</strong> ' + Math.round(a.rmwKm) + ' km<br>' : '') +
      (a && a.r34 && a.r34.some(function (v) { return v !== null; })
        ? '<strong>34 kt wind radii (NE/SE/SW/NW):</strong> ' +
          a.r34.map(function (v) { return v === null ? '—' : Math.round(v); }).join(' / ') + ' km<br>'
        : '') +
      '<strong>Source:</strong> Google DeepMind cyclone forecast<br>';
    box.innerHTML = '<h3>' + _npEsc(id) + '</h3>' + npInfoBoxLayout(primary, rest);
    box.style.display = 'block';
  }

  function _hurrInjectStyles() {
    if (document.getElementById(NP_HURR_STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = NP_HURR_STYLE_ID;
    st.textContent =
      '.np-hurr-marker{cursor:pointer;line-height:1;}' +
      '.np-hurr-scale{display:block;will-change:transform;}' +
      '.np-hurr-marker i{display:block;font-size:18px;color:#4DD0C7;' +
        'text-shadow:0 0 8px currentColor;will-change:transform;' +
        'animation:np-hurr-spin-ccw 2.6s linear infinite;}' +
      '.np-hurr-marker.np-hurr-cw i{animation-name:np-hurr-spin-cw;}' +
      '@keyframes np-hurr-spin-ccw{from{transform:rotate(360deg)}to{transform:rotate(0deg)}}' +
      '@keyframes np-hurr-spin-cw{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }

  function npAddHurricaneLayer() {
    _hurrInjectStyles();
    var freshMs = Math.max(NP_HURR_REFRESH_MIN, 5) * 60000;
    if (_tracks.size && Date.now() - _lastFetch < freshMs) {
      _hurrRebuild();
    } else {
      _hurrFetch(false);
    }
    if (NP_HURR_REFRESH_MIN > 0 && !_refresher) {
      _refresher = setInterval(function () { _hurrFetch(false); }, NP_HURR_REFRESH_MIN * 60000);
    }
  }

  function npToggleHurricanes(on) {
    [NP_HURR_LINE_ID, NP_HURR_FIX_ID, NP_HURR_FIXLBL_ID].forEach(function (lid) {
      if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', on ? 'visible' : 'none');
    });
    _markers.forEach(function (m) { m.el.style.display = on ? 'block' : 'none'; });
  }

  window.npAddHurricaneLayer = npAddHurricaneLayer;
  window.npToggleHurricanes = npToggleHurricanes;
  window.npRefreshHurricanes = function () { _hurrFetch(false); };
})();

// ============================================================
// Satellite Subpoint Track Layer  (Phase 1: fetch / parse / derive)
// ============================================================
//
// FireDB:satellite_orbit_12hr is a 12 h forward subpoint forecast, 9 platforms,
// ~15.8k points, rewritten by FME roughly every 30 min. The published view is
// missing every time column (see _satIngest notes), so this phase parses,
// groups and derives what geometry alone supports, and reports the gap.

(function () {
  'use strict';

  var NP_SAT_TYPENAME     = 'FireDB:satellite_orbit_12hr';
  var NP_SAT_WFS          = 'https://geo-origin.firemap.live/geoserver/ows';
  var NP_SAT_MAX_FEATURES = 20000;
  var NP_SAT_REFRESH_MIN  = 30;   // matches the FME write cadence
  var NP_SAT_HORIZON_H    = 12;   // each track spans exactly this
  var NP_SAT_TICK_MS      = 100;  // ~10 Hz; subpoint moves ~660 m per tick
  var NP_SAT_STALE_MIN    = 90;   // refuse to animate a run older than this
  var NP_SAT_TOGGLE_ID    = 'satellite-orbit';
  var NP_SAT_STYLE_ID     = 'np-sat-styles';
  var NP_SAT_PATH_SRC     = 'satellite-path-src';
  var NP_SAT_PATH_ID      = 'satellite-path';
  var NP_SAT_TICK_SRC     = 'satellite-path-ticks-src';
  var NP_SAT_TICK_ID      = 'satellite-path-ticks';
  var NP_SAT_TICKLBL_ID   = 'satellite-path-tick-labels';
  var NP_SAT_TICK_MINZOOM = 2;
  var NP_SAT_TICK_MIN     = 15;   // minutes between pass-time marks
  var NP_SAT_LEAD_SRC     = 'satellite-lead-src';
  var NP_SAT_LEAD_ID      = 'satellite-lead';
  var NP_SAT_CHORD_KM      = 60;       // max chord when following the great circle
  var NP_SAT_LEAD_MIN_S    = 10 * 60;  // trail never shorter than this
  var NP_SAT_LEAD_MAX_S    = 25 * 60;  // nor longer, so nine trails stay readable

  // Solar-elevation anchor solver (see _satSolveAnchor).
  var NP_SAT_SEARCH_BACK_S    = 6 * 3600;
  var NP_SAT_SEARCH_FWD_S     = 900;
  var NP_SAT_ANCHOR_PER_SAT   = 30;
  var NP_SAT_ANCHOR_MAX_RMS   = 0.5;  // deg; observed fit is ~1e-3
  var NP_SAT_ANCHOR_WINDOW_S  = 90;   // solar refinement may not move the TLE answer further

  // Marker shape. Switch live with npSatMarkerStyle('dart') etc.
  var NP_SAT_MARKER_STYLE = 'satellite';
  var NP_SAT_STYLES = {
    satellite:
      '<svg viewBox="0 0 32 32">'
      + '<path d="M11.6 16H20.4" stroke="#6E7681" stroke-width="1.5"/>'
      + '<g stroke="#0F1626" stroke-width="0.9">'
      +   '<rect x="0.9" y="10.6" width="10.4" height="10.8" rx="0.7" fill="#243A66"/>'
      +   '<rect x="20.7" y="10.6" width="10.4" height="10.8" rx="0.7" fill="#243A66"/>'
      + '</g>'
      + '<g stroke="#415F97" stroke-width="0.55" opacity="0.85" fill="none">'
      +   '<path d="M4.4 10.6v10.8M7.8 10.6v10.8M0.9 16h10.4"/>'
      +   '<path d="M24.2 10.6v10.8M27.6 10.6v10.8M20.7 16h10.4"/>'
      + '</g>'
      + '<path d="M16 8.6V4.4" stroke="#8A929B" stroke-width="1.3"/>'
      + '<circle cx="16" cy="3.5" r="1.6" fill="#AEB6C0" stroke="#23272E" stroke-width="0.7"/>'
      + '<rect x="11.7" y="8.5" width="8.6" height="15" rx="1.7" fill="#CBBFA3" '
      +   'stroke="#4A4536" stroke-width="1"/>'
      + '<path d="M11.7 13H20.3M11.7 19H20.3" stroke="#A3977A" stroke-width="0.7"/>'
      + '<circle cx="16" cy="16" r="2.6" fill="currentColor" stroke="#23272E" stroke-width="0.8"/>'
      + '</svg>',
    // Sleek delta with a notched tail. Reads as heading even at 14 px.
    dart: '<svg viewBox="0 0 24 24"><path d="M12 1.4 L20.4 21.8 L12 17.4 L3.6 21.8 Z" '
        + 'fill="currentColor" stroke="#12181C" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    // Minimal stroked chevron, no fill. Quietest option over busy basemap.
    chevron: '<svg viewBox="0 0 24 24"><path d="M4.4 18.6 L12 5.4 L19.6 18.6" fill="none" '
        + 'stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    // The honest one: the datum is a subpoint, so draw a point, and let a
    // leading chevron carry the heading instead of deforming the mark.
    subpoint: '<svg viewBox="0 0 24 24"><path d="M6.2 9.4 L12 3.4 L17.8 9.4" fill="none" '
        + 'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
        + '<circle cx="12" cy="16.2" r="4.2" fill="currentColor" stroke="#12181C" stroke-width="1.3"/></svg>',
    // Head plus a tapering wake, so direction reads from the trail.
    comet: '<svg viewBox="0 0 24 24"><path d="M12 4.5 C14.1 10.5 14.6 15.5 12 22.4 '
        + 'C9.4 15.5 9.9 10.5 12 4.5 Z" fill="currentColor" opacity="0.42"/>'
        + '<circle cx="12" cy="7" r="3.7" fill="currentColor" stroke="#12181C" stroke-width="1.2"/></svg>',
    // The original, kept for comparison. Recognisable as a satellite but it
    // has no nose, so heading rotation is meaningless on it.
    classic: '<i class="fa-solid fa-satellite"></i>'
  };

  var NP_SAT_SENSOR_COLOR = {
    'MODIS': '#C98A45', 'VIIRS': '#5C9E97', 'SLSTR': '#6486B4',
    'OLI': '#9A7AAE', 'OLI-2': '#9A7AAE', _default: '#8C939A'
  };

  // Per-platform constants. The subpoint view carries none of these, and they
  // are fixed properties of the spacecraft, so they live here rather than
  // riding along on 15.8k identical copies. half_width_km agrees with the
  // numbers quoted in the layer brief (VIIRS 1520, OLI 92.5).
  var NP_SAT_PLATFORMS = {
    'Terra':       { sensor: 'MODIS', altKm: 705,   swathKm: 2330, halfWidthKm: 1165,
                     resolutionM: 1000, duty: 'continuous',    firms: 'global' },
    'Aqua':        { sensor: 'MODIS', altKm: 705,   swathKm: 2330, halfWidthKm: 1165,
                     resolutionM: 1000, duty: 'continuous',    firms: 'global' },
    'Suomi NPP':   { sensor: 'VIIRS', altKm: 834,   swathKm: 3040, halfWidthKm: 1520,
                     resolutionM: 375,  duty: 'continuous',    firms: 'global' },
    'NOAA-20':     { sensor: 'VIIRS', altKm: 834,   swathKm: 3040, halfWidthKm: 1520,
                     resolutionM: 375,  duty: 'continuous',    firms: 'global' },
    'NOAA-21':     { sensor: 'VIIRS', altKm: 834,   swathKm: 3040, halfWidthKm: 1520,
                     resolutionM: 375,  duty: 'continuous',    firms: 'global' },
    'Sentinel-3A': { sensor: 'SLSTR', altKm: 814.5, swathKm: 1420, halfWidthKm: 710,
                     resolutionM: 1000, duty: 'continuous',    firms: 'global' },
    'Sentinel-3B': { sensor: 'SLSTR', altKm: 814.5, swathKm: 1420, halfWidthKm: 710,
                     resolutionM: 1000, duty: 'continuous',    firms: 'global' },
    'Landsat 8':   { sensor: 'OLI',   altKm: 705,   swathKm: 185,  halfWidthKm: 92.5,
                     resolutionM: 30,   duty: 'daylight_land', firms: 'us_canada' },
    'Landsat 9':   { sensor: 'OLI-2', altKm: 705,   swathKm: 185,  halfWidthKm: 92.5,
                     resolutionM: 30,   duty: 'daylight_land', firms: 'us_canada' }
  };

  var NP_SAT_FALLBACK = { sensor: null, altKm: null, swathKm: null, halfWidthKm: null,
                          resolutionM: null, duty: 'continuous', firms: 'global' };

  var _sats      = new Map();   // catnr -> track
  var _lastFetch = 0;
  var _fetching  = false;
  var _runEpoch  = null;        // seconds; recovered by _satSolveAnchor
  var _anchorRms = null;
  var _anchorN   = 0;
  var _anchorSrc = null;
  var _refresher = null;
  var _dismissBound = false;
  var _markers   = new Map();   // catnr -> { marker, el, scaleEl, icon }
  var _lastScale = null;
  var _sizeRaf   = null;
  var _zoomBound = false;
  var _ticker    = null;
  var _visBound  = false;
  var _selected  = null;   // catnr of the satellite whose path is shown
  var _pathIndex = null;
  var _trackKey  = null;

  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // --- vector helpers -------------------------------------------------

  function _satUnit(lon, lat) {
    var la = lat * D2R, lo = lon * D2R, c = Math.cos(la);
    return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)];
  }

  function _satNorm(v) {
    var m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return m > 0 ? [v[0] / m, v[1] / m, v[2] / m] : [0, 0, 0];
  }

  function _satCross(a, b) {
    return [a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]];
  }

  function _satBearing(lon1, lat1, lon2, lat2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * R2D + 360) % 360;
  }

  function _satArcKm(a, b) {
    var d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    return Math.acos(d) * 6371;
  }

  // --- fetch / ingest -------------------------------------------------

  function _satFetch() {
    if (_fetching) return;
    _fetching = true;
    var url = NP_SAT_WFS + '?service=WFS&version=1.0.0&request=GetFeature' +
      '&typeName=' + encodeURIComponent(NP_SAT_TYPENAME) +
      '&outputFormat=' + encodeURIComponent('application/json') +
      '&maxFeatures=' + NP_SAT_MAX_FEATURES;
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      _fetching = false;
      _lastFetch = Date.now();
      _satIngest((d && d.features) || []);
    }).catch(function (e) {
      _fetching = false;
      console.error('Satellite Err:', e.message);
    });
  }

  // WFS returns each platform contiguous and already in track order, so the
  // array index is the ordinal the view fails to publish as pt_index.
  // Everything below is derived from geometry; nothing is invented.
  function _satIngest(features) {
    var next = new Map();

    features.forEach(function (f) {
      var p = (f && f.properties) || {};
      if (!f.geometry || f.geometry.type !== 'Point') return;
      var c = f.geometry.coordinates;
      var lon = _npNum(c[0]), lat = _npNum(c[1]);
      if (lon === null || lat === null) return;

      var key = String(p.catnr || p.platform || '?');
      var tr = next.get(key);
      if (!tr) {
        var meta = NP_SAT_PLATFORMS[p.platform] || NP_SAT_FALLBACK;
        tr = {
          catnr: key,
          platform: String(p.platform || 'Unknown'),
          sensor: String(p.sensor || meta.sensor || ''),
          altKm: meta.altKm, swathKm: meta.swathKm, halfWidthKm: meta.halfWidthKm,
          resolutionM: meta.resolutionM, duty: meta.duty, firms: meta.firms,
          tleEpochUtc: p.tle_epoch_utc || null,
          tleAgeH: _npNum(p.tle_age_h),
          sampleS: null, groundSpeedKms: null, pts: []
        };
        next.set(key, tr);
      }

      var u = _satUnit(lon, lat);
      tr.pts.push({
        i: tr.pts.length, lon: lon, lat: lat,
        ux: u[0], uy: u[1], uz: u[2],
        rx: 0, ry: 0, rz: 0,
        heading: 0, direction: null,
        solarElev: _npNum(p.solar_elev_deg),
        isNight: _npIsYes(p.is_night)
      });
    });

    // Second pass: sample interval, cross-track basis, heading, direction.
    next.forEach(function (tr) {
      var pts = tr.pts, n = pts.length;
      if (n < 2) return;

      // The track spans exactly NP_SAT_HORIZON_H, so spacing falls out of the
      // point count: 1441 pts -> 30 s, 2881 -> 15 s.
      tr.sampleS = Math.round(NP_SAT_HORIZON_H * 3600 / (n - 1));

      for (var i = 0; i < n; i++) {
        var a = pts[i], b = pts[i < n - 1 ? i + 1 : i - 1];
        var ua = [a.ux, a.uy, a.uz], ub = [b.ux, b.uy, b.uz];

        // Tangent along travel, orthogonalised against the radial component.
        var d = [ub[0] - ua[0], ub[1] - ua[1], ub[2] - ua[2]];
        if (i === n - 1) { d = [-d[0], -d[1], -d[2]]; }
        var dot = d[0] * ua[0] + d[1] * ua[1] + d[2] * ua[2];
        var t = _satNorm([d[0] - dot * ua[0], d[1] - dot * ua[1], d[2] - dot * ua[2]]);

        // Right of travel is tangent x position (check: heading north at the
        // equator yields east).
        var r = _satNorm(_satCross(t, ua));
        a.rx = r[0]; a.ry = r[1]; a.rz = r[2];

        if (i < n - 1) {
          a.heading = _satBearing(a.lon, a.lat, b.lon, b.lat);
          a.direction = b.lat >= a.lat ? 'ascending' : 'descending';
        } else {
          a.heading = pts[i - 1].heading;
          a.direction = pts[i - 1].direction;
        }
      }

      tr.groundSpeedKms = _satArcKm([pts[0].ux, pts[0].uy, pts[0].uz],
                                    [pts[1].ux, pts[1].uy, pts[1].uz]) / tr.sampleS;
    });

    _sats = next;
    _satSolveAnchor();
    _satSummary();
    _satSyncMarkers();
    _satInstallVisibility();
    if (_selected !== null && !_sats.has(_selected)) { _selected = null; _satClearPath(); }
    _satRender();
    _satStartTicker();
    _satRedrawTracks(true);
  }

  // --- time anchor ----------------------------------------------------
  //
  // The view publishes no t_epoch / run_epoch, so the anchor is recovered from
  // the one time-bearing quantity it does carry: solar_elev_deg at each
  // subpoint. For a candidate anchor t0 the elevation at point i is fully
  // determined by (lat, lon, t0 + i * sample_s), so a least-squares fit over a
  // few hundred points spread across all 9 platforms and the full 12 h pins t0
  // down. Fitting one point would be ambiguous (a given elevation occurs twice
  // a day) and degenerate near solar noon; fitting the whole spread is neither.
  //
  // This is a workaround for a missing column, not a design. If run_epoch is
  // ever published, _satSolveAnchor should be replaced by reading it.

  function _satSolarElev(lat, lon, epochSec) {
    var n   = epochSec / 86400.0 + 2440587.5 - 2451545.0;
    var L   = (((280.460 + 0.9856474 * n) % 360) + 360) % 360 * D2R;
    var g   = (((357.528 + 0.9856003 * n) % 360) + 360) % 360 * D2R;
    var lam = L + 1.915 * D2R * Math.sin(g) + 0.020 * D2R * Math.sin(2 * g);
    var eps = (23.439 - 0.0000004 * n) * D2R;
    var dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    var ra  = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    var gm  = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
    var H   = (gm * 15 + lon) * D2R - ra;
    var la  = lat * D2R;
    return Math.asin(Math.max(-1, Math.min(1,
      Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H)))) * R2D;
  }

  function _satAnchorSamples() {
    var out = [];
    _sats.forEach(function (tr) {
      var n = tr.pts.length;
      if (n < 2 || !tr.sampleS) return;
      var stride = Math.max(1, Math.floor(n / NP_SAT_ANCHOR_PER_SAT));
      for (var i = 0; i < n; i += stride) {
        var p = tr.pts[i];
        if (p.solarElev === null) continue;
        out.push({ lat: p.lat, lon: p.lon, obs: p.solarElev, dt: i * tr.sampleS });
      }
    });
    return out;
  }

  function _satSSE(samples, t0) {
    var e = 0;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      var d = _satSolarElev(s.lat, s.lon, t0 + s.dt) - s.obs;
      e += d * d;
    }
    return e;
  }

  function _satRefine(samples, t, step) {
    var bt = t, be = _satSSE(samples, t);
    for (var pass = 0; pass < 4; pass++) {
      var s2 = step / 10;
      for (var u = bt - step; u <= bt + step + 1e-9; u += s2) {
        var e = _satSSE(samples, u);
        if (e < be) { be = e; bt = u; }
      }
      step = s2;
    }
    return { sse: be, t: bt };
  }

  // run_epoch is not published, but it is directly recoverable from two
  // fields that are: tle_age_h is the age of the orbital elements AT run
  // time, so run_epoch = tle_epoch_utc + tle_age_h * 3600.
  //
  // Nine platforms give nine independent derivations - TLE epochs spanning
  // more than half a day, ages from 12.9 h to 24.3 h - and on the run this
  // was written against they agreed to within 25 s, which is just the
  // rounding of tle_age_h to two decimals. The median is the anchor.
  //
  // This is strictly better than fitting solar elevation: no twice-a-day
  // ambiguity, no flat gradient near solar noon, no multi-hour blind scan
  // that can settle on a spurious minimum, and it still works if
  // solar_elev_deg is ever dropped.
  function _satRunEpochFromTle() {
    var vals = [];
    _sats.forEach(function (tr) {
      if (!tr.tleEpochUtc || tr.tleAgeH === null) return;
      var ms = Date.parse(tr.tleEpochUtc);
      if (isNaN(ms)) return;
      vals.push(ms / 1000 + tr.tleAgeH * 3600);
    });
    if (!vals.length) return null;
    vals.sort(function (a, b) { return a - b; });
    return {
      t: vals[Math.floor(vals.length / 2)],
      n: vals.length,
      spread: vals[vals.length - 1] - vals[0]
    };
  }

  function _satSolveAnchor() {
    _runEpoch = null; _anchorRms = null; _anchorN = 0; _anchorSrc = null;
    var samples = _satAnchorSamples();
    var tle = _satRunEpochFromTle();

    if (tle) {
      _runEpoch = Math.round(tle.t);
      _anchorSrc = 'tle (' + tle.n + ' platforms, ' + tle.spread.toFixed(0) + ' s spread)';
      // tle_age_h is rounded to 0.01 h, i.e. 36 s. Solar elevation resolves
      // finer than that, so use it to refine - but only within a tight
      // window, which removes every failure mode a free search has.
      if (samples.length >= 20) {
        var r = _satRefine(samples, tle.t, 60);
        var rmsT = Math.sqrt(r.sse / samples.length);
        if (isFinite(rmsT) && rmsT <= NP_SAT_ANCHOR_MAX_RMS &&
            Math.abs(r.t - tle.t) <= NP_SAT_ANCHOR_WINDOW_S) {
          _runEpoch = Math.round(r.t);
          _anchorRms = rmsT;
          _anchorN = samples.length;
          _anchorSrc = 'tle + solar refine';
        }
      }
      return;
    }

    // Fallback only: no usable TLE fields, so search solar elevation blind.
    if (samples.length < 20) {
      console.warn('[satellite] no TLE fields and too few solar_elev_deg samples to anchor:',
                   samples.length);
      return;
    }
    var now = Math.floor(Date.now() / 1000);
    var cand = [];
    for (var t = now - NP_SAT_SEARCH_BACK_S; t <= now + NP_SAT_SEARCH_FWD_S; t += 60) {
      cand.push({ sse: _satSSE(samples, t), t: t });
    }
    cand.sort(function (a, b) { return a.sse - b.sse; });

    // Refine the best few coarse minima, not just the first, so a narrow true
    // minimum next to a broad shallow one is not missed.
    var best = null;
    for (var k = 0; k < Math.min(3, cand.length); k++) {
      var r = _satRefine(samples, cand[k].t, 60);
      if (!best || r.sse < best.sse) best = r;
    }

    var rms = Math.sqrt(best.sse / samples.length);
    if (!isFinite(rms) || rms > NP_SAT_ANCHOR_MAX_RMS) {
      console.warn('[satellite] solar anchor rejected: rms ' + rms.toFixed(3) +
                   ' deg over ' + samples.length + ' samples exceeds ' +
                   NP_SAT_ANCHOR_MAX_RMS + '. Not animating.');
      return;
    }
    _runEpoch  = Math.round(best.t);
    _anchorRms = rms;
    _anchorN   = samples.length;
    _anchorSrc = 'solar scan (no TLE fields)';
  }

  // --- time grid / state ----------------------------------------------

  function _satTimeAt(tr, i) { return _runEpoch + i * tr.sampleS; }

  function _satEndEpoch(tr) { return _satTimeAt(tr, tr.pts.length - 1); }

  function _satRunAgeMin() {
    return _runEpoch === null ? null : (Date.now() / 1000 - _runEpoch) / 60;
  }

  // Fractional index into a track for a wall-clock time. Points are evenly
  // spaced, so this is arithmetic, not a search.
  function _satIndexAt(tr, nowSec) {
    return (nowSec - _runEpoch) / tr.sampleS;
  }

  function _satExpired() {
    if (_runEpoch === null) return true;
    var age = _satRunAgeMin();
    if (age > NP_SAT_STALE_MIN) return true;
    var now = Date.now() / 1000;
    var live = false;
    _sats.forEach(function (tr) { if (now <= _satEndEpoch(tr)) live = true; });
    return !live;
  }

  // --- markers ---------------------------------------------------------

  function _satOn() {
    var cb = document.getElementById(NP_SAT_TOGGLE_ID);
    return cb ? cb.checked : true;
  }

  function _satColor(tr) {
    return NP_SAT_SENSOR_COLOR[tr.sensor] || NP_SAT_SENSOR_COLOR._default;
  }

  function _satScale() {
    var z = (typeof map !== 'undefined' && map.getZoom) ? map.getZoom() : 4;
    if (z <= 3) return 0.95;
    if (z >= 9) return 1.5;
    return 0.95 + ((z - 3) / 6) * 0.55;
  }

  function _satApplySizes() {
    var s = _satScale();
    if (_lastScale !== null && Math.abs(s - _lastScale) < 0.01) return;
    _lastScale = s;
    var t = 'scale(' + s.toFixed(3) + ')';
    _markers.forEach(function (m) { if (m.scaleEl) m.scaleEl.style.transform = t; });
  }

  function _satQueueSizes() {
    if (_sizeRaf) return;
    _sizeRaf = requestAnimationFrame(function () { _sizeRaf = null; _satApplySizes(); });
  }

  function _satSyncMarkers() {
    Array.from(_markers.keys()).forEach(function (id) {
      if (!_sats.has(id)) { _markers.get(id).marker.remove(); _markers.delete(id); }
    });
    _sats.forEach(function (tr, id) {
      if (_markers.has(id)) return;
      var el = document.createElement('div');
      el.className = 'np-sat-marker';
      el.innerHTML = '<span class="np-sat-scale"><span class="np-sat-rot">' +
                     NP_SAT_STYLES[NP_SAT_MARKER_STYLE] + '</span></span>';
      el.title = tr.platform + ' (' + tr.sensor + ')';
      el.style.display = _satOn() ? 'block' : 'none';
      el.addEventListener('click', function (e) { e.stopPropagation(); _satSelect(id); });
      var marker = new mapboxgl.Marker({
        element: el,
        rotationAlignment: 'map',
        pitchAlignment: 'viewport'
      }).setLngLat([tr.pts[0].lon, tr.pts[0].lat]).addTo(map);
      var scaleEl = el.firstElementChild;
      var icon = scaleEl.firstElementChild;   // the rotated wrapper
      scaleEl.style.transform = 'scale(' + _satScale().toFixed(3) + ')';
      el.style.color = _satColor(tr);         // svg inherits via currentColor
      _markers.set(id, { marker: marker, el: el, scaleEl: scaleEl, icon: icon, hdg: null });
    });

    if (!_zoomBound && typeof map !== 'undefined' && map.on) {
      _zoomBound = true;
      map.on('zoom', _satQueueSizes);
      map.on('zoomend', _satApplySizes);
    }
  }

  function _satHideMarkers() {
    _markers.forEach(function (m) { m.el.style.display = 'none'; });
  }

  // Phase 2: nearest published point to now, no interpolation yet.
  function _satRender() {
    if (typeof map === 'undefined' || !map.getStyle) return;
    if (_satExpired()) { _satHideMarkers(); return; }
    var now = Date.now() / 1000;
    var on = _satOn();
    _sats.forEach(function (tr, id) {
      var m = _markers.get(id);
      if (!m) return;
      var i = Math.round(_satIndexAt(tr, now));
      if (i < 0 || i > tr.pts.length - 1) { m.el.style.display = 'none'; return; }
      m.el.style.display = on ? 'block' : 'none';
      if (!on) return;
      var p = tr.pts[i];
      m.marker.setLngLat([p.lon, p.lat]);
      if (m.hdg === null || Math.abs(p.heading - m.hdg) > 0.5) {
        m.hdg = p.heading;
        m.marker.setRotation(p.heading);
      }
      tr.now = { lon: p.lon, lat: p.lat, i: i, p: p };
    });
  }

  // --- interpolation ---------------------------------------------------

  // Great-circle interpolation between two subpoint records. Exact on a
  // sphere and well behaved across +/-180 and over the poles, because it
  // never touches lon/lat until the final conversion.
  function _satSlerp(a, b, f) {
    var d = a.ux * b.ux + a.uy * b.uy + a.uz * b.uz;
    d = Math.max(-1, Math.min(1, d));
    var th = Math.acos(d);
    if (th < 1e-9) return [a.lon, a.lat];
    var s = Math.sin(th);
    var p = Math.sin((1 - f) * th) / s;
    var q = Math.sin(f * th) / s;
    var x = p * a.ux + q * b.ux, y = p * a.uy + q * b.uy, z = p * a.uz + q * b.uz;
    return [Math.atan2(y, x) * R2D, Math.asin(Math.max(-1, Math.min(1, z))) * R2D];
  }

  // Shortest-arc angle blend, so a track crossing north does not spin the
  // icon the long way round through 359 -> 0.
  function _satLerpDeg(a, b, f) {
    var d = ((b - a + 540) % 360) - 180;
    return (a + d * f + 360) % 360;
  }

  // Current interpolated state for one track, or null if now falls outside it.
  function _satStateAt(tr, nowSec) {
    var idx = _satIndexAt(tr, nowSec);
    var n = tr.pts.length;
    if (idx < 0 || idx > n - 1) return null;
    var i0 = Math.min(n - 2, Math.floor(idx));
    var f = idx - i0;
    var a = tr.pts[i0], b = tr.pts[i0 + 1];
    var c = _satSlerp(a, b, f);
    return {
      lon: c[0], lat: c[1], i: i0, f: f, a: a, b: b,
      heading: _satLerpDeg(a.heading, b.heading, f),
      direction: a.direction,
      solarElev: (a.solarElev !== null && b.solarElev !== null)
        ? a.solarElev + (b.solarElev - a.solarElev) * f : a.solarElev,
      epoch: nowSec
    };
  }

  function _satAcquiring(tr, st) {
    if (tr.duty !== 'daylight_land') return true;
    return st.solarElev !== null && st.solarElev > 0;
  }

  // --- forward path ----------------------------------------------------

  // Sit below every fire layer so hotspots stay clickable and on top. Ids read
  // from the layers this file actually registers, bottom of the fire stack
  // first (see npMoveHotspotsBelowAgencyPoints for the render order).
  function _satBeforeId() {
    return ['burned-areas-mvt-fill', 'fci-footprint-fill', 'global-firms-hotspots',
            'usa-nasa-firms-24hrs-pt', 'combined-fire-points', 'usa-fire-points']
      .find(function (id) { return map.getLayer(id); });
  }

  function _satEnsurePathLayers() {
    if (map.getSource(NP_SAT_PATH_SRC)) return;
    var before = _satBeforeId();

    map.addSource(NP_SAT_PATH_SRC, { type: 'geojson', data: _satEmptyFC() });
    map.addLayer({
      id: NP_SAT_PATH_ID, type: 'line', source: NP_SAT_PATH_SRC,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 1.4, 9, 2],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.68, 6, 0.62, 10, 0.56]
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    }, before);

    map.addSource(NP_SAT_LEAD_SRC, { type: 'geojson', data: _satEmptyFC() });
    map.addLayer({
      id: NP_SAT_LEAD_ID, type: 'line', source: NP_SAT_LEAD_SRC,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 4, 1.2, 9, 1.6],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 6, 0.46, 10, 0.42]
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    }, before);

    map.addSource(NP_SAT_TICK_SRC, { type: 'geojson', data: _satEmptyFC() });
    map.addLayer({
      id: NP_SAT_TICK_ID, type: 'circle', source: NP_SAT_TICK_SRC,
      minzoom: NP_SAT_TICK_MINZOOM,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          NP_SAT_TICK_MINZOOM, ['match', ['get', 'rank'], 0, 2.5, 1, 2, 1.6],
          9, ['match', ['get', 'rank'], 0, 4.4, 1, 3.5, 2.8]],
        'circle-color': ['get', 'color'],
        'circle-opacity': ['match', ['get', 'rank'], 0, 0.95, 1, 0.85, 0.75],
        'circle-stroke-color': '#1F1F1F',
        'circle-stroke-width': 1
      }
    }, before);
    map.addLayer({
      id: NP_SAT_TICKLBL_ID, type: 'symbol', source: NP_SAT_TICK_SRC,
      minzoom: NP_SAT_TICK_MINZOOM,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Lexend Bold', 'Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'],
          NP_SAT_TICK_MINZOOM, ['match', ['get', 'rank'], 0, 9, 7.8],
          9, ['match', ['get', 'rank'], 0, 12, 10.4]],
        'text-offset': [0, 0.8],
        'text-anchor': 'top',
        'text-allow-overlap': false,
        'text-padding': 3,
        'symbol-sort-key': ['get', 'rank']
      },
      paint: {
        'text-color': '#FFFFFF',
        'text-halo-color': '#1F1F1F',
        'text-halo-width': 1.4,
        'text-halo-blur': 0.4
      }
    }, before);
  }

  function _satEmptyFC() { return { type: 'FeatureCollection', features: [] }; }

  // A 12 h polar track laps the planet about seven times, so the line has to
  // be cut at every antimeridian crossing. Accumulating the unwrapped
  // longitude instead (what the hurricane layer does over its short track)
  // would run to several thousand degrees and smear across world copies.
  function _satSplitAntimeridian(coords) {
    var parts = [], cur = [];
    for (var i = 0; i < coords.length; i++) {
      if (cur.length && Math.abs(coords[i][0] - cur[cur.length - 1][0]) > 180) {
        if (cur.length > 1) parts.push(cur);
        cur = [];
      }
      cur.push(coords[i]);
    }
    if (cur.length > 1) parts.push(cur);
    return parts;
  }

  // Hour marks carry the weekday so a track running past midnight stays
  // readable; the quarter marks between them stay short.
  function _satPathLabel(epochSec, isHour) {
    var d = new Date(epochSec * 1000);
    return isHour
      ? d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric' })
      : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  // Chase a roughly constant on-screen gap, so the trail reads as a dotted
  // line at world zoom instead of falling apart into isolated specks close in.
  // Subdivide each sample interval so the polyline hugs the great circle
  // rather than cutting the chord. A 207 km step deviates ~0.8 km from the true
  // arc; 60 km chords bring that under 70 m. Fixed subdivision, not zoom
  // dependent, so panning and zooming never trigger a rebuild.
  function _satTrackLine(tr, i0, i1) {
    var pts = tr.pts, out = [];
    if (i1 <= i0) return out;
    var stepKm = (tr.groundSpeedKms || 6.7) * tr.sampleS;
    var sub = Math.max(1, Math.ceil(stepKm / NP_SAT_CHORD_KM));
    for (var i = i0; i < i1; i++) {
      var a = pts[i], b = pts[i + 1];
      if (sub === 1) { out.push([a.lon, a.lat]); continue; }
      for (var k = 0; k < sub; k++) out.push(_satSlerp(a, b, k / sub));
    }
    out.push([pts[i1].lon, pts[i1].lat]);
    return out;
  }

  function _satLineFeatures(tr, coords) {
    var color = _satColor(tr), out = [];
    _satSplitAntimeridian(coords).forEach(function (part) {
      out.push({
        type: 'Feature',
        properties: { catnr: tr.catnr, color: color },
        geometry: { type: 'LineString', coordinates: part }
      });
    });
    return out;
  }

  // Latitude turning point: the top or bottom of the orbit, i.e. the next
  // polar crossing.
  function _satNextApex(tr, i0) {
    var pts = tr.pts, n = pts.length;
    var i = Math.max(0, Math.min(n - 2, i0));
    var rising = pts[i + 1].lat >= pts[i].lat;
    for (var j = i + 1; j < n - 1; j++) {
      if ((pts[j + 1].lat >= pts[j].lat) !== rising) return j;
    }
    return n - 1;
  }

  // The trail ends at the next polar crossing, clamped between MIN and MAX.
  //
  // Ending exactly at the apex, with a guard that skipped to the following one
  // when the pole was close, produced a sawtooth: the trail shrank steadily for
  // 41 minutes and then snapped back 49 minutes in a single step, twice per
  // orbit. Clamping instead keeps the length inside a fixed band, so it eases
  // down to MIN as the pole approaches, slides through it at constant length,
  // and steps back up by only MAX-MIN once past.
  function _satLeadEnd(tr, i0) {
    var n = tr.pts.length;
    var apex = _satNextApex(tr, i0);
    var lo = i0 + Math.round(NP_SAT_LEAD_MIN_S / tr.sampleS);
    var hi = i0 + Math.round(NP_SAT_LEAD_MAX_S / tr.sampleS);
    return Math.min(n - 1, Math.max(lo, Math.min(apex, hi)));
  }

  // Everything from the next sample to the end of the forecast.
  function _satBuildPath(tr, st) {
    var color = _satColor(tr);
    var n = tr.pts.length;
    var i0 = st.i;            // sample behind the marker, so the line runs through it

    var line = { type: 'FeatureCollection', features: [] };
    line.features = _satLineFeatures(tr, _satTrackLine(tr, i0, n - 1));

    // Pass-time marks along the forward path.
    //
    // Placed on round clock times rather than on sample indices: the run
    // epoch is an arbitrary second (08:50:01 on the run I tested), so marks
    // stepped off the samples would read 8:50, 9:05, 9:20 and never land on
    // an hour. Stepping wall clock and interpolating the position instead
    // gives real :00 / :15 / :30 / :45 marks.
    //
    // They are emitted every NP_SAT_TICK_MIN and thinned by Mapbox's own
    // label collision rather than by us guessing a spacing per zoom. rank
    // feeds symbol-sort-key, so when marks collide the round times win and
    // zooming out degrades to the hours.
    var ticks = { type: 'FeatureCollection', features: [] };
    var stepS = NP_SAT_TICK_MIN * 60;
    var endT = _satEndEpoch(tr);
    for (var t = Math.ceil(_satTimeAt(tr, i0) / stepS) * stepS; t <= endT; t += stepS) {
      var idx = (t - _runEpoch) / tr.sampleS;
      var k = Math.floor(idx);
      if (k < 0 || k >= n - 1) continue;
      var c = _satSlerp(tr.pts[k], tr.pts[k + 1], idx - k);
      var mins = Math.round((((t % 3600) + 3600) % 3600) / 60);
      var rank = mins === 0 ? 0 : (mins === 30 ? 1 : 2);
      ticks.features.push({
        type: 'Feature',
        properties: {
          catnr: tr.catnr, color: color, rank: rank,
          label: _satPathLabel(t, rank === 0)
        },
        geometry: { type: 'Point', coordinates: c }
      });
    }
    return { line: line, ticks: ticks };
  }

  // Leading trail for every satellite, ending at its next polar crossing.
  //
  // Selecting a satellite drops all of them, not just its own: at that point
  // its 12 h path is the subject, and eight other trails crossing it are noise.
  // They come back on deselection.
  function _satBuildLead() {
    var fc = _satEmptyFC();
    if (_selected !== null) return fc;
    var now = Date.now() / 1000;
    _sats.forEach(function (tr) {
      var st = _satStateAt(tr, now);
      if (!st) return;
      var i0 = st.i;          // as above: keeps the trail welded to the marker
      var coords = _satTrackLine(tr, i0, _satLeadEnd(tr, i0));
      if (coords.length < 2) return;
      fc.features = fc.features.concat(_satLineFeatures(tr, coords));
    });
    return fc;
  }

  function _satDrawLead() {
    if (typeof map === 'undefined' || !map.getStyle) return;
    if (!_satOn() || _satExpired()) {
      if (map.getSource(NP_SAT_LEAD_SRC)) map.getSource(NP_SAT_LEAD_SRC).setData(_satEmptyFC());
      return;
    }
    _satEnsurePathLayers();
    map.getSource(NP_SAT_LEAD_SRC).setData(_satBuildLead());
  }

  function _satDrawPath() {
    if (typeof map === 'undefined' || !map.getStyle) return;
    var tr = _selected === null ? null : _sats.get(_selected);
    if (!tr || !_satOn() || _satExpired()) { _satClearSelectedPath(); return; }
    var st = _satStateAt(tr, Date.now() / 1000);
    if (!st) { _satClearPath(); return; }
    _satEnsurePathLayers();
    var d = _satBuildPath(tr, st);
    map.getSource(NP_SAT_PATH_SRC).setData(d.line);
    map.getSource(NP_SAT_TICK_SRC).setData(d.ticks);
    _pathIndex = st.i;
  }

  function _satClearSelectedPath() {
    _pathIndex = null;
    if (typeof map === 'undefined' || !map.getStyle) return;
    if (map.getSource(NP_SAT_PATH_SRC)) map.getSource(NP_SAT_PATH_SRC).setData(_satEmptyFC());
    if (map.getSource(NP_SAT_TICK_SRC)) map.getSource(NP_SAT_TICK_SRC).setData(_satEmptyFC());
  }

  function _satClearPath() {
    _satClearSelectedPath();
    if (typeof map !== 'undefined' && map.getStyle && map.getSource(NP_SAT_LEAD_SRC)) {
      map.getSource(NP_SAT_LEAD_SRC).setData(_satEmptyFC());
    }
  }

  // Now that the dots sit on fixed ground positions there is nothing to
  // animate between rebuilds, so rebuild only when the geometry actually
  // changes: a satellite passes a sample, the zoom band shifts, or the
  // selection moves. This is what removes the streaming-out-of-the-marker
  // artefact, and it is far cheaper than the old timed redraw.
  function _satTrackKey() {
    if (_runEpoch === null) return 'x';
    var now = Date.now() / 1000, k = [];
    _sats.forEach(function (tr) { k.push(Math.floor(_satIndexAt(tr, now))); });
    k.push(_selected === null ? '-' : _selected);
    return k.join('|');
  }

  function _satRedrawTracks(force) {
    var key = _satTrackKey();
    if (!force && key === _trackKey) return;
    _trackKey = key;
    _satDrawLead();
    if (_selected !== null) _satDrawPath();
  }

  // Is the info box still showing this layer's content, or has something
  // else (a fire, a hotspot) already taken it over?
  function _satOwnsInfoBox() {
    var box = document.getElementById('infoBox');
    return !!(box && box.querySelector('.np-sat-info'));
  }

  // closeBox is only passed when the info box is still ours. A click that
  // landed on a fire has already refilled it, and closing then would wipe
  // out the thing the user actually asked for.
  function _satDeselect(closeBox) {
    if (_selected === null) return;
    _selected = null;
    _markers.forEach(function (m) { m.el.classList.remove('np-sat-sel'); });
    _satClearSelectedPath();
    _satDrawLead();
    if (closeBox && typeof closeInfoBox === 'function') closeInfoBox();
  }

  function _satSelect(catnr) {
    if (_selected === catnr) { _satDeselect(true); return; }
    _selected = catnr;
    _markers.forEach(function (m, id) { m.el.classList.toggle('np-sat-sel', id === _selected); });
    _satRedrawTracks(true);
    _satShowInfo(_selected);
  }

  // Selecting a satellite should not be a one-way door. Three ways out:
  // click it again, dismiss the info box, or click anywhere on the map.
  function _satInstallDismiss() {
    if (_dismissBound) return;
    _dismissBound = true;

    // The close button and the Escape key both route through closeInfoBox,
    // so wrapping it covers every dismissal path without editing that code.
    if (typeof window.closeInfoBox === 'function') {
      var orig = window.closeInfoBox;
      window.closeInfoBox = function () {
        orig.apply(this, arguments);
        _satDeselect(false);          // already closed; do not re-enter
      };
    }

    if (typeof map !== 'undefined' && map.on) {
      map.on('click', function () {
        if (_selected === null) return;
        // Deferred one tick so any fire or hotspot handler bound to the same
        // click has already run; only then can we tell whether the info box
        // still belongs to us.
        setTimeout(function () { _satDeselect(_satOwnsInfoBox()); }, 0);
      });
    }
  }

  // --- info box --------------------------------------------------------

  function _satLstH(lon, epochSec) {
    var utcH = (epochSec % 86400) / 3600;
    return ((utcH + lon / 15) % 24 + 24) % 24;
  }

  function _satFmtLst(h) {
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function _satShowInfo(catnr) {
    var tr = _sats.get(catnr);
    var box = document.getElementById('infoBox');
    if (!tr || !box) return;
    var st = _satStateAt(tr, Date.now() / 1000);
    if (!st) return;
    if (typeof clearNextPassCard === 'function') clearNextPassCard();
    if (typeof clearHotspotTicker === 'function') clearHotspotTicker();

    var acq = _satAcquiring(tr, st);
    var color = _satColor(tr);
    var endsMin = Math.max(0, (_satEndEpoch(tr) - Date.now() / 1000) / 60);

    var primary =
      '<strong>Sensor:</strong> <span style="color:' + color + ';font-weight:bold;">' +
        _npEsc(tr.sensor) + '</span><br>' +
      '<strong>Collecting now:</strong> ' +
        (acq ? '<span style="color:#7CD992;font-weight:bold;">Yes</span>'
             : '<span style="color:#9AA4AD;font-weight:bold;">No &mdash; daylight only</span>') + '<br>' +
      (tr.resolutionM !== null ? '<strong>Resolution:</strong> ' + tr.resolutionM + ' m<br>' : '') +
      (tr.swathKm !== null ? '<strong>Swath:</strong> ' + tr.swathKm + ' km<br>' : '') +
      '<strong>Direction:</strong> ' + _npEsc(st.direction || '—') + '<br>';

    var rest =
      (tr.altKm !== null ? '<strong>Altitude:</strong> ' + tr.altKm + ' km<br>' : '') +
      (tr.groundSpeedKms ? '<strong>Ground speed:</strong> ' + tr.groundSpeedKms.toFixed(2) + ' km/s<br>' : '') +
      '<strong>Mean local solar time:</strong> ' + _satFmtLst(_satLstH(st.lon, st.epoch)) + '<br>' +
      '<strong>Sun elevation below:</strong> ' +
        (st.solarElev === null ? '—' : st.solarElev.toFixed(1) + '°') + '<br>' +
      '<strong>Catalogue no:</strong> ' + _npEsc(tr.catnr) + '<br>' +
      (tr.tleAgeH !== null ? '<strong>Orbit element age:</strong> ' + tr.tleAgeH.toFixed(1) + ' h' +
        (tr.tleAgeH > 24 ? ' <span style="color:#FFB84D;">(ageing)</span>' : '') + '<br>' : '') +
      '<strong>Track ends:</strong> in ' + (endsMin / 60).toFixed(1) + ' h<br>';

    // FIRMS does not distribute Landsat detections outside the US and Canada.
    // The ground track drawn here is global; the data it feeds is not.
    if (tr.firms === 'us_canada') {
      rest += '<p class="np-sat-caveat">FIRMS distributes ' + _npEsc(tr.platform) +
              ' fire detections for the <strong>United States and Canada only</strong>. ' +
              'This ground track is global, but no detections are published for passes ' +
              'elsewhere.</p>';
    }

    box.innerHTML = '<h3 class="np-sat-info">' + _npEsc(tr.platform) + '</h3>' +
                    npInfoBoxLayout(primary, rest);
    box.style.display = 'block';
  }

  // --- ticker ----------------------------------------------------------

  function _satTick() {
    if (_runEpoch === null) return;
    if (_satExpired()) { _satHideMarkers(); _satClearPath(); _satStopTicker(); return; }
    var now = Date.now() / 1000;
    var on = _satOn();
    _sats.forEach(function (tr, id) {
      var m = _markers.get(id);
      if (!m) return;
      var st = _satStateAt(tr, now);
      if (!st || !on) { m.el.style.display = 'none'; return; }
      m.el.style.display = 'block';
      m.marker.setLngLat([st.lon, st.lat]);
      if (m.hdg === null || Math.abs(st.heading - m.hdg) > 0.5) {
        m.hdg = st.heading;
        m.marker.setRotation(st.heading);
      }
      var acq = _satAcquiring(tr, st);
      if (m.acq !== acq) { m.acq = acq; m.el.classList.toggle('np-sat-idle', !acq); }
      tr.now = st;
    });

    _satRedrawTracks(false);
  }

  function _satStartTicker() {
    if (_ticker || document.hidden) return;
    _ticker = setInterval(_satTick, NP_SAT_TICK_MS);
    _satTick();
  }

  function _satStopTicker() {
    if (!_ticker) return;
    clearInterval(_ticker);
    _ticker = null;
  }

  function _satInstallVisibility() {
    if (_visBound) return;
    _visBound = true;
    // Nothing moves that anyone can see while the tab is hidden, and a
    // background 10 Hz timer is pure battery cost.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) _satStopTicker();
      else if (_sats.size && _satOn()) _satStartTicker();
    });
  }

  function _satInjectStyles() {
    if (document.getElementById(NP_SAT_STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = NP_SAT_STYLE_ID;
    st.textContent =
      '.np-sat-marker{cursor:pointer;line-height:1;color:#4DD0C7;}' +
      '.np-sat-scale{display:block;will-change:transform;}' +
      '.np-sat-rot{display:block;will-change:transform;transition:opacity .25s ease;}' +
      '.np-sat-rot svg{display:block;width:26px;height:26px;overflow:visible;' +
        'filter:drop-shadow(0 0 1.5px rgba(255,255,255,0.55)) ' +
        'drop-shadow(0 1px 2px rgba(0,0,0,0.8));}' +
      '.np-sat-rot i{display:block;font-size:17px;' +
        'text-shadow:0 1px 2px rgba(0,0,0,0.75);}' +
      '.np-sat-marker.np-sat-idle .np-sat-rot{opacity:0.55;}' +
      '.np-sat-marker.np-sat-idle .np-sat-rot svg{filter:grayscale(0.75) ' +
        'drop-shadow(0 1px 2px rgba(0,0,0,0.7));}' +
      '.np-sat-marker.np-sat-sel .np-sat-rot svg{' +
        'filter:drop-shadow(0 0 3px rgba(255,255,255,0.9)) ' +
        'drop-shadow(0 1px 2px rgba(0,0,0,0.75));}' +
      '.np-sat-caveat{margin:8px 0 0;padding:7px 9px;border-radius:7px;' +
        'background:rgba(255,184,77,0.12);border-left:3px solid #FFB84D;' +
        'font-size:11px;line-height:1.45;color:#EDEDED;}';
    document.head.appendChild(st);
  }

  // Swap the mark without tearing down the markers, so the animation and
  // any drawn path survive the change.
  function npSatMarkerStyle(name) {
    if (!NP_SAT_STYLES[name]) {
      console.warn('[satellite] unknown marker style "' + name + '". Options: ' +
                   Object.keys(NP_SAT_STYLES).join(', '));
      return null;
    }
    NP_SAT_MARKER_STYLE = name;
    _markers.forEach(function (m) { m.icon.innerHTML = NP_SAT_STYLES[name]; });
    return name;
  }

  function npToggleSatellites(on) {
    _markers.forEach(function (m) { m.el.style.display = on ? 'block' : 'none'; });
    [NP_SAT_PATH_ID, NP_SAT_LEAD_ID, NP_SAT_TICK_ID, NP_SAT_TICKLBL_ID].forEach(function (lid) {
      if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', on ? 'visible' : 'none');
    });
    if (on) { _satRender(); _satStartTicker(); _satRedrawTracks(true); }
    else _satStopTicker();
  }

  function _satSummary() {
    var rows = [];
    _sats.forEach(function (tr) {
      rows.push({
        platform: tr.platform, sensor: tr.sensor, catnr: tr.catnr,
        points: tr.pts.length,
        sample_s: tr.sampleS,
        span_h: tr.sampleS ? +((tr.pts.length - 1) * tr.sampleS / 3600).toFixed(2) : null,
        speed_kms: tr.groundSpeedKms ? +tr.groundSpeedKms.toFixed(3) : null,
        half_width_km: tr.halfWidthKm,
        res_m: tr.resolutionM,
        duty: tr.duty,
        firms: tr.firms,
        tle_age_h: tr.tleAgeH
      });
    });
    rows.sort(function (a, b) { return a.platform < b.platform ? -1 : 1; });

    var total = rows.reduce(function (s, r) { return s + r.points; }, 0);
    console.log('[satellite] platforms:', rows.length, '| points:', total,
                '| run_epoch:', _runEpoch === null ? 'UNRESOLVED'
                  : new Date(_runEpoch * 1000).toISOString() +
                    ' (' + _satRunAgeMin().toFixed(1) + ' min old, via ' + _anchorSrc +
                    (_anchorRms === null ? ''
                      : ', rms ' + _anchorRms.toFixed(4) + ' deg over ' + _anchorN + ' pts') + ')');
    if (console.table) console.table(rows); else console.log(rows);
    if (_runEpoch === null) {
      console.warn('[satellite] ' + NP_SAT_TYPENAME + ' publishes no t_epoch / run_epoch / ' +
                   'pt_index column and the solar anchor could not be recovered, so the ' +
                   'track cannot be placed on the wall clock. Layer hidden.');
    } else if (_satRunAgeMin() > NP_SAT_STALE_MIN) {
      console.warn('[satellite] run is ' + _satRunAgeMin().toFixed(0) + ' min old (limit ' +
                   NP_SAT_STALE_MIN + '). Layer hidden rather than extrapolated.');
    }
  }

  function _satInstallRefresh() {
    if (_refresher || NP_SAT_REFRESH_MIN <= 0) return;
    _refresher = setInterval(function () { _satFetch(); }, NP_SAT_REFRESH_MIN * 60000);
  }

  function npAddSatelliteLayer() {
    _satInjectStyles();
    _satInstallRefresh();
    _satInstallDismiss();
    var freshMs = Math.max(NP_SAT_REFRESH_MIN, 5) * 60000;
    if (_sats.size && Date.now() - _lastFetch < freshMs) {
      _satSummary(); _satSyncMarkers(); _satInstallVisibility();
      _satRender(); _satStartTicker(); _satRedrawTracks(true); return;
    }
    _satFetch();
  }

  window.npAddSatelliteLayer = npAddSatelliteLayer;
  window.npToggleSatellites = npToggleSatellites;
  window.npSatMarkerStyle = npSatMarkerStyle;
  window.npRefreshSatellites = function () { _satFetch(); };
  window._npSatTracks = function () { return _sats; };
})();

// ============================================================
// Share panel + follow links
// ============================================================

(function () {
  'use strict';

  var NP_SHARE_STYLE_ID = 'np-share-styles';
  var NP_SHARE_TITLE = 'FireMap — Live Wildfire & Smoke Map';
  var NP_SHARE_TEXT  = 'Live wildfire, smoke and satellite hotspot tracking on FireMap:';

  function npShareUrl() {
    try {
      var c = map.getCenter();
      return 'https://firemap.live/?lng=' + c.lng.toFixed(4) +
             '&lat=' + c.lat.toFixed(4) +
             '&zoom=' + map.getZoom().toFixed(2);
    } catch (e) { return 'https://firemap.live/'; }
  }

  var NP_SHARE_TARGETS = [
    { id: 'x',        label: 'X',        icon: 'fa-brands fab fa-x-twitter', color: '#000000',
      url: function (u, t) { return 'https://twitter.com/intent/tweet?url=' + u + '&text=' + t; } },
    { id: 'facebook', label: 'Facebook', icon: 'fa-brands fab fa-facebook-f', color: '#1877F2',
      url: function (u) { return 'https://www.facebook.com/sharer/sharer.php?u=' + u; } },
    { id: 'reddit',   label: 'Reddit',   icon: 'fa-brands fab fa-reddit-alien', color: '#FF4500',
      url: function (u, t) { return 'https://www.reddit.com/submit?url=' + u + '&title=' + t; } },
    { id: 'bluesky',  label: 'Bluesky',  icon: 'fa-brands fab fa-bluesky', color: '#0285FF',
      url: function (u, t) { return 'https://bsky.app/intent/compose?text=' + t + '%20' + u; } },
    { id: 'threads',  label: 'Threads',  icon: 'fa-brands fab fa-threads', color: '#000000',
      url: function (u, t) { return 'https://www.threads.net/intent/post?text=' + t + '%20' + u; } },
    { id: 'whatsapp', label: 'WhatsApp', icon: 'fa-brands fab fa-whatsapp', color: '#25D366',
      url: function (u, t) { return 'https://wa.me/?text=' + t + '%20' + u; } },
    { id: 'telegram', label: 'Telegram', icon: 'fa-brands fab fa-telegram', color: '#26A5E4',
      url: function (u, t) { return 'https://t.me/share/url?url=' + u + '&text=' + t; } },
    { id: 'linkedin', label: 'LinkedIn', icon: 'fa-brands fab fa-linkedin-in', color: '#0A66C2',
      url: function (u) { return 'https://www.linkedin.com/sharing/share-offsite/?url=' + u; } },
    { id: 'gmail',    label: 'Gmail',    icon: 'fa-solid fas fa-envelope', color: '#EA4335',
      url: function (u, t) { return 'https://mail.google.com/mail/?view=cm&fs=1&su=' +
                                    encodeURIComponent(NP_SHARE_TITLE) + '&body=' + t + '%0A%0A' + u; } },
    { id: 'email',    label: 'Email',    icon: 'fa-solid fas fa-at', color: '#8F8F8F',
      url: function (u, t) { return 'mailto:?subject=' + encodeURIComponent(NP_SHARE_TITLE) +
                                    '&body=' + t + '%0A%0A' + u; } }
  ];

  var NP_FOLLOW_LINKS = [
    { id: 'x',         label: 'X',          icon: 'fa-brands fab fa-x-twitter', href: 'https://x.com/disaster_db' },
    { id: 'bluesky',   label: 'Bluesky',    icon: 'fa-brands fab fa-bluesky',   href: 'https://bsky.app/profile/firemap.bsky.social' },
    { id: 'instagram', label: 'Instagram',  icon: 'fa-brands fab fa-instagram', href: 'https://www.instagram.com/firemaplive' },
    { id: 'youtube',   label: 'YouTube',    icon: 'fa-brands fab fa-youtube',   href: 'https://www.youtube.com/@disasterdb' },
    { id: 'linkedin',  label: 'LinkedIn',   icon: 'fa-brands fab fa-linkedin-in', href: 'https://www.linkedin.com/company/firemaplive' },
    { id: 'site',      label: 'DisasterDB', icon: 'fa-solid fas fa-globe',      href: 'https://disasterdb.com' }
  ];

  function _npIconsAvailable() {
    try {
      var i = document.createElement('i');
      i.className = 'fa-solid fas fa-share-nodes';
      i.style.cssText = 'position:absolute;left:-9999px;';
      document.body.appendChild(i);
      var ff = getComputedStyle(i).fontFamily || '';
      document.body.removeChild(i);
      return ff.indexOf('Font Awesome') !== -1 || ff.indexOf('FontAwesome') !== -1;
    } catch (e) { return true; }
  }

  function _npEscShare(s) {
    return String(s === null || typeof s === 'undefined' ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _npWrapUrlRow(url) {
    return '<div class="np-sh-urlrow">' +
             '<input id="npShareUrlInput" type="text" readonly value="' + _npEscShare(url) + '">' +
             '<button id="npShareCopyBtn" type="button" title="Copy link">' +
               '<i class="fa-solid fas fa-copy"></i><span> Copy</span></button>' +
           '</div>';
  }

  function _npBuildShareUI() {
    var modal = document.getElementById('shareMapModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'shareMapModal';
      document.body.appendChild(modal);
    }
    var url = npShareUrl();
    var encUrl = encodeURIComponent(url);
    var encText = encodeURIComponent(NP_SHARE_TEXT);
    var icons = _npIconsAvailable();

    var tiles = NP_SHARE_TARGETS.map(function (t) {
      return '<a class="np-sh-tile" data-np-share="' + t.id + '" href="' + _npEscShare(t.url(encUrl, encText)) + '"' +
             ' target="_blank" rel="noopener noreferrer" style="--np-sh-c:' + t.color + '"' +
             ' aria-label="Share on ' + _npEscShare(t.label) + '">' +
             (icons ? '<i class="' + t.icon + '"></i>' : '') +
             '<span>' + _npEscShare(t.label) + '</span></a>';
    }).join('');

    var follows = NP_FOLLOW_LINKS.map(function (f) {
      return '<a class="np-sh-follow" href="' + _npEscShare(f.href) + '" target="_blank" rel="noopener noreferrer"' +
             ' aria-label="Follow on ' + _npEscShare(f.label) + '" title="' + _npEscShare(f.label) + '">' +
             (icons ? '<i class="' + f.icon + '"></i>' : '<span>' + _npEscShare(f.label) + '</span>') +
             '</a>';
    }).join('');

    modal.innerHTML =
      '<div class="np-sh-panel" role="dialog" aria-modal="true" aria-labelledby="npShareTitle">' +
        '<div class="np-sh-head">' +
          '<h3 id="npShareTitle"><i class="fa-solid fas fa-share-nodes"></i> Share this map</h3>' +
          '<button id="npShareCloseBtn" type="button" aria-label="Close share panel">&times;</button>' +
        '</div>' +
        _npWrapUrlRow(url) +
        '<div class="np-sh-grid">' + tiles + '</div>' +
        '<div class="np-sh-followrow"><span class="np-sh-followlbl">Follow FireMap</span>' + follows + '</div>' +
      '</div>';

    modal.querySelector('#npShareCloseBtn').addEventListener('click', npCloseShareModal);
    modal.querySelector('#npShareCopyBtn').addEventListener('click', npCopyShareUrl);
    modal.querySelectorAll('[data-np-share]').forEach(function (a) {
      a.addEventListener('click', function () {
        if (typeof gtag === 'function') {
          gtag('event', 'share', { method: a.dataset.npShare, content_type: 'map_view' });
        }
      });
    });
  }

  function npOpenShareModal() {
    _npInjectShareStyles();
    _npBuildShareUI();
    var modal = document.getElementById('shareMapModal');
    modal.classList.add('active');
    document.addEventListener('keydown', _npShareKey);
  }

  function npCloseShareModal() {
    var modal = document.getElementById('shareMapModal');
    if (modal) modal.classList.remove('active');
    document.removeEventListener('keydown', _npShareKey);
  }

  function _npShareKey(e) { if (e.key === 'Escape') npCloseShareModal(); }

  function npCopyShareUrl() {
    var input = document.getElementById('npShareUrlInput');
    var url = input ? input.value : npShareUrl();
    var done = function () {
      var btn = document.getElementById('npShareCopyBtn');
      if (btn) {
        var span = btn.querySelector('span');
        if (span) { span.textContent = ' Copied'; setTimeout(function () { span.textContent = ' Copy'; }, 1800); }
      }
      if (typeof gtag === 'function') {
        gtag('event', 'share', { method: 'copy_link', content_type: 'map_view' });
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(function () { _npCopyFallback(url); done(); });
    } else {
      _npCopyFallback(url); done();
    }
  }

  function _npCopyFallback(url) {
    var ta = document.createElement('textarea');
    ta.value = url;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { }
    document.body.removeChild(ta);
  }

  function npInstallShare() {
    var btn = document.getElementById('shareMapBtn');
    if (!btn || btn.dataset.npShareInstalled === '1') return;
    btn.dataset.npShareInstalled = '1';

    btn.addEventListener('click', function () {
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      if (coarse && navigator.share) {
        navigator.share({ title: NP_SHARE_TITLE, text: NP_SHARE_TEXT, url: npShareUrl() })
          .then(function () {
            if (typeof gtag === 'function') {
              gtag('event', 'share', { method: 'native_sheet', content_type: 'map_view' });
            }
          })
          .catch(function () { });
        return;
      }
      npOpenShareModal();
    });

    document.addEventListener('click', function (e) {
      var modal = document.getElementById('shareMapModal');
      if (modal && modal.classList.contains('active') && e.target === modal) npCloseShareModal();
    });
  }

  function _npInjectShareStyles() {
    if (document.getElementById(NP_SHARE_STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = NP_SHARE_STYLE_ID;
    s.textContent =
      '#shareMapModal{display:none;position:fixed;inset:0;z-index:1200;' +
        'background:rgba(0,0,0,0.55);align-items:center;justify-content:center;}' +
      '#shareMapModal.active{display:flex;}' +
      '#shareMapModal .np-sh-panel{background:#1F1F1F;border:1px solid #3a3a3a;border-radius:14px;' +
        'width:460px;max-width:calc(100vw - 28px);max-height:calc(100vh - 40px);overflow-y:auto;' +
        'padding:14px 16px 12px;color:#EDEDED;font-family:"Lexend",sans-serif;box-sizing:border-box;' +
        'box-shadow:0 12px 40px rgba(0,0,0,0.5);}' +
      '#shareMapModal .np-sh-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}' +
      '#shareMapModal .np-sh-head h3{margin:0;font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px;}' +
      '#shareMapModal .np-sh-head h3 i{color:#FF6347;}' +
      '#shareMapModal #npShareCloseBtn{background:none;border:0;color:#C9C9C9;font-size:22px;line-height:1;' +
        'cursor:pointer;padding:2px 6px;border-radius:4px;}' +
      '#shareMapModal #npShareCloseBtn:hover{background:rgba(255,255,255,0.12);color:#FFFFFF;}' +
      '#shareMapModal .np-sh-urlrow{display:flex;gap:6px;margin-bottom:12px;}' +
      '#shareMapModal .np-sh-urlrow input{flex:1;min-width:0;background:#2B2B2B;border:1px solid #3a3a3a;' +
        'border-radius:8px;color:#C9C9C9;font-size:12px;padding:8px 10px;font-family:inherit;}' +
      '#shareMapModal .np-sh-urlrow button{background:#FF6347;border:0;border-radius:8px;color:#FFFFFF;' +
        'font-size:12px;font-weight:600;padding:8px 12px;cursor:pointer;font-family:inherit;white-space:nowrap;}' +
      '#shareMapModal .np-sh-urlrow button:hover{filter:brightness(1.1);}' +
      '#shareMapModal .np-sh-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:12px;}' +
      '#shareMapModal .np-sh-tile{display:flex;flex-direction:column;align-items:center;gap:4px;' +
        'background:#2B2B2B;border:1px solid #3a3a3a;border-radius:10px;padding:9px 2px 7px;' +
        'text-decoration:none;color:#EDEDED;}' +
      '#shareMapModal .np-sh-tile i{font-size:17px;color:var(--np-sh-c,#EDEDED);}' +
      '#shareMapModal .np-sh-tile span{font-size:9px;color:#9a9a9a;}' +
      '#shareMapModal .np-sh-tile:hover{border-color:var(--np-sh-c,#FF6347);}' +
      '#shareMapModal .np-sh-followrow{display:flex;align-items:center;gap:10px;border-top:1px solid #3a3a3a;' +
        'padding-top:10px;flex-wrap:wrap;}' +
      '#shareMapModal .np-sh-followlbl{font-size:11px;color:#9a9a9a;margin-right:2px;}' +
      '#shareMapModal .np-sh-follow{color:#C9C9C9;font-size:15px;text-decoration:none;}' +
      '#shareMapModal .np-sh-follow:hover{color:#FF6347;}' +
      '@media (max-width:480px){' +
        '#shareMapModal .np-sh-grid{grid-template-columns:repeat(4,minmax(0,1fr));}' +
        '#shareMapModal .np-sh-panel{padding:12px 12px 10px;}' +
      '}';
    document.head.appendChild(s);
  }

  window.npShareUrl = npShareUrl;
  window.npOpenShareModal = npOpenShareModal;
  window.npCloseShareModal = npCloseShareModal;
  window.npCopyShareUrl = npCopyShareUrl;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', npInstallShare);
  } else {
    npInstallShare();
  }
})();

// ============================================================
// Measure Tool — simple polyline distance readout (km + miles)
// Replaces the duplicate geolocate control that used to sit at 'bottom-right'.
// ============================================================
(function () {
  var SRC = 'np-measure-src';
  var PREVIEW_SRC = 'np-measure-preview-src';
  var LINE_LAYER = 'np-measure-line';
  var PREVIEW_LAYER = 'np-measure-preview';
  var PT_LAYER = 'np-measure-points';

  var KM_PER_MILE = 1.609344;
  var EARTH_R_KM = 6371.0088;

  var active = false;
  var finished = false;
  var points = [];          // array of [lng, lat]
  var cursorLngLat = null;
  var prevDblClickZoom = null;

  function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

  function haversineKm(a, b) {
    var toRad = Math.PI / 180;
    var lat1 = a[1] * toRad, lat2 = b[1] * toRad;
    var dLat = lat2 - lat1;
    var dLng = (b[0] - a[0]) * toRad;
    var sLat = Math.sin(dLat / 2), sLng = Math.sin(dLng / 2);
    var h = (sLat * sLat) + Math.cos(lat1) * Math.cos(lat2) * (sLng * sLng);
    return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function totalKm() {
    var t = 0;
    for (var i = 1; i < points.length; i++) t += haversineKm(points[i - 1], points[i]);
    return t;
  }

  function fmt(v) {
    if (v < 10) return v.toFixed(2);
    if (v < 100) return v.toFixed(1);
    return Math.round(v).toLocaleString();
  }

  function ensureLayers() {
    if (typeof map === 'undefined' || !map || typeof map.isStyleLoaded !== 'function') return false;
    if (!map.isStyleLoaded()) return false;
    try {
      if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: emptyFC() });
      if (!map.getSource(PREVIEW_SRC)) map.addSource(PREVIEW_SRC, { type: 'geojson', data: emptyFC() });

      if (!map.getLayer(PREVIEW_LAYER)) map.addLayer({
        id: PREVIEW_LAYER, type: 'line', source: PREVIEW_SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FF6347', 'line-width': 2, 'line-opacity': 0.8, 'line-dasharray': [2, 2] }
      });
      if (!map.getLayer(LINE_LAYER)) map.addLayer({
        id: LINE_LAYER, type: 'line', source: SRC,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FF6347', 'line-width': 3 }
      });
      if (!map.getLayer(PT_LAYER)) map.addLayer({
        id: PT_LAYER, type: 'circle', source: SRC,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#FFFFFF',
          'circle-stroke-color': '#FF6347',
          'circle-stroke-width': 2
        }
      });
      return true;
    } catch (e) {
      console.warn('[measure] layer setup failed:', e && e.message);
      return false;
    }
  }

  function renderPreview() {
    if (typeof map === 'undefined' || !map.getSource || !map.getSource(PREVIEW_SRC)) return;
    var feats = [];
    if (active && !finished && points.length && cursorLngLat) {
      feats.push({
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: [points[points.length - 1], cursorLngLat] }
      });
    }
    map.getSource(PREVIEW_SRC).setData({ type: 'FeatureCollection', features: feats });
  }

  function render() {
    if (ensureLayers()) {
      var feats = [];
      if (points.length > 1) {
        feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.slice() } });
      }
      for (var i = 0; i < points.length; i++) {
        feats.push({ type: 'Feature', properties: { idx: i }, geometry: { type: 'Point', coordinates: points[i] } });
      }
      map.getSource(SRC).setData({ type: 'FeatureCollection', features: feats });
      renderPreview();
    }
    updateReadout();
  }

  function updateReadout() {
    var km = totalKm();
    var kmEl = document.getElementById('measureKm');
    var miEl = document.getElementById('measureMi');
    var hintEl = document.getElementById('measureHint');
    if (kmEl) kmEl.textContent = fmt(km) + ' km';
    if (miEl) miEl.textContent = fmt(km / KM_PER_MILE) + ' mi';
    if (hintEl) {
      if (finished) hintEl.textContent = points.length + ' points · Clear to restart, Done to exit';
      else if (points.length === 0) hintEl.textContent = 'Click the map to start measuring';
      else if (points.length === 1) hintEl.textContent = 'Click to add another point';
      else hintEl.textContent = 'Click to extend · double-click to finish';
    }
  }

  function eventLngLat(ev) {
    try {
      var el = map.getCanvasContainer();
      var rect = el.getBoundingClientRect();
      var ll = map.unproject([ev.clientX - rect.left, ev.clientY - rect.top]);
      return [ll.lng, ll.lat];
    } catch (e) { return null; }
  }

  function swallow(ev) {
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    ev.preventDefault();
  }

  function onCaptureClick(ev) {
    if (!active) return;
    swallow(ev);
    if (finished) return;
    var ll = eventLngLat(ev);
    if (!ll) return;
    points.push(ll);
    render();
  }

  function onCaptureDblClick(ev) {
    if (!active) return;
    swallow(ev);
    if (finished) return;
    // The two clicks that make up a double-click already pushed a duplicate
    // vertex; drop it if the last two points land on the same spot on screen.
    if (points.length > 1) {
      try {
        var pa = map.project(points[points.length - 1]);
        var pb = map.project(points[points.length - 2]);
        if (Math.abs(pa.x - pb.x) < 8 && Math.abs(pa.y - pb.y) < 8) points.pop();
      } catch (e) { }
    }
    finished = true;
    cursorLngLat = null;
    render();
  }

  function clearMeasurement() {
    points = [];
    cursorLngLat = null;
    finished = false;
    render();
  }

  function setActive(on) {
    on = !!on;
    if (on === active) return;
    active = on;

    var btn = document.getElementById('measureBtn');
    var panel = document.getElementById('measurePanel');
    if (btn) {
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (panel) panel.classList.toggle('active', active);

    if (active) {
      ensureLayers();
      try {
        prevDblClickZoom = map.doubleClickZoom.isEnabled();
        map.doubleClickZoom.disable();
      } catch (e) { prevDblClickZoom = null; }
      try { map.getCanvas().style.cursor = 'crosshair'; } catch (e) { }
      clearMeasurement();
    } else {
      points = [];
      cursorLngLat = null;
      finished = false;
      try { if (prevDblClickZoom) map.doubleClickZoom.enable(); } catch (e) { }
      prevDblClickZoom = null;
      try { map.getCanvas().style.cursor = ''; } catch (e) { }
      render();
    }
  }

  function installMeasureTool() {
    if (typeof map === 'undefined' || !map) return;

    var btn = document.getElementById('measureBtn');
    if (btn) btn.addEventListener('click', function () { setActive(!active); });

    var clearBtn = document.getElementById('measureClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearMeasurement);

    var doneBtn = document.getElementById('measureDoneBtn');
    if (doneBtn) doneBtn.addEventListener('click', function () { setActive(false); });

    document.addEventListener('keydown', function (e) {
      if (active && (e.key === 'Escape' || e.key === 'Esc')) setActive(false);
    });

    try {
      var el = map.getCanvasContainer();
      el.addEventListener('click', onCaptureClick, true);
      el.addEventListener('dblclick', onCaptureDblClick, true);
    } catch (e) { console.warn('[measure] could not bind map events:', e && e.message); }

    map.on('mousemove', function (e) {
      if (!active) return;
      // Other layers set a pointer cursor on hover; keep the crosshair while measuring.
      try { map.getCanvas().style.cursor = 'crosshair'; } catch (err) { }
      if (finished || !points.length) return;
      cursorLngLat = [e.lngLat.lng, e.lngLat.lat];
      renderPreview();
    });

    map.on('mouseout', function () {
      if (!active) return;
      cursorLngLat = null;
      renderPreview();
    });

    // A basemap change wipes custom sources/layers - put ours back.
    map.on('style.load', function () {
      if (active || points.length) { ensureLayers(); render(); }
    });

    updateReadout();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installMeasureTool);
  } else {
    installMeasureTool();
  }
})();


/* =====================================================================
   Live Clock (top-left, beside the logo)
   Shows UTC plus the viewer's local time with its timezone abbreviation.
   ===================================================================== */
(function () {
  function installLiveClock() {
    var utcEl = document.getElementById('clockUtcTime');
    var localEl = document.getElementById('clockLocalTime');
    var zoneEl = document.getElementById('clockLocalZone');
    if (!utcEl || !localEl || !zoneEl) return;

    var utcFmt, localFmt;
    try {
      utcFmt = new Intl.DateTimeFormat([], {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC'
      });
      localFmt = new Intl.DateTimeFormat([], {
        hour: '2-digit', minute: '2-digit', hour12: false
      });
    } catch (err) {
      utcFmt = null;
      localFmt = null;
    }

    // Short zone name ("PDT", "AEST", ...); fall back to a UTC offset label.
    function localZoneLabel(now) {
      try {
        var parts = new Intl.DateTimeFormat([], {
          timeZoneName: 'short', hour: '2-digit', hour12: false
        }).formatToParts(now);
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].type === 'timeZoneName' && parts[i].value) return parts[i].value;
        }
      } catch (err) { /* fall through to offset */ }

      var mins = -now.getTimezoneOffset();
      var sign = mins < 0 ? '-' : '+';
      var abs = Math.abs(mins);
      var hh = Math.floor(abs / 60);
      var mm = abs % 60;
      return 'UTC' + sign + hh + (mm ? ':' + (mm < 10 ? '0' + mm : mm) : '');
    }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    function manualTime(h, m) { return pad(h) + ':' + pad(m); }

    // Only touch the DOM when the rendered text actually changes (once a minute).
    function set(el, value) {
      if (el.textContent !== value) el.textContent = value;
    }

    function tick() {
      var now = new Date();
      var utc, local;

      if (utcFmt) {
        // Some locales render 24:00 for midnight - normalise it.
        utc = utcFmt.format(now).replace(/^24:/, '00:');
        local = localFmt.format(now).replace(/^24:/, '00:');
      } else {
        utc = manualTime(now.getUTCHours(), now.getUTCMinutes());
        local = manualTime(now.getHours(), now.getMinutes());
      }

      set(utcEl, utc);
      set(localEl, local);
      set(zoneEl, localZoneLabel(now));
    }

    tick();
    // Poll every second so DST shifts and sleeping devices land on the right
    // minute; the DOM is only written when the displayed value changes.
    setInterval(tick, 1000);

    // Catch up immediately after a tab wake / device sleep.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installLiveClock);
  } else {
    installLiveClock();
  }
})();
