/** Sample rate the backend's speech-to-text expects. */
export const TARGET_SAMPLE_RATE = 16_000;

/**
 * Converts mono float audio at the AudioContext's rate (usually 48 kHz) to 16-bit PCM
 * at 16 kHz. Each output sample averages the input samples it covers, a cheap low-pass
 * that keeps high frequencies from aliasing into the speech band. State carries across
 * calls so chunk boundaries leave no seams.
 */
export class PcmDownsampler {
  private carry = new Float32Array(0);
  /** Absolute input index of carry[0]. */
  private carryStart = 0;
  /** Output samples produced so far. */
  private produced = 0;

  constructor(private readonly inputRate: number, private readonly outputRate = TARGET_SAMPLE_RATE) {}

  /** Window boundaries use exact integer math, so output never depends on how input was chunked. */
  private windowStart(k: number): number {
    return Math.floor((k * this.inputRate) / this.outputRate);
  }

  push(input: Float32Array): Int16Array {
    const buffer = new Float32Array(this.carry.length + input.length);
    buffer.set(this.carry);
    buffer.set(input, this.carry.length);
    const available = this.carryStart + buffer.length;

    const out: number[] = [];
    for (;;) {
      const start = this.windowStart(this.produced);
      const end = Math.max(start + 1, this.windowStart(this.produced + 1));
      if (end > available) break;
      let sum = 0;
      for (let i = start; i < end; i++) sum += buffer[i - this.carryStart];
      out.push(toInt16(sum / (end - start)));
      this.produced++;
    }

    const keepFrom = Math.min(this.windowStart(this.produced), available);
    this.carry = buffer.slice(keepFrom - this.carryStart);
    this.carryStart = keepFrom;
    return Int16Array.from(out);
  }
}

function toInt16(sample: number): number {
  const s = Math.max(-1, Math.min(1, sample));
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
}

/** Base64 of the samples' bytes (little-endian, as on every platform Chrome runs on). */
export function pcmToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
