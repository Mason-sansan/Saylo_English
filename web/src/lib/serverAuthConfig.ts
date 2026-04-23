/** Build with VITE_USE_SERVER_AUTH=1 when voice-server has SERVER_AUTH=1. */
export const USE_SERVER_AUTH =
  import.meta.env.VITE_USE_SERVER_AUTH === '1' || import.meta.env.VITE_USE_SERVER_AUTH === 'true';
