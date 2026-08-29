import streamlit as st
import requests
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from datetime import datetime
import base64
from zoneinfo import ZoneInfo
from io import StringIO
import json
import pandas as pd
from streamlit_echarts import st_echarts
from io import StringIO
import json
import math

st.set_page_config(page_title="🔥 Salamina Fire Danger", page_icon="🔥",
                   layout="wide")

try:
    from streamlit_autorefresh import st_autorefresh
    AUTOREFRESH = True
except ImportError:
    AUTOREFRESH = False

# =========================================================
# GEOGRAPHY — verified coordinates
# =========================================================
SALAMINA_CENTER = {"lat": 37.9639, "lon": 23.4944}
SALAMINA_BBOX = [23.35, 37.85, 23.60, 38.03]  # lon_min, lat_min, lon_max, lat_max

LOCATIONS = {
    "Salamina City":      (37.9641, 23.4988),   # town center
    "Aianteio":           (37.9223, 23.4675),   # west-central town
    "Selínia (Port)":     (37.9323, 23.5318),   # port S of Salamina town
    "Kanákia (West)":     (37.9066, 23.4146),   # west coast village
    "Ampelákia (North)":  (37.9508, 23.5289),   # N coast near Perama strait
    "Psili Ammos (NW)":   (37.9784, 23.4634),   # NW beach settlement
    "Mount Mavrovouni":   (37.9344, 23.5005),   # island's highest peak (approx)
}

# =========================================================
# MOBILE CSS + VIEW MODE
# =========================================================
is_mobile = st.query_params.get("view") == "mobile"

st.markdown("""
<style>
    @media (max-width: 768px) {
        .stMetric { font-size: 14px; }
        .stMetric > div > div { font-size: 20px !important; }
        div[data-testid="column"] { min-width: 45% !important; }
        h1 { font-size: 1.4rem !important; }
    }
    .block-container {
        padding-top: 1.5rem !important;
        padding-left: 0rem !important;
        padding-right: 0rem !important;
        padding-bottom: 0rem !important;
        max-width: 100% !important;
    }
    header { visibility: hidden; }
    #MainMenu { visibility: hidden; }
    footer { visibility: hidden; }
    div[data-testid="stAlert"] { position: sticky; top: 0; z-index: 999; }
</style>
""", unsafe_allow_html=True)

# =========================================================
# DATA FETCHERS
# =========================================================
@st.cache_data(ttl=900)
def fetch_weather(lat, lon):
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat, "longitude": lon,
        "current": ["temperature_2m", "relative_humidity_2m",
                    "wind_speed_10m", "wind_gusts_10m",
                    "wind_direction_10m", "precipitation", "weather_code"],
        "hourly": ["temperature_2m", "relative_humidity_2m",
                   "wind_speed_10m", "precipitation"],
        "daily": ["temperature_2m_max", "temperature_2m_min",
                  "precipitation_sum", "wind_speed_10m_max"],
        "timezone": "Europe/Athens", "forecast_days": 7, "past_days": 14,
    }
    r = requests.get(url, params=params, timeout=15)
    r.raise_for_status()
    return r.json()

@st.cache_data(ttl=3600)
def fetch_soil(lat, lon):
    url = "https://api.open-meteo.com/v1/forecast"
    params = {"latitude": lat, "longitude": lon,
              "current": ["soil_moisture_0_to_1cm"],
              "timezone": "Europe/Athens"}
    r = requests.get(url, params=params, timeout=15)
    return r.json()




@st.cache_data(ttl=600)
def fetch_firemap_hotspots():
    """Fetch active fire points from FireMap.live WFS for Salamina bbox."""
    lon_min, lat_min, lon_max, lat_max = SALAMINA_BBOX
    url = (f"https://geo.firemap.live/geoserver/ows?service=WFS&version=1.0.0"
           f"&request=GetFeature&typeName=FireDB:combined_fire_pt_active"
           f"&bbox={lon_min},{lat_min},{lon_max},{lat_max}"
           f"&outputFormat=application/json")
    try:
        r = requests.get(url, timeout=15)
        if r.ok:
            data = r.json()
            features = data.get("features", [])
            pts = []
            for feat in features:
                coords = feat["geometry"]["coordinates"]
                props = feat["properties"]
                pts.append({
                    "lon": coords[0], "lat": coords[1],
                    "activity": props.get("activity_rating", "Unknown"),
                    "area_ha": props.get("area_ha", 0),
                    "returns": props.get("satellite_returns_24hrs", 0)
                })
            return pd.DataFrame(pts)
    except Exception as e:
        st.sidebar.warning(f"Failed to fetch FireMap active fires: {e}")
    return pd.DataFrame()

@st.cache_data(ttl=3600)
def fetch_burned_areas():
    lon_min, lat_min, lon_max, lat_max = SALAMINA_BBOX
    url = (f"https://geo.firemap.live/geoserver/ows?service=WFS&version=1.0.0"
           f"&request=GetFeature&typeName=FireDB:fire_pg_combined"
           f"&bbox={lon_min},{lat_min},{lon_max},{lat_max}"
           f"&outputFormat=application/json")
    try:
        r = requests.get(url, timeout=15)
        if r.ok:
            data = r.json()
            # Inject explicit IDs into features for Choroplethmapbox matching
            for i, feat in enumerate(data.get("features", [])):
                feat["id"] = str(feat.get("id", i))
            return data
    except Exception:
        pass
    return None


@st.cache_data(ttl=86400)
def geocode(query):
    """
    Exact coordinates for any place name via OpenStreetMap Nominatim.
    Bounded to Salamina's bbox so it can't return places elsewhere in Greece.
    Returns (lat, lon, display_name) or (None, None, None).
    """
    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": query, "format": "json", "limit": 1,
                    "viewbox": f"{SALAMINA_BBOX[0]},{SALAMINA_BBOX[3]},"
                               f"{SALAMINA_BBOX[2]},{SALAMINA_BBOX[1]}",
                    "bounded": 1},
            headers={"User-Agent": "salamina-fire-monitor/1.0"},
            timeout=10)
        if r.ok and r.json():
            res = r.json()[0]
            return float(res["lat"]), float(res["lon"]), res["display_name"]
    except Exception:
        pass
    return None, None, None

# =========================================================
# FIRE DANGER INDEX
# =========================================================
def fire_danger_index(temp_c, rh_pct, wind_kmh, days_since_rain, drought_factor):
    ffdi = (drought_factor *
            np.exp(0.0345 * temp_c - 0.0338 * rh_pct + 0.0234 * wind_kmh))
    return round(ffdi, 1)

def danger_class(ffdi):
    if ffdi < 12:  return "Low",       "#2ecc71"
    if ffdi < 25:  return "Moderate",  "#f1c40f"
    if ffdi < 50:  return "High",      "#e67e22"
    if ffdi < 75:  return "Very High", "#e74c3c"
    if ffdi < 100: return "Severe",    "#c0392b"
    if ffdi < 150: return "Extreme",   "#8e44ad"
    return "Catastrophic", "#000000"

def days_since_last_rain(daily_precip):
    for i, p in enumerate(reversed(daily_precip)):
        if p and p >= 1.0:
            return i
    return len(daily_precip)



# =========================================================
# ALERTS
# =========================================================
ALERT_THRESHOLDS = {"High": 25, "Very High": 50, "Severe": 75,
                    "Extreme": 100, "Catastrophic": 150}

def send_email_alert(subject, body):
    try:
        import smtplib
        from email.mime.text import MIMEText
        cfg = st.secrets["email"]
        msg = MIMEText(body)
        msg["Subject"], msg["From"], msg["To"] = subject, cfg["sender"], cfg["recipient"]
        with smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"]) as s:
            s.starttls()
            s.login(cfg["sender"], cfg["password"])
            s.send_message(msg)
        return True
    except Exception as e:
        st.sidebar.warning(f"Email failed: {e}")
        return False

def send_telegram_alert(text):
    try:
        cfg = st.secrets["telegram"]
        requests.post(f"https://api.telegram.org/bot{cfg['token']}/sendMessage",
                      data={"chat_id": cfg["chat_id"], "text": text}, timeout=10)
        return True
    except Exception as e:
        st.sidebar.warning(f"Telegram failed: {e}")
        return False

# =========================================================
# SIDEBAR — location selection (presets + geocoded search)
# =========================================================
st.sidebar.header("📍 Location")
place = st.sidebar.selectbox("Area of Salamina:", list(LOCATIONS.keys()))
lat, lon = LOCATIONS[place]

search = st.sidebar.text_input(
    "🔎 Or search any place:",
    help="Type a village, beach or landmark name — e.g. 'Faneromeni', "
         "'Kaki Vigla', 'Agios Georgios'. Bounded to Salamina.")
if search.strip():
    glat, glon, gname = geocode(search.strip())
    if glat is not None:
        lat, lon = glat, glon
        place = gname.split(",")[0]
        st.sidebar.success(f"📍 {gname}")
    else:
        st.sidebar.warning(f"'{search}' not found in the Salamina area — "
                           f"using preset '{place}'.")

if AUTOREFRESH:
    refresh_ms = st.sidebar.selectbox("⏱️ Auto-refresh",
                                      ["Off", "15 min", "5 min"], index=0)
    if refresh_ms != "Off":
        st_autorefresh(interval=900_000 if refresh_ms == "15 min" else 300_000,
                       key="refresh")

st.sidebar.header("🔔 Alerts")
st.session_state["enable_email"] = st.sidebar.checkbox("📧 Email alerts")
st.session_state["enable_telegram"] = st.sidebar.checkbox("✈️ Telegram alerts")
with st.sidebar.expander("⚙️ Alert setup"):
    st.code("""# .streamlit/secrets.toml
[firms]
map_key = "YOUR_FIRMS_MAP_KEY"

[email]
smtp_host = "smtp.gmail.com"
smtp_port = 587
sender = "you@gmail.com"
password = "app-password"
recipient = "alert@receiver.com"

[telegram]
token = "123456:ABC..."
chat_id = "-1001234567890""")

st.sidebar.header("🌍 FireMap.live Overlays")
show_fm_active = st.sidebar.checkbox("🔥 Active Fires (FireMap)", value=True)
show_fm_burns  = st.sidebar.checkbox("⚫ Burned Areas (FireMap)", value=True)

st.sidebar.markdown("---")
st.sidebar.header("📖 Υπόμνημα Χάρτη (Legend)")
st.sidebar.markdown("""
<div style='font-size:14px; line-height:1.6;'>
    <b>🔴 Ενεργές Εστίες (Hotspots)</b><br>
    Δορυφορικές ανιχνεύσεις φωτιάς<br><br>
    <b>⚫ Καμένες Εκτάσεις</b><br>
    Περιοχές που έχουν καεί<br><br>
    <b>🔥 Δείκτης FFDI (Κίνδυνος):</b><br>
    <span style='color:#2ecc71'>●</span> Χαμηλός (0-12)<br>
    <span style='color:#f1c40f'>●</span> Υψηλός (12-25)<br>
    <span style='color:#e67e22'>●</span> Πολύ Υψηλός (25-50)<br>
    <span style='color:#e74c3c'>●</span> Σοβαρός (50-75)<br>
    <span style='color:#c0392b'>●</span> Ακραίος (75-100)<br>
    <span style='color:#8e44ad'>●</span> Καταστροφικός (100+)
</div>
""", unsafe_allow_html=True)

# =========================================================
# FETCH MAIN LOCATION DATA
# =========================================================
try:
    wx = fetch_weather(lat, lon)
    soil = fetch_soil(lat, lon)
except Exception as e:
    st.error(f"Could not fetch live data: {e}")
    st.stop()

cur, daily = wx["current"], wx["daily"]
temp, rh = cur["temperature_2m"], cur["relative_humidity_2m"]
wind, gust = cur["wind_speed_10m"], cur["wind_gusts_10m"]
dsr = days_since_last_rain(daily["precipitation_sum"])
soil_m = soil["current"]["soil_moisture_0_to_1cm"]
df_drought = min(10, max(1, dsr * 0.5 + (1 - (soil_m or 0.2)) * 5))

ffdi = fire_danger_index(temp, rh, wind, dsr, df_drought)
level, color = danger_class(ffdi)

hotspots = fetch_firemap_hotspots() if show_fm_active else pd.DataFrame()
hotspot_nearby = False
if not hotspots.empty:
    dlat = (hotspots["lat"] - lat) * 111.0
    dlon = (hotspots["lon"] - lon) * 111.0 * np.cos(np.radians(lat))
    hotspot_nearby = bool((np.sqrt(dlat**2 + dlon**2) < 5).any())


# =========================================================
# HEADER + ALERTS
# =========================================================
c_title, c_badge = st.columns([3, 1])
c_title.title("🔥 Live Fire Danger Monitor — Salamina, Greece")
c_title.caption(f"Monitoring: **{place}** · Updated: "
                f"{datetime.now(ZoneInfo('Europe/Athens')).strftime('%Y-%m-%d %H:%M:%S')}")
c_badge.markdown(
    f"<div style='background:{color};color:white;padding:20px;border-radius:"
    f"12px;text-align:center;font-size:22px'><b>{level.upper()}</b><br>"
    f"FFDI {ffdi}</div>", unsafe_allow_html=True)

st.session_state.setdefault("alerts_sent", {})
alert_key = f"{place}_{datetime.now(ZoneInfo('Europe/Athens')).strftime('%Y%m%d')}_{level}"
crossed = [lv for lv, th in ALERT_THRESHOLDS.items() if ffdi >= th]

if (crossed or hotspot_nearby) and not st.session_state["alerts_sent"].get(alert_key):
    highest = crossed[-1] if crossed else "Hotspot Detected"
    msg = (f"🔥 FIRE ALERT — {place}, Salamina\n"
           f"FFDI: {ffdi} ({highest})\n"
           f"Satellite hotspot within 5 km: {'YES ⚠️' if hotspot_nearby else 'No'}\n"
           f"Time: {datetime.now(ZoneInfo('Europe/Athens')).strftime('%H:%M')}\n"
           f"Take precautions immediately.")
    st.toast(f"⚠️ {highest} at {place}!", icon="🚨")
    st.markdown("""<audio autoplay><source src=
        "https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg"></audio>""",
        unsafe_allow_html=True)
    st.error(f"🚨 **{highest.upper()}** at {place} — FFDI {ffdi}"
             + (" — 🛰️ **SATELLITE HOTSPOT DETECTED NEARBY!**" if hotspot_nearby else "")
             + " Report smoke to **199**.")
    if st.session_state.get("enable_email"):
        send_email_alert(f"[FIRE ALERT] {highest} — {place}", msg)
    if st.session_state.get("enable_telegram"):
        send_telegram_alert(msg)
    st.session_state["alerts_sent"][alert_key] = True

# =========================================================
# KPI ROW
# =========================================================
kpis = [("🌡️ Temperature", f"{temp} °C"),
        ("💧 Humidity", f"{rh} %"),
        ("💨 Wind", f"{wind} km/h"),
        ("🌧️ Rain now", f"{cur['precipitation']} mm"),
        ("🌱 Soil moisture", f"{round((soil_m or 0)*100)}%")]

if is_mobile:
    r1, r2 = st.columns(3), st.columns(2)
    for i, kv in enumerate(kpis[:3]): r1[i].metric(*kv)
    for i, kv in enumerate(kpis[3:]): r2[i].metric(*kv)
else:
    cols = st.columns(5)
    cols[0].metric(*kpis[0]); cols[1].metric(*kpis[1])
    cols[2].metric(*kpis[2], f"gusts {gust}")
    cols[3].metric(*kpis[3], f"{dsr}d since rain"); cols[4].metric(*kpis[4])

# =========================================================
# GAUGE
# =========================================================
option = {
    "series": [
        {
            "type": "gauge",
            "startAngle": 210,
            "endAngle": -30,
            "min": 0,
            "max": 150,
            "splitNumber": 6,
            "itemStyle": {
                "color": "#d4af37", # Vintage brass/gold needle
                "shadowColor": "rgba(0,0,0,0.5)",
                "shadowBlur": 10,
                "shadowOffsetX": 2,
                "shadowOffsetY": 2
            },
            "progress": {
                "show": False
            },
            "pointer": {
                "icon": "path://M12.8,0.7l12,40.1H0.7L12.8,0.7z",
                "length": "70%",
                "width": 12,
                "offsetCenter": [0, "-5%"]
            },
            "axisLine": {
                "lineStyle": {
                    "width": 15,
                    "color": [
                        [12/150, "#2ecc71"],
                        [25/150, "#f1c40f"],
                        [50/150, "#e67e22"],
                        [75/150, "#e74c3c"],
                        [100/150, "#c0392b"],
                        [1, "#8e44ad"]
                    ]
                }
            },
            "axisTick": {
                "splitNumber": 5,
                "distance": -15,
                "length": 8,
                "lineStyle": {
                    "color": "#fff",
                    "width": 2
                }
            },
            "splitLine": {
                "distance": -15,
                "length": 15,
                "lineStyle": {
                    "color": "#fff",
                    "width": 3
                }
            },
            "axisLabel": {
                "distance": 25,
                "color": "#ddd",
                "fontSize": 14,
                "fontWeight": "bold"
            },
            "detail": {
                "valueAnimation": True,
                "formatter": f"{{value}} FFDI\\n{level}",
                "color": "inherit",
                "fontSize": 20,
                "fontWeight": "bolder",
                "offsetCenter": [0, "60%"]
            },
            "data": [
                {
                    "value": ffdi
                }
            ]
        }
    ]
}

st_echarts(options=option, height="350px")

# =========================================================
# COMPUTE ALL MONITORING POINTS
# =========================================================
map_data = []
for name, (mlat, mlon) in LOCATIONS.items():
    w = fetch_weather(mlat, mlon)
    d = w["daily"]["precipitation_sum"]
    f = fire_danger_index(w["current"]["temperature_2m"],
                          w["current"]["relative_humidity_2m"],
                          w["current"]["wind_speed_10m"],
                          days_since_last_rain(d), df_drought)
    lv, c = danger_class(f)
    map_data.append({"name": name, "lat": mlat, "lon": mlon,
                     "FFDI": f, "Level": lv, "Color": c})
mdf = pd.DataFrame(map_data)

# If user searched a custom place, add it to the point set too
if place not in mdf["name"].values:
    map_data.append({"name": f"🔎 {place}", "lat": lat, "lon": lon,
                     "FFDI": ffdi, "Level": level, "Color": color})
    mdf = pd.DataFrame(map_data)

# =========================================================
# BUILD MAP (all layers)
# =========================================================
fig_map = go.Figure()

# --- Layer 3: Active Fire Hotspots (FireMap.live) ---
if not hotspots.empty:
    fig_map.add_trace(go.Scattermapbox(
        lat=hotspots["lat"], lon=hotspots["lon"], mode="markers",
        marker=dict(size=14, color="#ff3300", opacity=0.9),
        customdata=np.stack([
            hotspots["area_ha"].round(1),
            hotspots["activity"],
            hotspots["returns"]], axis=-1),
        hovertemplate=("🔥 <b>ACTIVE FIRE</b><br>"
                       "Area: %{customdata[0]} ha<br>"
                       "Activity: %{customdata[1]}<br>"
                       "Sat Returns (24h): %{customdata[2]}<extra></extra>")))


# --- Layer 2: live danger points (on top) ---
fig_map.add_trace(go.Scattermapbox(
    lat=mdf["lat"], lon=mdf["lon"], mode="markers+text",
    text=mdf["name"], textposition="bottom center",
    marker=dict(size=22, color=mdf["Color"]),
    customdata=np.stack([mdf["FFDI"], mdf["Level"]], axis=-1),
    hovertemplate="<b>%{text}</b><br>FFDI: %{customdata[0]}<br>"
                  "Level: %{customdata[1]}<extra></extra>"))

wms_layers = []

if show_fm_burns:
    burned_geojson = fetch_burned_areas()
    if burned_geojson and len(burned_geojson.get("features", [])) > 0:
        ids = [f["id"] for f in burned_geojson["features"]]
        df_burns = pd.DataFrame({"id": ids, "val": [1]*len(ids)})
        
        fig_map.add_trace(go.Choroplethmapbox(
            geojson=burned_geojson,
            locations=df_burns["id"],
            z=df_burns["val"],
            colorscale=[[0, "black"], [1, "black"]],
            showscale=False,
            marker_opacity=0.6,
            marker_line_width=1,
            hovertemplate="🔥 <b>Burned Area</b><br>No date/metadata provided by server<extra></extra>"
        ))

fig_map.update_layout(
    mapbox=dict(
        style="open-street-map", 
        center=SALAMINA_CENTER, 
        zoom=12.5,
        layers=wms_layers
    ),
    height=550 if is_mobile else 750, margin=dict(l=0, r=0, t=0, b=0),
    showlegend=False)

# =========================================================
# FORECASTS
# =========================================================
fc = pd.DataFrame({"Date": daily["time"],
                   "Max Temp (°C)": daily["temperature_2m_max"],
                   "Min Temp (°C)": daily["temperature_2m_min"],
                   "Rain (mm)": daily["precipitation_sum"],
                   "Max Wind (km/h)": daily["wind_speed_10m_max"]})
fc["Forecast FFDI"] = [
    fire_danger_index(fc.loc[i, "Max Temp (°C)"], rh,
                      fc.loc[i, "Max Wind (km/h)"], dsr + i, df_drought)
    for i in range(len(fc))]

h = wx["hourly"]
hh = pd.DataFrame({"Time": h["time"][:48],
                   "Temp": h["temperature_2m"][:48],
                   "RH %": h["relative_humidity_2m"][:48],
                   "Wind km/h": h["wind_speed_10m"][:48]})
fig_h = go.Figure()
fig_h.add_trace(go.Scatter(x=hh["Time"], y=hh["Temp"], name="Temp °C"))
fig_h.add_trace(go.Scatter(x=hh["Time"], y=hh["RH %"], name="Humidity %"))
fig_h.add_trace(go.Scatter(x=hh["Time"], y=hh["Wind km/h"], name="Wind km/h"))
fig_h.update_layout(height=350, title="Next 48 hours")

# =========================================================
# LAYOUT: mobile tabs vs desktop inline
# =========================================================


if is_mobile:
    tab_map, tab_fc = st.tabs(["🗺️ Map", "📅 Forecast"])

    with tab_map:
        st.plotly_chart(fig_map, use_container_width=True)
        st.subheader("📊 All Monitoring Points")
        st.dataframe(mdf[["name", "FFDI", "Level"]], use_container_width=True)

    with tab_fc:
        st.dataframe(fc, use_container_width=True)
        st.plotly_chart(fig_h, use_container_width=True)
else:
    st.subheader("🗺️ Island Map — Danger · Burn Scars · Hotspots")
    st.plotly_chart(fig_map, use_container_width=True)

    st.subheader("📅 7-Day Outlook")
    st.dataframe(fc, use_container_width=True)
    st.plotly_chart(fig_h, use_container_width=True)

    st.subheader("📊 All Monitoring Points")
    st.dataframe(mdf[["name", "FFDI", "Level"]], use_container_width=True)

# View toggle
if is_mobile:
    st.markdown("[🖥️ Switch to desktop view](?view=desktop)")
else:
    st.markdown("[📱 Switch to mobile view](?view=mobile)")

st.info("""
**Data sources:** Open-Meteo (live weather & soil) · OpenStreetMap Nominatim
(place search) · FireMap.live (live fire overlays, basemap). Fire index
is a simplified FFDI adaptation — informational only, not an official warning.
Emergencies: call **199** (Greece).
""")
