-- ═══════════════════════════════════════════════════════════════════════════
--  REVISIÓN DE LA DEVOLUCIÓN DEL 29–30 SEPT 2026 (3 intentos, 2 fallidos)
--  Dónde: Supabase → tu proyecto → SQL Editor → New query. Pega UNA consulta a la vez y pulsa Run.
--  Las consultas 1 a 4 SOLO LEEN (no cambian nada). La 5 borra y va al final, tras revisar.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Los registros de devoluciones recientes ─────────────────────────────
select id,
       data->>'fecha'                              as fecha,
       data->>'vendedor'                           as vendedor,
       data->>'total_unidades'                     as total_unidades,   -- vacío en los registros viejos
       jsonb_array_length((data->>'items')::jsonb) as productos
from devoluciones
order by data->>'fecha' desc
limit 10;


-- ── 2) AUDITORÍA DE STOCK de los productos de esa devolución ───────────────
--  Usa el registro del PRIMER intento (lista completa, en el orden en que se procesaron).
--  Mira las filas 1 a 12: ahí es donde quedaron los cambios a medias.
--    · bodega_sistema        → compárala con lo que CUENTAS FÍSICAMENTE en bodega.
--    · consignacion_en_stock → debe ser IGUAL a consignacion_real_vendedores.
--      Si es MENOR, el conteo de consignación bajó de más.
--    · consignacion_real_vendedores → suma de lo que los vendedores tienen (cantidad − vendido).
with reg as (
  select t.n, t.it->>'codigo' as codigo, t.it->>'nombre' as nombre
  from devoluciones d,
       jsonb_array_elements((d.data->>'items')::jsonb) with ordinality as t(it, n)
  where d.id = 'DEV_1790743111454'
)
select reg.n                                                      as orden_en_lista,
       reg.codigo,
       reg.nombre,
       nullif(s.data->>'stock_bodega','')::int                    as bodega_sistema,
       nullif(s.data->>'stock_consignacion','')::int              as consignacion_en_stock,
       coalesce((select sum(greatest(0, coalesce(nullif(c.data->>'cantidad','')::int,0)
                                      - coalesce(nullif(c.data->>'vendido','')::int,0)))
                 from consignacion c
                 where c.data->>'codigo' = reg.codigo
                   and coalesce(c.data->>'estado','activo') = 'activo'), 0) as consignacion_real_vendedores,
       case
         when s.id is null then 'NO EXISTE EN STOCK'
         when coalesce(nullif(s.data->>'stock_consignacion','')::int,0) <
              coalesce((select sum(greatest(0, coalesce(nullif(c.data->>'cantidad','')::int,0)
                                              - coalesce(nullif(c.data->>'vendido','')::int,0)))
                        from consignacion c
                        where c.data->>'codigo' = reg.codigo
                          and coalesce(c.data->>'estado','activo') = 'activo'), 0)
           then 'REVISAR: consignación en stock más baja que lo que tienen los vendedores'
         else ''
       end as aviso
from reg
left join stock s on s.id = reg.codigo
order by reg.n;


-- ── 3) ESTADO DE LA CONSIGNACIÓN de esos productos (por vendedor) ──────────
--  Un producto "devuelto" con cantidad 0 cuya pieza NO subió a bodega es el caso del producto ~10.
with reg as (
  select t.n, t.it->>'codigo' as codigo
  from devoluciones d,
       jsonb_array_elements((d.data->>'items')::jsonb) with ordinality as t(it, n)
  where d.id = 'DEV_1790743111454'
)
select reg.n as orden_en_lista, c.data->>'codigo' as codigo, c.data->>'nombre' as nombre,
       c.data->>'vendedor' as vendedor, c.data->>'cantidad' as cantidad,
       c.data->>'vendido' as vendido, c.data->>'estado' as estado, c.id as id_consignacion
from reg
join consignacion c on c.data->>'codigo' = reg.codigo
order by reg.n, c.data->>'vendedor';


-- ── 4) LO QUE YA SE ARREGLÓ CON EL TERCER INTENTO (el bueno) ───────────────
--  Del MISMO vendedor de la devolución: si aparece alguna fila aquí (activa, con piezas sin
--  vender), ese producto NO se devolvió. Lo ideal es que esta consulta salga vacía.
select c.data->>'codigo' as codigo, c.data->>'nombre' as nombre, c.data->>'vendedor' as vendedor,
       c.data->>'cantidad' as cantidad, c.data->>'vendido' as vendido, c.data->>'estado' as estado
from consignacion c
where c.data->>'codigo' in (
        select (it->>'codigo')
        from devoluciones d, jsonb_array_elements((d.data->>'items')::jsonb) it
        where d.id = 'DEV_1790743887815')
  and c.data->>'vendedor' = (select d.data->>'vendedor' from devoluciones d where d.id = 'DEV_1790743887815')
  and coalesce(c.data->>'estado','activo') = 'activo'
  and coalesce(nullif(c.data->>'cantidad','')::int,0) - coalesce(nullif(c.data->>'vendido','')::int,0) > 0
order by c.data->>'codigo';


-- ── 5) LIMPIEZA (ejecutar AL FINAL): borrar los 2 registros FALSOS del historial ─
--  Son los dos intentos fallidos (dicen 30 productos pero solo se movieron ~9).
--  Antes de borrar, comprueba con la consulta 1 que existen y guarda una copia:
--    select * from devoluciones where id in ('DEV_1790743111454','DEV_1790743149436');
--  Solo entonces:
--    delete from devoluciones where id in ('DEV_1790743111454','DEV_1790743149436');
