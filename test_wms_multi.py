import requests
url = "https://maps.effis.emergency.copernicus.eu/effis?service=WMS&request=GetMap&layers=modis.ba.poly,modis.ba.poly.2023,modis.ba.poly.2022,modis.ba.poly.2021,modis.ba.poly.2020,modis.ba.poly.2019,modis.ba.poly.2018&styles=&format=image/png&transparent=true&version=1.1.1&height=256&width=256&srs=EPSG:3857&bbox=2600000,4560000,2620000,4580000"
r = requests.get(url)
print(r.status_code)
print(len(r.content))
