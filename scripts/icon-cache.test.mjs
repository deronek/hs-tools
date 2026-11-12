import { describe, expect, it } from "vitest";

import { isProperRender, reduceUpscale } from "./lib/icon-cache.mjs";

const texture = (size) => {
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = (y * size + x) * 4;
      data[pixel] = (x * 17) % 256;
      data[pixel + 1] = (y * 19) % 256;
      data[pixel + 2] = (x + y * 5) % 256;
      data[pixel + 3] = 255;
    }
  }
  return data;
};

const upscale = (data, size, scale) => {
  const out = Buffer.alloc(size * scale * (size * scale) * 4);
  for (let y = 0; y < size * scale; y++) {
    for (let x = 0; x < size * scale; x++) {
      const source = (Math.floor(y / scale) * size + Math.floor(x / scale)) * 4;
      const target = (y * (size * scale) + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        out[target + channel] = data[source + channel];
      }
    }
  }
  return out;
};

describe("render classification", () => {
  it("accepts proper 128x128 renders", () => {
    expect(isProperRender({ width: 128, height: 128 })).toBe(true);
    expect(isProperRender({ width: 160, height: 160 })).toBe(true);
  });

  it("rejects SkyCrypt placeholder junk", () => {
    expect(isProperRender({ width: 16, height: 16 })).toBe(false);
    expect(isProperRender({ width: 64, height: 64 })).toBe(false);
  });
});

describe("upscale reduction", () => {
  it("recovers a 16x16 texture from an 8x upscale", () => {
    const base = texture(16);
    expect(
      reduceUpscale({ data: upscale(base, 16, 8), width: 128, height: 128 }),
    ).toEqual({ data: base, width: 16, height: 16 });
  });

  it("recovers a 32x32 texture from a 4x upscale", () => {
    const base = texture(32);
    expect(
      reduceUpscale({ data: upscale(base, 32, 4), width: 128, height: 128 }),
    ).toEqual({ data: base, width: 32, height: 32 });
  });

  it("keeps images with real detail at their original size", () => {
    expect(
      reduceUpscale({ data: texture(128), width: 128, height: 128 }),
    ).toBeNull();
  });

  it("keeps sizes that are not integer upscales", () => {
    expect(
      reduceUpscale({ data: texture(48), width: 48, height: 48 }),
    ).toBeNull();
    expect(
      reduceUpscale({ data: texture(48), width: 50, height: 53 }),
    ).toBeNull();
  });

  it("keeps a 16x16 texture as is", () => {
    expect(
      reduceUpscale({ data: texture(16), width: 16, height: 16 }),
    ).toBeNull();
  });
});
