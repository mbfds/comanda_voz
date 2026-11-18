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

export interface AcousticCaptureResult extends AcousticSample {
  framesCaptured: number;
  maxRms: number;
}

export function isInsideEmbeddedIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function describeVoiceCaptureError(err: unknown): string {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'O microfone exige conexão segura (HTTPS) ou localhost. Acesse o sistema via HTTPS para capturar a voz.';
  }

  const domErr = err as { name?: string; message?: string } | null;
  const name = domErr?.name || '';
  const message = (domErr?.message || '').toLowerCase();
  const inIframe = isInsideEmbeddedIframe();

  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    name === 'SecurityError' ||
    message.includes('permission') ||
    message.includes('not allowed') ||
    message.includes('denied')
  ) {
    if (inIframe) {
      return 'Permissão de microfone bloqueada dentro desta janela incorporada (iframe). Clique em "Abrir em Nova Aba" ou libere o microfone no cadeado do navegador.';
    }
    return 'Permissão de microfone negada. Clique no ícone de cadeado na barra de endereço do navegador e permita o uso do microfone.';
  }

  if (
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError' ||
    message.includes('requested device not found')
  ) {
    return 'Nenhum microfone encontrado. Verifique se o fone Bluetooth ou microfone está conectado e selecionado.';
  }

  if (
    name === 'NotReadableError' ||
    name === 'TrackStartError' ||
    message.includes('could not start audio source') ||
    message.includes('device in use')
  ) {
    return 'O microfone está ocupado ou travado por outro app/chamada/aba. Feche outros apps que usam áudio ou reconecte o fone Bluetooth.';
  }

  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'O dispositivo de microfone selecionado não suportou os parâmetros de áudio. Selecione "Microfone Padrão / Automático" e tente novamente.';
  }

  if (name === 'AbortError') {
    return 'A captura de áudio foi interrompida pelo sistema operacional. Tente novamente.';
  }

  if (err instanceof Error && err.message.trim()) {
    return `Erro ao acessar o microfone: ${err.message}`;
  }

  return 'Não foi possível capturar o áudio do microfone. Verifique a conexão e a permissão do navegador.';
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

function computeRms(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / Math.max(buffer.length, 1));
}

/**
 * Estimates fundamental frequency (pitch in Hz) from time-domain PCM float buffer via autocorrelation
 */
function estimatePitchHz(buffer: Float32Array, sampleRate: number): number | null {
  const rms = computeRms(buffer);
  if (rms < 0.0025) return null; // Silence / dead mic

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

  if (totalMagnitude < 80) return null;
  return weightedSum / totalMagnitude;
}

function buildConstraintCandidates(deviceId?: string): MediaStreamConstraints[] {
  const candidates: MediaStreamConstraints[] = [];
  if (deviceId && deviceId !== 'default') {
    candidates.push({
      audio: {
        deviceId: { ideal: deviceId },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    candidates.push({
      audio: {
        deviceId: { ideal: deviceId },
      },
    });
  }
  candidates.push({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  candidates.push({ audio: true });
  return candidates;
}

async function acquireMicrophoneStream(deviceId?: string): Promise<MediaStream> {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    throw new Error('Contexto inseguro (HTTP): microfone requer HTTPS ou localhost.');
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Seu navegador não disponibilizou a API de microfone (getUserMedia).');
  }

  const candidates = buildConstraintCandidates(deviceId);
  let lastError: unknown = null;

  for (const constraints of candidates) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      const errName = (err as { name?: string } | null)?.name || '';
      // If permission was explicitly denied by user/policy, don't loop further
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError' || errName === 'SecurityError') {
        throw err;
      }
    }
  }

  throw lastError || new Error('Falha ao abrir o microfone.');
}

async function createResumedAudioContext(): Promise<AudioContext> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('AudioContext não suportado neste navegador.');
  }
  const audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Captures a short acoustic voice print from the microphone (built-in or Bluetooth) over a given duration
 */
export async function captureVoiceBiometricSample(
  durationMs = 2400,
  deviceId?: string
): Promise<AcousticCaptureResult> {
  const stream = await acquireMicrophoneStream(deviceId);
  let audioCtx: AudioContext | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  try {
    audioCtx = await createResumedAudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const timeBuffer = new Float32Array(analyser.fftSize);
    const freqBuffer = new Uint8Array(analyser.frequencyBinCount);

    const pitches: number[] = [];
    const centroids: number[] = [];
    let energyFrames = 0;
    let maxRms = 0;

    const start = Date.now();
    await new Promise<void>((resolve) => {
      intervalId = setInterval(() => {
        if (!audioCtx) return;
        analyser.getFloatTimeDomainData(timeBuffer);
        analyser.getByteFrequencyData(freqBuffer);

        const rms = computeRms(timeBuffer);
        if (rms > maxRms) maxRms = rms;
        if (rms >= 0.0025) energyFrames += 1;

        const p = estimatePitchHz(timeBuffer, audioCtx.sampleRate);
        const c = estimateSpectralCentroid(freqBuffer, audioCtx.sampleRate, analyser.fftSize);
        if (p !== null) pitches.push(p);
        if (c !== null) centroids.push(c);

        if (Date.now() - start >= durationMs) {
          if (intervalId) clearInterval(intervalId);
          intervalId = null;
          resolve();
        }
      }, 55);
    });

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
      framesCaptured: Math.max(pitches.length, energyFrames),
      maxRms: Number(maxRms.toFixed(4)),
    };
  } finally {
    if (intervalId) clearInterval(intervalId);
    stream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        // ignore
      }
    });
    if (audioCtx) {
      await audioCtx.close().catch(() => {});
    }
  }
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

  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  try {
    stream = await acquireMicrophoneStream(deviceId);
    audioCtx = await createResumedAudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const timeBuffer = new Float32Array(analyser.fftSize);
    const freqBuffer = new Uint8Array(analyser.frequencyBinCount);

    const recentPitches: number[] = [];
    const recentCentroids: number[] = [];
    let stopped = false;

    const interval = setInterval(() => {
      if (stopped || !audioCtx) return;
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
        stopped = true;
        clearInterval(interval);
        stream?.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            // ignore
          }
        });
        audioCtx?.close().catch(() => {});
      },
    };
  } catch {
    stream?.getTracks().forEach((t) => t.stop());
    audioCtx?.close().catch(() => {});
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
