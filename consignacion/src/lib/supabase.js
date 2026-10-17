// Cliente de Supabase (base de datos)
// Parte de worker-firebase.js (Worker verex-api). Código movido tal cual desde el archivo
// único original; ver worker-firebase.js para el reparto de acciones.

// ── CLASE SUPABASE ────────────────────────────────────────────────
//
//  Estructura de cada tabla en Supabase:
//    id   TEXT PRIMARY KEY   — el mismo "doc ID" que se usaba en Firestore
//    data JSONB              — todos los campos del documento
//
//  Función PostgreSQL requerida (ver SQL de setup):
//    update_doc(p_table, p_id, p_patch) — merge parcial de JSONB
// ─────────────────────────────────────────────────────────────────
export class Supabase {
  constructor(url, key) {
    this.url = (url || "").replace(/\/$/, "");
    this.key = key || "";
  }

  _headers(prefer = null) {
    const h = {
      "apikey":        this.key,
      "Authorization": `Bearer ${this.key}`,
      "Content-Type":  "application/json"
    };
    if (prefer) h["Prefer"] = prefer;
    return h;
  }

  // Leer un documento por id
  async get(table, id) {
    const res  = await fetch(
      `${this.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=id,data&limit=1`,
      { headers: this._headers(), cf: { cacheTtl: 0, cacheEverything: false } }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB get ${table}/${id}: ${res.status} ${txt}`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return { id: rows[0].id, ...rows[0].data };
  }

  // Obtener todos los documentos de una tabla.
  // Pagina en bloques de 1000 (en vez de pedir limit=10000 de una vez) y
  // desactiva el cache de borde de Cloudflare en cada subrequest — sin esto,
  // filas recién insertadas podían no aparecer en lecturas subsecuentes
  // (Cloudflare cacheaba la respuesta GET del REST de Supabase).
  async getAll(table) {
    const pageSize = 1000;
    let allRows = [];
    let offset = 0;
    while (true) {
      const res = await fetch(
        `${this.url}/rest/v1/${table}?select=id,data&order=id&limit=${pageSize}&offset=${offset}`,
        { headers: this._headers(), cf: { cacheTtl: 0, cacheEverything: false } }
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`SB getAll ${table}: ${res.status} ${txt}`);
      }
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) break;
      allRows = allRows.concat(rows);
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
    return allRows.map(r => ({ id: r.id, ...r.data }));
  }

  // Crear/sobreescribir documento (upsert completo)
  async set(table, id, obj) {
    const { id: _id, ...data } = obj;
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method:  "POST",
      headers: this._headers("resolution=merge-duplicates"),
      body:    JSON.stringify({ id, data }),
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB set ${table}: ${res.status} ${txt}`);
    }
  }

  // Inserta SOLO si el id no existe (atómico: ON CONFLICT DO NOTHING). Devuelve true si este llamado lo creó.
  // Sirve de candado para que una tarea de una sola vez no se ejecute dos veces a la vez.
  async insertIfAbsent(table, id, obj) {
    const { id: _id, ...data } = obj;
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method:  "POST",
      headers: this._headers("resolution=ignore-duplicates,return=representation"),
      body:    JSON.stringify({ id, data }),
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB insertIfAbsent ${table}: ${res.status} ${txt}`);
    }
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0;
  }

  // Lee VARIOS documentos por id con una sola petición (en bloques de 60 ids).
  // Sirve para no gastar el límite de 50 subrequests por invocación del plan gratuito.
  async getMany(table, ids) {
    const uniq = Array.from(new Set((ids || []).map(String).filter(Boolean)));
    const out = [];
    for (let i = 0; i < uniq.length; i += 60) {
      const lista = uniq.slice(i, i + 60).map(x => '"' + encodeURIComponent(x) + '"').join(",");
      const res = await fetch(
        `${this.url}/rest/v1/${table}?id=in.(${lista})&select=id,data`,
        { headers: this._headers(), cf: { cacheTtl: 0, cacheEverything: false } }
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`SB getMany ${table}: ${res.status} ${txt}`);
      }
      const rows = await res.json();
      if (Array.isArray(rows)) for (const r of rows) out.push({ id: r.id, ...r.data });
    }
    return out;
  }

  // Borra VARIOS documentos por id con una sola petición por bloque de 60.
  async deleteMany(table, ids) {
    const uniq = Array.from(new Set((ids || []).map(String).filter(Boolean)));
    for (let i = 0; i < uniq.length; i += 60) {
      const lista = uniq.slice(i, i + 60).map(x => '"' + encodeURIComponent(x) + '"').join(",");
      const res = await fetch(`${this.url}/rest/v1/${table}?id=in.(${lista})`, { method: "DELETE", headers: this._headers() });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`SB deleteMany ${table}: ${res.status} ${txt}`);
      }
    }
  }

  // Guarda VARIOS documentos COMPLETOS con una sola petición por bloque de 100 (upsert).
  // Cada doc debe traer todos sus campos: reemplaza el JSON de datos, igual que set().
  async setMany(table, docs) {
    for (let i = 0; i < docs.length; i += 100) {
      const rows = docs.slice(i, i + 100).map(({ id, ...data }) => ({ id, data }));
      const res = await fetch(`${this.url}/rest/v1/${table}`, {
        method:  "POST",
        headers: this._headers("resolution=merge-duplicates"),
        body:    JSON.stringify(rows),
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`SB setMany ${table}: ${res.status} ${txt}`);
      }
    }
  }

  // stock_total es un DERIVADO de las unidades reales: bodega + tienda +
  // consignación (misma fórmula que _stockTotalProd() en el admin).
  //
  // Se recalcula acá, en el único punto por donde pasan TODAS las escrituras,
  // porque hay más de 20 lugares en el worker que mueven stock y cualquiera se
  // podía olvidar de mantenerlo. De hecho eso pasaba: stock_total solo se
  // escribía al crear el producto y nunca se decrementaba al vender, así que
  // quedaba inflado para siempre y los catálogos nunca ocultaban lo agotado.
  static COMPONENTES_STOCK = ["stock_bodega", "stock_tienda", "stock_consignacion"];

  async _conStockTotal(id, fields) {
    const comp = Supabase.COMPONENTES_STOCK;
    // Si el patch no toca las unidades, no hay nada que recalcular.
    if (!comp.some(c => fields[c] !== undefined)) return fields;

    const vals = { ...fields };
    // Si el patch trae solo algunos componentes, se leen los actuales para
    // completar los que faltan — sin eso el total saldría mal.
    if (!comp.every(c => vals[c] !== undefined)) {
      let actual = null;
      try { actual = await this.get("stock", id); } catch (_) { actual = null; }
      if (!actual) return fields;   // no se pudo leer: mejor no tocar el total
      for (const c of comp) if (vals[c] === undefined) vals[c] = actual[c];
    }

    const total = comp.reduce((a, c) => a + (parseInt(vals[c]) || 0), 0);
    return { ...fields, stock_total: total };
  }

  // Actualizar campos específicos (merge parcial vía RPC)
  async update(table, id, fields) {
    if (table === "stock") fields = await this._conStockTotal(id, fields);
    const res = await fetch(`${this.url}/rest/v1/rpc/update_doc`, {
      method:  "POST",
      headers: this._headers(),
      body:    JSON.stringify({ p_table: table, p_id: String(id), p_patch: fields })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB update ${table}/${id}: ${res.status} ${txt}`);
    }
  }

  // Reserva atómica de stock (ver reservar_stock_pedido en Supabase — SQL
  // Editor): descuenta primero de tienda, luego de bodega, y suma a
  // stock_reservado, todo o nada. Bloquea la fila mientras corre, así que
  // dos pedidos simultáneos del mismo producto nunca pueden vender de más.
  // { ok:false, error:"sin_stock" } si no alcanza — no cambia nada.
  async reservar(id, cantidad = 1) {
    const res = await fetch(`${this.url}/rest/v1/rpc/reservar_stock_pedido`, {
      method:  "POST",
      headers: this._headers(),
      body:    JSON.stringify({ p_id: String(id), p_cantidad: cantidad })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB reservar ${id}: ${res.status} ${txt}`);
    }
    return await res.json();
  }

  // Inversa de reservar(): repone la cantidad exacta a su origen (tienda y/o
  // bodega) y resta de stock_reservado. Se usa al vencer una reserva sin
  // confirmar, o al cancelar un pedido que sí llegó a reservar.
  async liberar(id, descTienda = 0, descBodega = 0) {
    const res = await fetch(`${this.url}/rest/v1/rpc/liberar_stock_reservado`, {
      method:  "POST",
      headers: this._headers(),
      body:    JSON.stringify({ p_id: String(id), p_desc_tienda: descTienda, p_desc_bodega: descBodega })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB liberar ${id}: ${res.status} ${txt}`);
    }
    return await res.json();
  }

  // Eliminar documento
  async delete(table, id) {
    const res = await fetch(
      `${this.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,
      { method: "DELETE", headers: this._headers() }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB delete ${table}/${id}: ${res.status} ${txt}`);
    }
  }

  // Documentos cuyo id empieza con `prefijo` (usar prefijos sin "_" ni "%": son comodines
  // de LIKE). Opcional: solo los que tienen data->>campo > mayorQue (texto, p. ej. fechas ISO).
  async listPrefix(table, prefijo, { campo = "", mayorQue = "", limite = 200 } = {}) {
    if (/[_%*\\]/.test(prefijo)) throw new Error("listPrefix: prefijo con comodines");
    let q = `${this.url}/rest/v1/${table}?select=id,data&id=like.${encodeURIComponent(prefijo)}*&order=id&limit=${Math.min(Math.max(limite, 1), 1000)}`;
    if (campo && mayorQue) q += `&data->>${encodeURIComponent(campo)}=gt.${encodeURIComponent(mayorQue)}`;
    const res = await fetch(q, { headers: this._headers(), cf: { cacheTtl: 0, cacheEverything: false } });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SB listPrefix ${table}: ${res.status} ${txt}`);
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows.map(r => ({ id: r.id, ...r.data })) : [];
  }

  // Query con filtro sobre campo JSONB (campo == valor)
  async query(table, campo, _op, valor) {
    const res = await fetch(
      `${this.url}/rest/v1/${table}?select=id,data&data->>${encodeURIComponent(campo)}=eq.${encodeURIComponent(valor)}`,
      { headers: this._headers(), cf: { cacheTtl: 0, cacheEverything: false } }
    );
    if (!res.ok) {
      console.error(`[Supabase.query] Error ${res.status} en tabla ${table}`);
      return [];
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows.map(r => ({ id: r.id, ...r.data }));
  }
}
