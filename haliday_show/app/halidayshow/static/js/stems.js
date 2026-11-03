// Split vocals: a song separated into its vocals and the music behind them, in your browser, by a
// free AI model (UVR's MDX-Net "Voc FT"). The model works on the song's spectrum in 6-second
// chunks; this does everything around it (the spectrum in, the sound back out), with no DOM, so it
// runs in the browser's worker (stemsworker.js, with onnxruntime-web) and in Node (the tests use a
// stand-in model; checked against the real one with onnxruntime-node, 0.985 correlation with a known
// voice). The model's output is the vocals; the music is the song with them taken away.

export const MDX = {
  rate: 44100,
  nFft: 7680, // its window: not a power of two, so the transform below uses Bluestein's method
  hop: 1024,
  dimF: 3072, // the lowest bins it looks at (up to about 17.6 kHz)
  dimT: 256, // frames per chunk
  compensate: 1.021, // the model's own level correction, from UVR's settings for it
};
const CHUNK = MDX.hop * (MDX.dimT - 1); // samples the model sees at once
const TRIM = MDX.nFft / 2; // each chunk's edges, thrown away (the model is unsure there)
const GEN = CHUNK - 2 * TRIM; // new samples each chunk adds

// An in-place radix-2 FFT (inverse with sign = 1, unscaled).
function fft2(re, im, sign = -1) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// A DFT of any length n (Bluestein: a convolution done with power-of-two FFTs). Returns a function
// transforming (re, im) of length n in place; inverse = true for the unscaled inverse.
export function dft(n, inverse = false) {
  let m = 1;
  while (m < 2 * n - 1) m <<= 1;
  const sign = inverse ? 1 : -1;
  const wr = new Float64Array(n), wi = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = (sign * Math.PI * ((k * k) % (2 * n))) / n;
    wr[k] = Math.cos(a); wi[k] = Math.sin(a);
  }
  const br = new Float64Array(m), bi = new Float64Array(m);
  br[0] = wr[0]; bi[0] = -wi[0];
  for (let k = 1; k < n; k++) { br[k] = br[m - k] = wr[k]; bi[k] = bi[m - k] = -wi[k]; }
  fft2(br, bi);
  const ar = new Float64Array(m), ai = new Float64Array(m);
  return (re, im) => {
    ar.fill(0); ai.fill(0);
    for (let k = 0; k < n; k++) { ar[k] = re[k] * wr[k] - im[k] * wi[k]; ai[k] = re[k] * wi[k] + im[k] * wr[k]; }
    fft2(ar, ai);
    for (let k = 0; k < m; k++) { const r = ar[k] * br[k] - ai[k] * bi[k]; ai[k] = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r; }
    fft2(ar, ai, 1);
    for (let k = 0; k < n; k++) {
      const r = ar[k] / m, i = ai[k] / m;
      re[k] = r * wr[k] - i * wi[k]; im[k] = r * wi[k] + i * wr[k];
    }
  };
}

const hann = (n) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
const reflect = (x, i) => { const n = x.length; while (i < 0 || i >= n) i = i < 0 ? -i : 2 * (n - 1) - i; return x[i]; };

// One chunk (two channels of CHUNK samples) as the model's input: [4, dimF, dimT] — left real,
// left imaginary, right real, right imaginary — as torch.stft(center=True) would give.
export function chunkSpectrum(left, right, tools) {
  const { nFft, hop, dimF, dimT } = MDX, { fwd, win } = tools;
  const out = new Float32Array(4 * dimF * dimT), re = new Float64Array(nFft), im = new Float64Array(nFft);
  for (let t = 0; t < dimT; t++) {
    const start = t * hop - nFft / 2;
    for (let j = 0; j < nFft; j++) { re[j] = reflect(left, start + j) * win[j]; im[j] = reflect(right, start + j) * win[j]; }
    fwd(re, im); // both channels at once: left in the real part, right in the imaginary
    for (let f = 0; f < dimF; f++) {
      const g = f ? nFft - f : 0;
      // Separate the two channels' spectra: L = (Z[f] + conj Z[-f]) / 2, R = (Z[f] - conj Z[-f]) / 2i.
      const lr = (re[f] + re[g]) / 2, li = (im[f] - im[g]) / 2, rr = (im[f] + im[g]) / 2, ri = (re[g] - re[f]) / 2;
      const at = f * dimT + t;
      out[at] = lr; out[dimF * dimT + at] = li; out[2 * dimF * dimT + at] = rr; out[3 * dimF * dimT + at] = ri;
    }
  }
  return out;
}

// The model's output spectrum back to two channels of CHUNK samples (torch.istft, center=True).
export function chunkSound(spec, tools) {
  const { nFft, hop, dimF, dimT } = MDX, { inv, win } = tools;
  const len = hop * (dimT - 1), padded = len + nFft;
  const L = new Float64Array(padded), R = new Float64Array(padded), norm = new Float64Array(padded);
  const re = new Float64Array(nFft), im = new Float64Array(nFft);
  for (let t = 0; t < dimT; t++) {
    re.fill(0); im.fill(0);
    // Z = L + iR, each made whole again from its first half (bins past dimF are silent).
    for (let f = 0; f < dimF; f++) {
      const at = f * dimT + t;
      const lr = spec[at], li = spec[dimF * dimT + at], rr = spec[2 * dimF * dimT + at], ri = spec[3 * dimF * dimT + at];
      re[f] += lr - ri; im[f] += li + rr;
      if (f) { const g = nFft - f; re[g] += lr + ri; im[g] += rr - li; }
    }
    inv(re, im);
    const start = t * hop;
    for (let j = 0; j < nFft; j++) {
      L[start + j] += (re[j] / nFft) * win[j]; R[start + j] += (im[j] / nFft) * win[j];
      norm[start + j] += win[j] * win[j];
    }
  }
  const outL = new Float32Array(len), outR = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const k = i + nFft / 2, w = norm[k] > 1e-8 ? norm[k] : 1;
    outL[i] = L[k] / w; outR[i] = R[k] / w;
  }
  return [outL, outR];
}

export const tools = () => ({ fwd: dft(MDX.nFft), inv: dft(MDX.nFft, true), win: hann(MDX.nFft) });

// The whole song (two channels at MDX.rate) through the model. run(Float32Array [4·dimF·dimT]) →
// Promise<Float32Array> of the same size. onProgress(0..1) as it goes. Returns {vocals, music}, each
// two channels as long as the song.
export async function separate(left, right, run, onProgress = () => {}) {
  const n = left.length, pad = GEN - (n % GEN);
  const total = TRIM + n + pad + TRIM;
  const mixL = new Float32Array(total), mixR = new Float32Array(total);
  mixL.set(left, TRIM); mixR.set(right, TRIM);
  const vocL = new Float32Array(n), vocR = new Float32Array(n), t = tools();
  const chunks = Math.ceil((n + pad) / GEN);
  for (let c = 0; c < chunks; c++) {
    const i = c * GEN;
    const spec = chunkSpectrum(mixL.subarray(i, i + CHUNK), mixR.subarray(i, i + CHUNK), t);
    const [l, r] = chunkSound(await run(spec), t);
    for (let k = TRIM; k < CHUNK - TRIM; k++) {
      const at = i + k - TRIM;
      if (at >= n) break;
      vocL[at] = l[k] * MDX.compensate; vocR[at] = r[k] * MDX.compensate;
    }
    onProgress((c + 1) / chunks);
  }
  const musL = Float32Array.from(left, (v, i) => v - vocL[i]), musR = Float32Array.from(right, (v, i) => v - vocR[i]);
  return { vocals: [vocL, vocR], music: [musL, musR] };
}
