-- Oprava: deterministické pořadí hostů v domácnosti.
--
-- Hosté domácnosti se čtou `order by g.created_at, g.id`. Domácnost se ukládá v jedné transakci a `now()` je v ní
-- pro všechny řádky stejné, takže o pořadí rozhodovalo náhodné `id` (e2e `admin-guests.e2e.ts:45` občas dostalo
-- druhého hosta jako prvního). `clock_timestamp()` dává každému vloženému řádku vlastní, rostoucí čas, takže pořadí
-- odpovídá pořadí vložení; `id` zůstává jen jako poslední pojistka.
alter table se_vezmou.guests alter column created_at set default pg_catalog.clock_timestamp();
