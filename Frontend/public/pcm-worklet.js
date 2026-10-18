// Runs on the audio thread. Downmixes the video's audio to mono and hands it to the
// content script in blocks of 4096 samples (~85 ms at 48 kHz); resampling happens there.
const BLOCK = 4096;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(BLOCK);
    this.length = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length > 0) {
      const frames = channels[0].length;
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels.length; c++) sum += channels[c][i];
        this.block[this.length++] = sum / channels.length;
        if (this.length === BLOCK) {
          this.port.postMessage(this.block, [this.block.buffer]);
          this.block = new Float32Array(BLOCK);
          this.length = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('politalk-pcm-capture', PcmCaptureProcessor);
