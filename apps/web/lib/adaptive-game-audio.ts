"use client";

import { useCallback, useEffect, useState } from "react";

export type GameMusicScene = "off" | "lobby" | "neon-reels" | "neon-mines";
export type GameSoundEffect = "click" | "login" | "reel-spin" | "reel-win" | "reel-lose" | "mine-pick" | "mine-hit" | "cash-out";

export function useGameAudio(scene: GameMusicScene) {
  const [engine] = useState(() => new GameAudioEngine());
  const [muted, setMuted] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("gameverse-muted") === "true");

  useEffect(() => {
    engine.setMuted(muted);
    window.localStorage.setItem("gameverse-muted", String(muted));
  }, [engine, muted]);

  useEffect(() => {
    engine.setScene(scene);
    return () => engine.setScene("off");
  }, [engine, scene]);

  useEffect(() => {
    const unlock = (event: Event) => { if (event.isTrusted) void engine.unlock().catch(() => undefined); };
    const visibility = () => { if (document.hidden) void engine.suspend(); };
    // Keep these listeners installed: a browser can reject an early resume, and the
    // next real gesture must always get another chance to unlock or resume audio.
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("click", unlock, { capture: true });
    window.addEventListener("touchend", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("click", unlock, true);
      window.removeEventListener("touchend", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      document.removeEventListener("visibilitychange", visibility);
      engine.dispose();
    };
  }, [engine]);

  const play = useCallback((effect: GameSoundEffect) => engine.play(effect), [engine]);
  const toggleMuted = useCallback(() => {
    const next = !muted;
    engine.setMuted(next);
    setMuted(next);
    if (!next) engine.play("click");
  }, [engine, muted]);

  return { muted, play, toggleMuted } as const;
}

class GameAudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private effects: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private scene: GameMusicScene = "off";
  private muted = false;

  public async unlock(): Promise<void> {
    const context = this.ensureContext();
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") throw new Error("Audio context is not running");
    if (this.scene !== "off") this.beginMusic();
  }

  public async suspend(): Promise<void> {
    if (this.context?.state === "running") await this.context.suspend().catch(() => undefined);
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master !== null && this.context !== null) this.master.gain.setTargetAtTime(muted ? 0 : 0.68, this.context.currentTime, 0.04);
  }

  public setScene(scene: GameMusicScene): void {
    if (scene === this.scene) return;
    this.stopMusic();
    this.scene = scene;
    this.musicStep = 0;
    if (this.context !== null && this.music !== null) {
      const now = this.context.currentTime;
      this.music.gain.cancelScheduledValues(now);
      this.music.gain.setTargetAtTime(sceneVolume(scene), now, 0.35);
    }
    if (scene !== "off" && this.context?.state === "running") this.beginMusic();
  }

  public play(effect: GameSoundEffect): void {
    if (this.context?.state !== "running" && navigator.userActivation?.isActive !== true) return;
    void this.unlock().then(() => {
      if (this.context === null || this.context.state !== "running" || this.effects === null || this.muted) return;
      const now = this.context.currentTime;
      const output = this.effects;
      if (effect === "click") {
        this.tone(740, 980, now, 0.085, "sine", 0.055, output, 0.008);
        this.tone(1_480, 1_180, now + 0.018, 0.09, "triangle", 0.022, output, 0.006);
      }
      if (effect === "login") {
        [261.63, 329.63, 392, 493.88].forEach((frequency, index) => this.tone(frequency, frequency * 1.01, now + index * 0.075, 0.42, "triangle", 0.065, output, 0.025));
        this.tone(784, 1_046.5, now + 0.3, 0.5, "sine", 0.045, output, 0.04);
      }
      if (effect === "reel-spin") {
        this.filteredNoise(now, 0.55, 0.055, output, 1_900);
        [196, 246.94, 293.66, 392].forEach((frequency, index) => this.tone(frequency, frequency * 1.4, now + index * 0.075, 0.2, "square", 0.026, output, 0.008));
        this.tone(110, 440, now, 0.52, "sawtooth", 0.035, output, 0.02);
      }
      if (effect === "reel-win") {
        [523.25, 659.25, 783.99, 987.77, 1_046.5].forEach((frequency, index) => this.tone(frequency, frequency * 1.015, now + index * 0.085, 0.38, "triangle", 0.085, output, 0.018));
        this.tone(261.63, 523.25, now, 0.76, "sine", 0.07, output, 0.045);
      }
      if (effect === "reel-lose") {
        this.tone(293.66, 246.94, now, 0.24, "triangle", 0.05, output, 0.025);
        this.tone(220, 196, now + 0.15, 0.32, "sine", 0.045, output, 0.03);
      }
      if (effect === "mine-pick") {
        this.tone(880, 1_320, now, 0.14, "sine", 0.055, output, 0.006);
        this.tone(440, 660, now + 0.025, 0.2, "triangle", 0.038, output, 0.01);
      }
      if (effect === "mine-hit") {
        this.filteredNoise(now, 0.62, 0.11, output, 520);
        this.tone(92, 42, now, 0.7, "sawtooth", 0.105, output, 0.008);
        this.tone(174.61, 110, now + 0.08, 0.55, "sine", 0.06, output, 0.02);
      }
      if (effect === "cash-out") {
        [392, 493.88, 587.33, 783.99].forEach((frequency, index) => this.tone(frequency, frequency * 1.015, now + index * 0.09, 0.42, "sine", 0.072, output, 0.018));
        this.tone(196, 392, now, 0.68, "triangle", 0.048, output, 0.04);
      }
    }).catch(() => undefined);
  }

  public dispose(): void {
    this.stopMusic();
    if (this.context !== null) void this.context.close();
    this.context = null;
  }

  private ensureContext(): AudioContext {
    if (this.context !== null) return this.context;
    const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextConstructor === undefined) throw new Error("Web Audio is not supported");
    this.context = new AudioContextConstructor();
    this.master = this.context.createGain(); this.master.gain.value = this.muted ? 0 : 0.68; this.master.connect(this.context.destination);
    this.music = this.context.createGain(); this.music.gain.value = sceneVolume(this.scene); this.music.connect(this.master);
    this.effects = this.context.createGain(); this.effects.gain.value = 0.62; this.effects.connect(this.master);
    return this.context;
  }

  private beginMusic(): void {
    if (this.musicTimer !== null || this.context === null || this.music === null || this.scene === "off") return;
    const interval = sceneInterval(this.scene);
    const playStep = () => {
      if (this.context === null || this.music === null || this.context.state !== "running" || this.scene === "off") return;
      const now = this.context.currentTime;
      if (this.scene === "lobby") this.playLobbyStep(now, this.musicStep);
      if (this.scene === "neon-reels") this.playReelsStep(now, this.musicStep);
      if (this.scene === "neon-mines") this.playMinesStep(now, this.musicStep);
      this.musicStep += 1;
    };
    playStep();
    this.musicTimer = window.setInterval(playStep, interval);
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private playLobbyStep(now: number, step: number): void {
    if (this.music === null) return;
    const chords = [
      [130.81, 164.81, 196, 246.94],
      [110, 130.81, 164.81, 196],
      [87.31, 130.81, 164.81, 196],
      [98, 146.83, 196, 220]
    ] as const;
    const chord = chords[Math.floor(step / 4) % chords.length] ?? chords[0];
    if (step % 4 === 0) chord.forEach((frequency, index) => this.tone(frequency, frequency * 1.003, now + index * 0.035, 3.5, "sine", index === 0 ? 0.032 : 0.02, this.music!, 0.55));
    const melody = [392, 493.88, 523.25, 493.88, 329.63, 392, 440, 392, 349.23, 440, 493.88, 440, 293.66, 392, 440, 392];
    const note = melody[step % melody.length] ?? 392;
    this.tone(note, note * 1.002, now + 0.08, 0.75, "sine", 0.026, this.music, 0.12);
    if (step % 2 === 1) this.tone(note * 2, note * 1.99, now + 0.38, 0.42, "triangle", 0.012, this.music, 0.035);
  }

  private playReelsStep(now: number, step: number): void {
    if (this.music === null) return;
    const roots = [98, 98, 130.81, 146.83, 98, 98, 164.81, 146.83];
    const root = roots[step % roots.length] ?? 98;
    this.tone(root, root * 0.998, now, 0.4, "sawtooth", 0.034, this.music, 0.012);
    const arpeggio = [1, 1.25, 1.5, 2, 1.5, 1.25, 1.875, 2];
    const high = root * (arpeggio[step % arpeggio.length] ?? 1) * 2;
    this.tone(high, high * 1.01, now + 0.035, 0.3, "square", 0.018, this.music, 0.008);
    this.tone(high * 2, high * 1.98, now + 0.09, 0.22, "sine", 0.018, this.music, 0.008);
    if (step % 4 === 0) this.filteredNoise(now, 0.075, 0.018, this.music, 180);
    if (step % 8 === 6) this.tone(783.99, 1_046.5, now + 0.15, 0.32, "triangle", 0.022, this.music, 0.01);
  }

  private playMinesStep(now: number, step: number): void {
    if (this.music === null) return;
    const roots = [73.42, 73.42, 87.31, 65.41, 73.42, 98, 87.31, 65.41];
    const root = roots[Math.floor(step / 2) % roots.length] ?? 73.42;
    this.tone(root, root * 0.995, now, 1.15, "sine", 0.045, this.music, 0.18);
    const gems = [293.66, 349.23, 440, 523.25, 440, 349.23, 329.63, 392];
    const gem = gems[step % gems.length] ?? 293.66;
    this.tone(gem, gem * 1.006, now + 0.12, 0.52, "triangle", 0.024, this.music, 0.025);
    if (step % 2 === 0) this.tone(gem * 2, gem * 2.01, now + 0.32, 0.3, "sine", 0.014, this.music, 0.015);
    if (step % 4 === 3) this.filteredNoise(now + 0.18, 0.32, 0.012, this.music, 900);
  }

  private tone(startFrequency: number, endFrequency: number, start: number, duration: number, type: OscillatorType, volume: number, destination: AudioNode, attack = 0.012): void {
    if (this.context === null) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(attack, duration / 2));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain); gain.connect(destination); oscillator.start(start); oscillator.stop(start + duration + 0.03);
  }

  private filteredNoise(start: number, duration: number, volume: number, destination: AudioNode, cutoff: number): void {
    if (this.context === null) return;
    const frameCount = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, frameCount, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) data[index] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer; filter.type = "lowpass"; filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, start); gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter); filter.connect(gain); gain.connect(destination); source.start(start); source.stop(start + duration);
  }
}

function sceneInterval(scene: Exclude<GameMusicScene, "off">): number {
  return scene === "lobby" ? 860 : scene === "neon-reels" ? 430 : 680;
}

function sceneVolume(scene: GameMusicScene): number {
  return scene === "off" ? 0 : scene === "neon-reels" ? 0.28 : scene === "neon-mines" ? 0.32 : 0.35;
}
