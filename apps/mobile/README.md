# @coachingdesk/mobile

The owner/teacher app (Expo SDK 58, Expo Router, React Native Paper). See docs/TECH_STACK.md.

## Run it

1. Install the development build on your Android phone (EAS: `eas build --profile development --platform android`).
   Rebuild only when a native module or `app.json` native setting changes.
2. `pnpm start` here, then open the app on the phone (same Wi-Fi as this Mac).

## The API

In development the app calls the API on the same Mac that serves the app (`src/api/config.ts`):
the dev server's address with port 3001. Run the API (`pnpm --filter @coachingdesk/api dev`) on
the same Wi-Fi. Staging/production builds must set `EXPO_PUBLIC_API_URL`.

Links to the Terms, Privacy Policy and help pages open the website (`src/legal/legal-links.ts`):
`https://coachingdesk.in` unless `EXPO_PUBLIC_WEB_URL` says otherwise (e.g. a staging site).

`pnpm test` here runs the app's unit tests (Vitest), e.g. the API client.
