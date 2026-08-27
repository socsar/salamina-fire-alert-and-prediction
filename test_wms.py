import plotly.graph_objects as go

fig = go.Figure(go.Scattermap(
    lat=[37.9641], lon=[23.4988], mode='markers', marker=dict(size=10, color='red')
))

fig.update_layout(
    margin=dict(l=0, r=0, t=0, b=0),
    map=dict(
        style="open-street-map",
        center=dict(lat=37.9641, lon=23.4988),
        zoom=11,
        layers=[
            {
                "sourcetype": "raster",
                "source": [
                    "https://maps.effis.emergency.copernicus.eu/effis?service=WMS&request=GetMap&layers=modis.ba.poly&styles=&format=image/png&transparent=true&version=1.1.1&height=256&width=256&srs=EPSG:3857&bbox={bbox-epsg-3857}"
                ],
                "opacity": 0.7
            }
        ]
    )
)
fig.write_html("test_wms.html")
