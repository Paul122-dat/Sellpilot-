import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: {
      request: false,
      response: false
    },
    httpBodies: [],
    urlQueryParams: false,
    genAI: {
      inputs: false,
      outputs: false
    },
    databaseQueryData: false,
    graphQL: {
      document: false,
      variables: false
    },
    stackFrameVariables: false
  },
  // Start with error monitoring only. Tracing and Session Replay remain disabled
  // until their data collection and usage are reviewed separately.
  tracesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  beforeSend(event) {
    if (event.user) {
      event.user = {};
    }

    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;

      if (event.request.headers) {
        for (const header of Object.keys(event.request.headers)) {
          if (/^(authorization|cookie|set-cookie|apikey|x-api-key)$/i.test(header)) {
            delete event.request.headers[header];
          }
        }
      }

      if (typeof event.request.url === "string") {
        try {
          const url = new URL(event.request.url);
          url.search = "";
          url.hash = "";
          event.request.url = url.toString();
        } catch {
          delete event.request.url;
        }
      }
    }

    return event;
  }
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
