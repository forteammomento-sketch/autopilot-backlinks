import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Searchprex — AI Visibility Autopilot',
  description: 'Find why AI answers do not cite you, then fix it.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
