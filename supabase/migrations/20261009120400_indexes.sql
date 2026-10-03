-- Oprava 5/5 (revize kódu): indexy.
--
-- * Trigramové indexy weddings_names_trgm_idx (partner_a_name || ' ' || partner_b_name) a weddings_slug_trgm_idx
--   (slug) nepodporuje žádný dotaz: op_list_weddings hledá přes `normalize_name(...) like '%t%'` a
--   `lower(slug) like '%t%'` uvnitř podmínky `not exists (... unnest ...)` spojené přes `or`, kterou plánovač
--   nepřevede na přístup přes index. Operátorský seznam čte stovky až tisíce řádků a seřadí je podle created_at,
--   takže index jen zpomaloval zápisy. Zrušeny; kdyby seznam vyrostl, nový index se navrhne podle skutečného
--   dotazu (výraz musí odpovídat dotazu doslova).
-- * rsvp_people(guest_id): cizí klíč (wedding_id, guest_id) -> guests s on delete cascade a dotazy „osoby hosta“
--   (výmaz hosta, nahlédnutí operátora) procházely celou tabulku svatby.

drop index se_vezmou.weddings_names_trgm_idx;
drop index se_vezmou.weddings_slug_trgm_idx;

create index rsvp_people_guest_idx on se_vezmou.rsvp_people (guest_id) where guest_id is not null;
