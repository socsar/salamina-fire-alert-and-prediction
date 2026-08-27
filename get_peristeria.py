import requests
p = "Peristeria, Salamina, Greece"
r = requests.get("https://nominatim.openstreetmap.org/search", params={"q": p, "format": "json", "limit": 1}, headers={"User-Agent": "salamina-fire-monitor/1.0"})
if r.json():
    print(f"{p}: {r.json()[0]['lat']}, {r.json()[0]['lon']}")
else:
    print(f"{p}: NOT FOUND")
