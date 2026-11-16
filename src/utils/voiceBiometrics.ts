import { VoiceOperator } from '../types';

export interface AcousticSample {
  pitchHz: number;
  spectralCentroid: number;
}

/**
 * Speaks a message out loud using the browser's Portuguese SpeechSynthesis engine (Voice of "Marcelo")
 */
export function speakAsMarcelo(text: string, enabled = true) {
  if (!enabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.08;
    utterance.pitch = 0.95;

    const voices = window.speechSynthesis.getVoices();
    const ptVoice =
      voices.find((v) => v.lang.toLowerCase().includes('pt-br') && v.name.toLowerCase().includes('male')) ||
      voices.find((v) => v.lang.toLowerCase().includes('pt-br')) ||
      voices.find((v) => v.lang.toLowerCase().startsWith('pt'));

    if (ptVoice) {
      utterance.voice = ptVoice;
    }
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore speech synthesis errors on restricted browsers
  }
}

/**
 * Estimates fundamental frequency (pitch in Hz) from time-domain PCM float buffer via autocorrelation
 */
function estimatePitchHz(buffer: Float32Array, sampleRate: number): number | null {
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.015) return null; // Too quiet / silence

  const minFreq = 70;
  const maxFreq = 400;
  const minLag = Math.floor(sampleRate / maxFreq);
  const maxLag = Math.min(Math.floor(sampleRate / minFreq), Math.floor(buffer.length / 2));

  let bestCorrelation = 0;
  let bestLag = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < buffer.length - lag; i++) {
      sum += buffer[i] * buffer[i + lag];
    }
    if (sum > bestCorrelation) {
      bestCorrelation = sum;
      bestLag = lag;
    }
  }

  if (bestLag <= 0) return null;
  const pitch = sampleRate / bestLag;
  if (pitch < 65 || pitch > 450) return null;
  return pitch;
}

/**
 * Estimates spectral centroid (timbre brightness in Hz) from FFT frequency bins
 */
function estimateSpectralCentroid(
  freqData: Uint8Array,
  sampleRate: number,
  fftSize: number
): number | null {
  let weightedSum = 0;
  let totalMagnitude = 0;
  const binWidth = sampleRate / fftSize;

  for (let i = 1; i < freqData.length; i++) {
    const mag = freqData[i];
    const freq = i * binWidth;
    if (freq > 4500) break;
    weightedSum += freq * mag;
    totalMagnitude += mag;
  }

  if (totalMagnitude < 500) return null;
  return weightedSum / totalMagnitude;
}

/**
 * Captures a short acoustic voice print from the microphone over a given duration (e.g. 2200ms)
 */
export async function captureVoiceBiometricSample(durationMs = 2200): Promise<AcousticSample> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { pitchHz: 135, spectralCentroid: 1420 };
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const timeBuffer = new Float32Array(analyser.fftSize);
  const freqBuffer = new Uint8Array(analyser.frequencyBinCount);

  const pitches: number[] = [];
  const centroids: number[] = [];

  const start = Date.now();
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      analyser.getFloatTimeDomainData(timeBuffer);
      analyser.getByteFrequencyData(freqBuffer);

      const p = estimatePitchHz(timeBuffer, audioCtx.sampleRate);
      const c = estimateSpectralCentroid(freqBuffer, audioCtx.sampleRate, analyser.fftSize);
      if (p !== null) pitches.push(p);
      if (c !== null) centroids.push(c);

      if (Date.now() - start >= durationMs) {
        clearInterval(interval);
        resolve();
      }
    }, 60);
  });

  stream.getTracks().forEach((t) => t.stop());
  await audioCtx.close().catch(() => {});

  const avgPitch =
    pitches.length > 0
      ? pitches.reduce((a, b) => a + b, 0) / pitches.length
      : 138;
  const avgCentroid =
    centroids.length > 0
      ? centroids.reduce((a, b) => a + b, 0) / centroids.length
      : 1450;

  return {
    pitchHz: Math.min(Math.max(Number(avgPitch.toFixed(1)), 50), 500),
    spectralCentroid: Math.min(Math.max(Number(avgCentroid.toFixed(1)), 200), 8000),
  };
}

/**
 * Compares a live acoustic sample against registered VoiceOperators.
 * Returns the best matching operator and a similarity score (0..100).
 */
export function matchSpeakerAgainstOperators(
  sample: AcousticSample,
  operators: VoiceOperator[]
): { matchedOperator: VoiceOperator | null; confidence: number } {
  if (operators.length === 0) {
    return { matchedOperator: null, confidence: 100 };
  }

  let bestOp: VoiceOperator | null = null;
  let bestConfidence = 0;

  for (const op of operators) {
    const pitchDiffRatio = Math.abs(sample.pitchHz - op.pitchHz) / Math.max(op.pitchHz, 80);
    const centroidDiffRatio =
      Math.abs(sample.spectralCentroid - op.spectralCentroid) /
      Math.max(op.spectralCentroid, 500);

    // Weighted acoustic distance
    const combinedDiff = pitchDiffRatio * 0.65 + centroidDiffRatio * 0.35;
    const score = Math.max(0, Math.min(100, Math.round((1 - combinedDiff * 1.4) * 100)));

    if (score > bestConfidence) {
      bestConfidence = score;
      bestOp = op;
    }
  }

  return {
    matchedOperator: bestOp,
    confidence: bestConfidence,
  };
}
