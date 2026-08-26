import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KollektivMatch – Finn ditt neste kollektiv',
  description: 'Finn ledige rom og kollektiv i Norge. Søk, filtrer og kontakt utleier på ett sted.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nb">
      <body>{children}</body>
    </html>
  );
}
