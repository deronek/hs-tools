/**
 * Helpers for scripts/update-icons.mjs. The committed icon set is sticky:
 * icons are rewritten only when their art differs from the committed file
 * at the pixel level after normalization, so container, encoder, and
 * animation variant flapping never rewrites committed files. Filenames
 * stay content-hashed over the final WebP bytes.
 */

/** Common Minecraft item texture sizes, smallest first. */
const BASE_SIZES = [16, 32, 64];

/**
 * SkyCrypt serves 128x128 renders for real item art; smaller responses are
 * placeholder junk shared between items and must not be committed.
 */
export function isProperRender({ width, height }) {
  return width >= 128 && height >= 128;
}

/**
 * If an RGBA image is an exact integer nearest-neighbor upscale of a
 * smaller square texture, return that smaller texture's pixels; otherwise
 * return null. Requiring exactness keeps icons with real detail (32x32 or
 * 64x64 textures, antialiased renders) at their original size.
 */
export function reduceUpscale({ data, width, height, channels = 4 }) {
  if (width !== height) return null;
  for (const base of BASE_SIZES) {
    if (base >= width || width % base !== 0) continue;
    const reduced = extractIfUniform({ data, width, channels, base });
    if (reduced) return reduced;
  }
  return null;
}

function extractIfUniform({ data, width, channels, base }) {
  const scale = width / base;
  const reduced = Buffer.alloc(base * base * channels);
  for (let by = 0; by < base; by++) {
    for (let bx = 0; bx < base; bx++) {
      const reference = (by * scale * width + bx * scale) * channels;
      for (let channel = 0; channel < channels; channel++) {
        reduced[(by * base + bx) * channels + channel] =
          data[reference + channel];
      }
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const pixel =
            ((by * scale + dy) * width + (bx * scale + dx)) * channels;
          for (let channel = 0; channel < channels; channel++) {
            if (data[pixel + channel] !== data[reference + channel])
              return null;
          }
        }
      }
    }
  }
  return { data: reduced, width: base, height: base };
}
