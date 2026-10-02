# se-vezmou

Next.js (App Router, TypeScript, Tailwind CSS) aplikace určená pro nasazení na Vercel.

## Vývoj

```bash
npm install
npm run dev      # http://localhost:3000
npm run lint
npm run build
```

## Nasazení na Vercel

1. Na https://vercel.com/new naimportuj tento GitHub repozitář.
2. Vercel automaticky detekuje Next.js (build `next build`, žádná další konfigurace není potřeba).
3. Proměnné prostředí nastav v _Project Settings → Environment Variables_
   (vzor viz `.env.example`).
4. Na Vercelu se staví **pouze větev `main`** (produkce). Ostatní větve se přeskakují přes
   `ignoreCommand` ve `vercel.json`, takže PR a pushe do `pre-prod` nespouštějí build.

## Workflow větví

- `main`: produkce, každý push = produkční deploy.
- `pre-prod`: sběrná větev. Feature větve se z ní větví a PR mířejí do `pre-prod`.
  Až je hotová dávka změn, otevře se jeden PR `pre-prod` → `main` a mergne se najednou.
- CI (GitHub Actions) běží na každém PR i pushi do `main` a `pre-prod`.
- Preview konkrétní větve lze vyžádat ručně: `npx vercel` (nebo dočasně upravit `ignoreCommand`).

Případně přes CLI: `npx vercel` (preview) / `npx vercel --prod`.
