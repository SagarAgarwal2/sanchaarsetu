import requests
import time

URL = "http://127.0.0.1:8000/sws/webhook"

payload = {
    "ubid": "UBID-12345",
    "event_type": "address_update",
    "payload": {"address": "12 MG Road, Bengaluru", "proprietor": "A. Rao"},
    "timestamp": time.time(),
}

r = requests.post(URL, json=payload, headers={"X-API-Key": "sws-secret-key"})
print(r.status_code, r.json())
