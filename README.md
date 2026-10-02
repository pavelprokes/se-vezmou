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
3. Proměnné prostředí nastav v *Project Settings → Environment Variables*
   (vzor viz `.env.example`).
4. Každý push do `main` = produkční deploy, každá větev / PR = preview deploy.

Případně přes CLI: `npx vercel` (preview) / `npx vercel --prod`.
