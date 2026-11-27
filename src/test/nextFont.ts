// Stand-in for next/font/google in tests (vitest.config.mts aliases it): next/font only works inside Next's
// compiler, so each face here is just its CSS variable's class. A test can still vi.mock it with its own.
const face = (name: string) => () => ({ variable: `font-${name}-var`, className: `font-${name}` });
export const Archivo = face("archivo");
export const JetBrains_Mono = face("jetbrains-mono");
export const Bodoni_Moda = face("bodoni-moda");
export const Instrument_Sans = face("instrument-sans");
