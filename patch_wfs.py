import re

with open("app.py", "r") as f:
    content = f.read()

# 1. Add fetch_firemap_hotspots
fetch_code = """
@st.cache_data(ttl=600)
def fetch_firemap_hotspots():
    \"\"\"Fetch active fire points from FireMap.live WFS for Salamina bbox.\"\"\"
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
"""
content = re.sub(r'(@st\.cache_data\(ttl=86400\)\ndef geocode\(query\):)', fetch_code + r'\n\1', content)

# 2. Add hotspots variable and hotspot_nearby logic
hotspot_logic = """
hotspots = fetch_firemap_hotspots() if show_fm_active else pd.DataFrame()
hotspot_nearby = False
if not hotspots.empty:
    dlat = (hotspots["lat"] - lat) * 111.0
    dlon = (hotspots["lon"] - lon) * 111.0 * np.cos(np.radians(lat))
    hotspot_nearby = bool((np.sqrt(dlat**2 + dlon**2) < 5).any())
"""
content = re.sub(r'(ffdi = fire_danger_index\(temp, rh, wind, dsr, df_drought\)\nlevel, color = danger_class\(ffdi\))', r'\1\n' + hotspot_logic, content)

# 3. Add to Scattermapbox Layer 3
scatter_layer = """
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
"""
content = re.sub(r'(# --- Layer 2: live danger points \(on top\) ---)', scatter_layer + r'\n\n\1', content)

# 4. Fix alert text
alert_logic_old = """if crossed and not st.session_state["alerts_sent"].get(alert_key):
    highest = crossed[-1]
    msg = (f"🔥 FIRE ALERT — {place}, Salamina\\n"
           f"FFDI: {ffdi} ({highest})\\n"
           f"Time: {datetime.now().strftime('%H:%M')}\\n"
           f"Take precautions immediately.")
    st.toast(f"⚠️ {highest} at {place}!", icon="🚨")
    st.markdown(\"\"\"<audio autoplay><source src=
        "https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg"></audio>\"\"\",
        unsafe_allow_html=True)
    st.error(f"🚨 **{highest.upper()}** at {place} — FFDI {ffdi}."
             + " Report smoke to **199**.")"""

alert_logic_new = """if (crossed or hotspot_nearby) and not st.session_state["alerts_sent"].get(alert_key):
    highest = crossed[-1] if crossed else "Hotspot Detected"
    msg = (f"🔥 FIRE ALERT — {place}, Salamina\\n"
           f"FFDI: {ffdi} ({highest})\\n"
           f"Satellite hotspot within 5 km: {'YES ⚠️' if hotspot_nearby else 'No'}\\n"
           f"Time: {datetime.now().strftime('%H:%M')}\\n"
           f"Take precautions immediately.")
    st.toast(f"⚠️ {highest} at {place}!", icon="🚨")
    st.markdown(\"\"\"<audio autoplay><source src=
        "https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg"></audio>\"\"\",
        unsafe_allow_html=True)
    st.error(f"🚨 **{highest.upper()}** at {place} — FFDI {ffdi}"
             + (" — 🛰️ **SATELLITE HOTSPOT DETECTED NEARBY!**" if hotspot_nearby else "")
             + " Report smoke to **199**.")"""
content = content.replace(alert_logic_old, alert_logic_new)

# 5. Remove WMS layer for active fires
content = re.sub(r'if show_fm_active:\s*wms_layers\.append\(\{[\s\S]*?"opacity": 1\.0\s*\}\)', '', content)

with open("app.py", "w") as f:
    f.write(content)
