// Keep HTTP and Socket.IO browser origin policy identical and explicit.
export const allowedOrigins = () =>
  [
    process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
    ...(process.env.FRONTEND_DEV_ORIGIN?.split(',').map((origin) =>
      origin.trim(),
    ) ?? []),
  ].filter((origin): origin is string => !!origin);
