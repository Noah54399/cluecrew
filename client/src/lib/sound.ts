import { getSoundEnabled, setSoundEnabled } from './storage';

export type SoundName =
  | 'click'
  | 'join'
  | 'start'
  | 'tick'
  | 'lock'
  | 'reveal'
  | 'correct'
  | 'wrong'
  | 'victory'
  | 'pause';

/**
 * Tiny WebAudio synth — no audio assets, only generated tones.
 * Must be resumed after a user gesture (handled on first interaction).
 */
class SoundEngine {
  private context: AudioContext | null = null;
  private enabled = getSoundEnabled();
  private unlocked = false;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    setSoundEnabled(enabled);
    if (enabled) this.ensureContext();
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    if (this.enabled) {
      this.play('click');
    }
    return this.enabled;
  }

  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.ensureContext();
  }

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.context) {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        this.context = new Ctor();
      } catch {
        return null;
      }
    }
    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => undefined);
    }
    return this.context;
  }

  private tone(
    frequency: number,
    durationMs: number,
    options: { type?: OscillatorType; gain?: number; delayMs?: number; slideTo?: number } = {},
  ): void {
    const context = this.ensureContext();
    if (!context) return;
    const start = context.currentTime + (options.delayMs ?? 0) / 1000;
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = options.type ?? 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    if (options.slideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(options.slideTo, start + durationMs / 1000);
    }
    const peak = options.gain ?? 0.08;
    gainNode.gain.setValueAtTime(0.0001, start);
    gainNode.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
    oscillator.connect(gainNode).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + durationMs / 1000 + 0.02);
  }

  play(name: SoundName): void {
    if (!this.enabled) return;
    switch (name) {
      case 'click':
        this.tone(520, 70, { type: 'triangle', gain: 0.05 });
        break;
      case 'join':
        this.tone(660, 90, { type: 'sine' });
        this.tone(990, 110, { type: 'sine', delayMs: 80 });
        break;
      case 'start':
        this.tone(440, 110, { type: 'triangle' });
        this.tone(554, 110, { type: 'triangle', delayMs: 100 });
        this.tone(659, 160, { type: 'triangle', delayMs: 200 });
        break;
      case 'tick':
        this.tone(880, 55, { type: 'square', gain: 0.035 });
        break;
      case 'lock':
        this.tone(300, 140, { type: 'sawtooth', gain: 0.06, slideTo: 200 });
        break;
      case 'reveal':
        this.tone(392, 150, { type: 'triangle' });
        this.tone(523, 150, { type: 'triangle', delayMs: 120 });
        this.tone(659, 220, { type: 'triangle', delayMs: 240 });
        break;
      case 'correct':
        this.tone(660, 120, { type: 'sine' });
        this.tone(990, 180, { type: 'sine', delayMs: 110 });
        break;
      case 'wrong':
        this.tone(220, 200, { type: 'sawtooth', gain: 0.05, slideTo: 140 });
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((frequency, index) => {
          this.tone(frequency, 220, { type: 'triangle', delayMs: index * 130 });
        });
        break;
      case 'pause':
        this.tone(440, 100, { type: 'sine', slideTo: 330 });
        break;
    }
  }
}

export const sounds = new SoundEngine();
