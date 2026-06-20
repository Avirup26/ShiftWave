import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#0ea5e9',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '96px',
        }}
      >
        <span
          style={{
            color: 'white',
            fontSize: 220,
            fontWeight: 700,
            letterSpacing: '-8px',
            fontFamily: 'sans-serif',
          }}
        >
          SW
        </span>
      </div>
    ),
    { ...size },
  );
}
