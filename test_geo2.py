import requests
places = [
    "Salamina, Greece",
    "Aianteio, Greece", 
    "Selinia, Greece", 
    "Kanakia, Greece", 
    "Ampelakia, Salamina, Greece", 
    "Psili Ammos, Salamina, Greece", 
    "Mavrovouni, Salamina, Greece"
]
for p in places:
    r = requests.get("https://nominatim.openstreetmap.org/search", params={"q": p, "format": "json", "limit": 1}, headers={"User-Agent": "salamina-fire-monitor/1.0"})
    if r.json():
        print(f"{p}: {r.json()[0]['lat']}, {r.json()[0]['lon']}")
    else:
        print(f"{p}: NOT FOUND")
