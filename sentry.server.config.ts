import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  sendDefaultPii: false,
  tracesSampleRate: 0,
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
