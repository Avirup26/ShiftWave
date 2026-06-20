import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ShiftWave',
    short_name: 'ShiftWave',
    description: 'Scheduling & timekeeping for a multi-location swim school',
    start_url: '/',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#0ea5e9',
    icons: [
      {
        src: '/icon',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
