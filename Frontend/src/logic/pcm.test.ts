import { describe, expect, it } from 'vitest';
import { PcmDownsampler, pcmToBase64 } from './pcm';

const sine = (freq: number, rate: number, length: number, phase = 0) =>
  Float32Array.from({ length }, (_, i) => Math.sin((2 * Math.PI * freq * (i + phase)) / rate));

describe('PcmDownsampler', () => {
  it('produces one output sample per three input samples at 48 kHz', () => {
    const d = new PcmDownsampler(48_000);
    expect(d.push(new Float32Array(4800)).length).toBe(1600);
  });

  it('gives the same output whether the input arrives whole or in odd-sized chunks', () => {
    const input = sine(440, 44_100, 44_100);
    const whole = new PcmDownsampler(44_100).push(input);

    const chunked = new PcmDownsampler(44_100);
    const parts: Int16Array[] = [];
    for (let i = 0; i < input.length; i += 997) parts.push(chunked.push(input.subarray(i, i + 997)));
    const joined = Int16Array.from(parts.flatMap((p) => Array.from(p)));

    expect(joined.length).toBe(whole.length);
    expect(Array.from(joined)).toEqual(Array.from(whole));
  });

  it('keeps speech-band signals and clips out-of-range samples', () => {
    const out = new PcmDownsampler(48_000).push(sine(300, 48_000, 48_000));
    const peak = Math.max(...Array.from(out, Math.abs));
    expect(peak).toBeGreaterThan(30_000);

    const loud = new PcmDownsampler(48_000).push(new Float32Array(30).fill(2));
    expect(Array.from(loud)).toEqual(Array(10).fill(0x7fff));
  });

  it('removes 16 kHz content, which would otherwise alias to DC', () => {
    const out = new PcmDownsampler(48_000).push(sine(16_000, 48_000, 48_000, 0.4));
    const peak = Math.max(...Array.from(out, Math.abs));
    expect(peak).toBeLessThan(0.01 * 0x7fff);
  });
});

describe('pcmToBase64', () => {
  it('encodes little-endian 16-bit samples', () => {
    expect(pcmToBase64(Int16Array.from([1, -1]))).toBe(btoa(String.fromCharCode(1, 0, 255, 255)));
  });
});
