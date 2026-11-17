import { VoiceOperator } from '../types';

export interface AcousticSample {
  pitchHz: number;
  spectralCentroid: number;
}

export interface AudioInputDeviceOption {
  deviceId: string;
  label: string;
  isBluetooth: boolean;
}

const BLUETOOTH_LABEL_REGEX =
  /\b(bluetooth|airpods|buds|galaxy\s*buds|redmi|qcy|jbl|sony|tws|headset|hands-free|handsfree|hfp|wireless|sem\s+fio|lapela|bt[\s_-]|earbuds|fone)\b/i;

/**
 * Lists available audio input (microphone) devices, flagging Bluetooth headsets/lapel mics.
 */
export async function listAudioInputDevices(
  requestPermissionFirst = false
): Promise<AudioInputDeviceOption[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }

  try {
    if (requestPermissionFirst && navigator.mediaDevices.getUserMedia) {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach((t) => t.stop());
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === 'audioinput');

    return audioInputs.map((d, idx) => {
      const cleanLabel =
        d.label?.trim() || (idx === 0 ? 'Microfone Padrão do Aparelho' : `Microfone #${idx + 1}`);
      return {
        deviceId: d.deviceId,
        label: cleanLabel,
        isBluetooth: BLUETOOTH_LABEL_REGEX.test(cleanLabel),
      };
    });
  } catch {
    return [];
  }
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
  if (rms < 0.012) return null; // Silence / low background noise

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

  if (totalMagnitude < 400) return null;
  return weightedSum / totalMagnitude;
}

function buildAudioConstraints(deviceId?: string): MediaStreamConstraints {
  if (deviceId && deviceId !== 'default') {
    return {
      audio: {
        deviceId: { ideal: deviceId },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    };
  }
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  };
}

/**
 * Captures a short acoustic voice print from the microphone (built-in or Bluetooth) over a given duration
 */
export async function captureVoiceBiometricSample(
  durationMs = 2400,
  deviceId?: string
): Promise<AcousticSample & { framesCaptured: number }> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { pitchHz: 138, spectralCentroid: 1520, framesCaptured: 10 };
  }

  const stream = await navigator.mediaDevices.getUserMedia(buildAudioConstraints(deviceId));
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    }, 55);
  });

  stream.getTracks().forEach((t) => t.stop());
  await audioCtx.close().catch(() => {});

  const sortedPitches = [...pitches].sort((a, b) => a - b);
  const trimmedPitches =
    sortedPitches.length >= 6
      ? sortedPitches.slice(1, sortedPitches.length - 1)
      : sortedPitches;

  const avgPitch =
    trimmedPitches.length > 0
      ? trimmedPitches.reduce((a, b) => a + b, 0) / trimmedPitches.length
      : 138;
  const avgCentroid =
    centroids.length > 0
      ? centroids.reduce((a, b) => a + b, 0) / centroids.length
      : 1520;

  return {
    pitchHz: Math.min(Math.max(Number(avgPitch.toFixed(1)), 50), 500),
    spectralCentroid: Math.min(Math.max(Number(avgCentroid.toFixed(1)), 200), 8000),
    framesCaptured: pitches.length,
  };
}

export interface LiveAcousticTracker {
  getRecentSample: () => AcousticSample | null;
  stop: () => void;
}

/**
 * Keeps the selected Bluetooth or built-in microphone active while in open-mic mode
 * and continuously tracks rolling voice pitch & spectral centroid for instant compatibility scoring.
 */
export async function startLiveAcousticTracker(
  deviceId?: string
): Promise<LiveAcousticTracker | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(buildAudioConstraints(deviceId));
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtx();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const timeBuffer = new Float32Array(analyser.fftSize);
    const freqBuffer = new Uint8Array(analyser.frequencyBinCount);

    const recentPitches: number[] = [];
    const recentCentroids: number[] = [];

    const interval = setInterval(() => {
      analyser.getFloatTimeDomainData(timeBuffer);
      analyser.getByteFrequencyData(freqBuffer);

      const p = estimatePitchHz(timeBuffer, audioCtx.sampleRate);
      const c = estimateSpectralCentroid(freqBuffer, audioCtx.sampleRate, analyser.fftSize);
      if (p !== null) {
        recentPitches.push(p);
        if (recentPitches.length > 35) recentPitches.shift();
      }
      if (c !== null) {
        recentCentroids.push(c);
        if (recentCentroids.length > 35) recentCentroids.shift();
      }
    }, 80);

    return {
      getRecentSample: () => {
        if (recentPitches.length === 0) return null;
        const avgP = recentPitches.reduce((a, b) => a + b, 0) / recentPitches.length;
        const avgC =
          recentCentroids.length > 0
            ? recentCentroids.reduce((a, b) => a + b, 0) / recentCentroids.length
            : 1550;
        return {
          pitchHz: Number(avgP.toFixed(1)),
          spectralCentroid: Number(avgC.toFixed(1)),
        };
      },
      stop: () => {
        clearInterval(interval);
        stream.getTracks().forEach((t) => t.stop());
        audioCtx.close().catch(() => {});
      },
    };
  } catch {
    return null;
  }
}

/**
 * Computes compatibility percentage (0..100%) between an acoustic sample and a single VoiceOperator.
 */
export function computeOperatorVoiceCompatibility(
  sample: AcousticSample,
  op: Pick<VoiceOperator, 'pitchHz' | 'spectralCentroid'>
): number {
  const opPitch = op.pitchHz > 0 ? op.pitchHz : 140;
  const opCentroid = op.spectralCentroid > 0 ? op.spectralCentroid : 1600;
  const pitchDiffRatio = Math.abs(sample.pitchHz - opPitch) / Math.max(opPitch, 85);
  const centroidDiffRatio =
    Math.abs(sample.spectralCentroid - opCentroid) / Math.max(opCentroid, 550);

  const combinedDiff = pitchDiffRatio * 0.65 + centroidDiffRatio * 0.35;
  return Math.max(0, Math.min(100, Math.round((1 - combinedDiff * 1.15) * 100)));
}

/**
 * Compares a live acoustic sample against registered VoiceOperators.
 * Returns the best matching operator and a compatibility score (0..100%).
 */
export function matchSpeakerAgainstOperators(
  sample: AcousticSample,
  operators: VoiceOperator[],
  preferredEmail?: string
): { matchedOperator: VoiceOperator | null; confidence: number } {
  if (operators.length === 0) {
    return { matchedOperator: null, confidence: 100 };
  }

  // If a specific waiter is logged in and has a calibrated voice profile, evaluate compatibility with them first
  if (preferredEmail) {
    const loggedOp = operators.find(
      (op) => (op.email || '').toLowerCase() === preferredEmail.toLowerCase()
    );
    if (loggedOp && loggedOp.samplesCount >= 1) {
      const loggedScore = computeOperatorVoiceCompatibility(sample, loggedOp);
      if (loggedScore >= 65) {
        return { matchedOperator: loggedOp, confidence: loggedScore };
      }
    }
  }

  let bestOp: VoiceOperator | null = null;
  let bestConfidence = 0;

  for (const op of operators) {
    const score = computeOperatorVoiceCompatibility(sample, op);
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
