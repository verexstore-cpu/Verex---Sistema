import urllib.request
import urllib.parse
import json
import os
import hmac
import hashlib
from datetime import datetime, timezone

# ─────────────────────────────────────────────
#  CONFIGURACIÓN
# ─────────────────────────────────────────────
API_URL     = "https://verex-api.verexstore.workers.dev/"
API_PASS    = os.environ.get("VEREX_PASS", "")

# Cloudflare R2 — credenciales desde variables de entorno de Windows
R2_ACCOUNT_ID    = os.environ.get("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY    = os.environ.get("R2_ACCESS_KEY", "")
R2_SECRET_KEY    = os.environ.get("R2_SECRET_KEY", "")
R2_BUCKET        = os.environ.get("R2_BUCKET", "verex-backups")
R2_ENDPOINT      = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

RETENER_DIAS     = 30   # Backups a conservar


# ─────────────────────────────────────────────
#  AWS Signature V4 (compatible con R2)
# ─────────────────────────────────────────────
def _sign(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

def _signing_key(secret, date_stamp, region, service):
    k = _sign(("AWS4" + secret).encode("utf-8"), date_stamp)
    k = _sign(k, region)
    k = _sign(k, service)
    return _sign(k, "aws4_request")

def r2_put(bucket, key, body_bytes, content_type="application/json"):
    service  = "s3"
    region   = "auto"
    host     = f"{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    url      = f"{R2_ENDPOINT}/{bucket}/{key}"

    now      = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_str = now.strftime("%Y%m%d")

    payload_hash = hashlib.sha256(body_bytes).hexdigest()

    headers_to_sign = {
        "host":                 host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date":           amz_date,
        "content-type":         content_type,
    }
    signed_headers = ";".join(sorted(headers_to_sign.keys()))
    canonical_headers = "".join(f"{k}:{v}\n" for k, v in sorted(headers_to_sign.items()))

    canonical_request = "\n".join([
        "PUT",
        f"/{bucket}/{key}",
        "",
        canonical_headers,
        signed_headers,
        payload_hash,
    ])

    credential_scope = f"{date_str}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256",
        amz_date,
        credential_scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ])

    signing_key = _signing_key(R2_SECRET_KEY, date_str, region, service)
    signature   = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    auth = (
        f"AWS4-HMAC-SHA256 Credential={R2_ACCESS_KEY}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    req = urllib.request.Request(url, data=body_bytes, method="PUT")
    req.add_header("Authorization",          auth)
    req.add_header("x-amz-date",             amz_date)
    req.add_header("x-amz-content-sha256",   payload_hash)
    req.add_header("Content-Type",           content_type)
    req.add_header("Content-Length",         str(len(body_bytes)))

    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status

def r2_list(bucket, prefix=""):
    host     = f"{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    region   = "auto"
    service  = "s3"
    now      = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_str = now.strftime("%Y%m%d")

    params        = f"list-type=2&prefix={urllib.parse.quote(prefix)}"
    payload_hash  = hashlib.sha256(b"").hexdigest()

    headers_to_sign = {
        "host":                 host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date":           amz_date,
    }
    signed_headers    = ";".join(sorted(headers_to_sign.keys()))
    canonical_headers = "".join(f"{k}:{v}\n" for k, v in sorted(headers_to_sign.items()))

    canonical_request = "\n".join([
        "GET",
        f"/{bucket}/",
        params,
        canonical_headers,
        signed_headers,
        payload_hash,
    ])

    credential_scope = f"{date_str}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256",
        amz_date,
        credential_scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ])

    signing_key = _signing_key(R2_SECRET_KEY, date_str, region, service)
    signature   = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    auth = (
        f"AWS4-HMAC-SHA256 Credential={R2_ACCESS_KEY}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    url = f"{R2_ENDPOINT}/{bucket}/?{params}"
    req = urllib.request.Request(url)
    req.add_header("Authorization",        auth)
    req.add_header("x-amz-date",           amz_date)
    req.add_header("x-amz-content-sha256", payload_hash)

    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")

def r2_delete(bucket, key):
    host     = f"{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    region   = "auto"
    service  = "s3"
    now      = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_str = now.strftime("%Y%m%d")

    payload_hash = hashlib.sha256(b"").hexdigest()

    headers_to_sign = {
        "host":                 host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date":           amz_date,
    }
    signed_headers    = ";".join(sorted(headers_to_sign.keys()))
    canonical_headers = "".join(f"{k}:{v}\n" for k, v in sorted(headers_to_sign.items()))

    canonical_request = "\n".join([
        "DELETE",
        f"/{bucket}/{key}",
        "",
        canonical_headers,
        signed_headers,
        payload_hash,
    ])

    credential_scope = f"{date_str}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256",
        amz_date,
        credential_scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ])

    signing_key = _signing_key(R2_SECRET_KEY, date_str, region, service)
    signature   = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    auth = (
        f"AWS4-HMAC-SHA256 Credential={R2_ACCESS_KEY}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    url = f"{R2_ENDPOINT}/{bucket}/{key}"
    req = urllib.request.Request(url, method="DELETE")
    req.add_header("Authorization",        auth)
    req.add_header("x-amz-date",           amz_date)
    req.add_header("x-amz-content-sha256", payload_hash)

    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status


# ─────────────────────────────────────────────
#  BACKUP PRINCIPAL
# ─────────────────────────────────────────────
def backup():
    if not R2_ACCESS_KEY or not R2_SECRET_KEY:
        print("[ERROR] Faltan credenciales R2. Configura R2_ACCESS_KEY y R2_SECRET_KEY.")
        print("   Ve a: https://dash.cloudflare.com -> R2 -> Manage R2 API Tokens")
        return

    # 1. Obtener backup desde el worker
    print("[1/3] Conectando con VEREX API...")
    payload = json.dumps({ "accion": "BACKUP_SOLO", "_pass": API_PASS }).encode()
    req     = urllib.request.Request(
        API_URL, data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent":   "VEREX-Backup/1.0"
        }
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())

    if not data.get("ok"):
        raise Exception(data.get("error", "Error desconocido del worker"))

    # 2. Subir a R2
    fecha     = datetime.now().strftime("%Y-%m-%d_%H-%M")
    key       = f"backups/backup-verex-{fecha}.json"
    body      = json.dumps(data["backup"], ensure_ascii=False, indent=2).encode("utf-8")

    print(f"[2/3] Subiendo a R2: {key} ({len(body)/1024:.1f} KB)")
    status = r2_put(R2_BUCKET, key, body)
    print(f"[OK] Backup guardado en R2 (HTTP {status})")

    # 3. Limpiar backups viejos (> RETENER_DIAS)
    _limpiar_viejos()

def _limpiar_viejos():
    try:
        xml     = r2_list(R2_BUCKET, prefix="backups/")
        import re
        keys    = re.findall(r"<Key>(backups/backup-verex-[\d_\-]+\.json)</Key>", xml)
        keys    = sorted(keys)
        a_borrar = keys[:-RETENER_DIAS] if len(keys) > RETENER_DIAS else []
        for k in a_borrar:
            r2_delete(R2_BUCKET, k)
            print(f"[DEL] Eliminado backup viejo: {k}")
        if not a_borrar:
            print(f"[3/3] {len(keys)} backup(s) en R2 — sin limpiar.")
    except Exception as e:
        print(f"[WARN] No se pudo limpiar backups viejos: {e}")


if __name__ == "__main__":
    backup()
