"""Download Galaxy10 DECaLS (2.54 GB) with a checksum check. Resumable: re-run if it stops."""
import hashlib, os, sys, urllib.request

URL = "https://www.astro.utoronto.ca/~hleung/shared/Galaxy10/Galaxy10_DECals.h5"
SHA256 = "19AEFC477C41BB7F77FF07599A6B82A038DC042F889A111B0D4D98BB755C1571".lower()
DEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "Galaxy10_DECals.h5")

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()

os.makedirs(os.path.dirname(DEST), exist_ok=True)
have = os.path.getsize(DEST) if os.path.exists(DEST) else 0
req = urllib.request.Request(URL, headers={"Range": f"bytes={have}-"} if have else {})
try:
    with urllib.request.urlopen(req) as r:
        total = have + int(r.headers.get("Content-Length", 0))
        mode = "ab" if r.status == 206 else "wb"
        if mode == "wb": have = 0
        done = have
        with open(DEST, mode) as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk: break
                f.write(chunk); done += len(chunk)
                print(f"\r{done / 1e9:.2f} / {total / 1e9:.2f} GB", end="", flush=True)
except urllib.error.HTTPError as e:
    if e.code != 416: raise          # 416 = we already have the whole file
print("\nverifying checksum…")
ok = sha256(DEST) == SHA256
print("checksum OK" if ok else "CHECKSUM MISMATCH: delete data/Galaxy10_DECals.h5 and run again")
sys.exit(0 if ok else 1)
