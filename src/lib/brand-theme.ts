// Color manipulation utilities for dynamic brand theming

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/** WCAG relative luminance (0 = black, 1 = white) */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(
    rgb.r + (255 - rgb.r) * amount,
    rgb.g + (255 - rgb.g) * amount,
    rgb.b + (255 - rgb.b) * amount
  );
}

export function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(rgb.r * (1 - amount), rgb.g * (1 - amount), rgb.b * (1 - amount));
}

export function isLightColor(hex: string): boolean {
  return luminance(hex) > 0.4;
}

/** For dark mode: lighten dark colors so they're visible on dark backgrounds */
export function darkModeVariant(hex: string): string {
  const lum = luminance(hex);
  if (lum > 0.15) return hex; // already bright enough
  return lighten(hex, 0.4 + (0.15 - lum) * 2);
}

/**
 * Build CSS custom property key/value pairs from brand colors and font.
 * Returns { light: Record, dark: Record } for `:root` and `.dark` respectively.
 */
export function buildBrandCssVars(
  brandColors?: string[],
  fontFamily?: string
): { light: Record<string, string>; dark: Record<string, string> } {
  const primary = brandColors?.[0] || "#0284c7";
  const accent = brandColors?.[1] || primary;

  const light: Record<string, string> = {
    "--brand-primary": primary,
    "--brand-primary-hover": darken(primary, 0.12),
    "--brand-primary-light": lighten(primary, 0.92),
    "--brand-accent": accent,
  };

  const darkPrimary = darkModeVariant(primary);
  const darkAccent = darkModeVariant(accent);

  const dark: Record<string, string> = {
    "--brand-primary": darkPrimary,
    "--brand-primary-hover": lighten(darkPrimary, 0.2),
    "--brand-primary-light": `${darkPrimary}1a`, // ~10% opacity via hex alpha
    "--brand-accent": darkAccent,
  };

  if (fontFamily) {
    const fontValue = `"${fontFamily}", system-ui, -apple-system, sans-serif`;
    light["--brand-font"] = fontValue;
    dark["--brand-font"] = fontValue;
  }

  return { light, dark };
}
