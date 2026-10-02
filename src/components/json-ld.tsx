import { serializeJsonLd } from "@/seo/json-ld";

/**
 * Strukturovaná data vykreslená na serveru jako `<script type="application/ld+json">`.
 * Nejde o spustitelný kód, proto obyčejný `<script>` (ne `next/script`); serializace escapuje `<`.
 */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
