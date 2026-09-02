"use client";

import { useCallback, useEffect, useState } from "react";

export type GameSoundEffect = "click" | "login" | "spin" | "win" | "lose";

export function useGameAudio(bgmEnabled: boolean) {
  const [engine] = useState(() => new GameAudioEngine());
  const [muted, setMuted] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("gameverse-muted") === "true");

  useEffect(() => {
    engine.setMuted(muted);
    window.localStorage.setItem("gameverse-muted", String(muted));
  }, [engine, muted]);

  useEffect(() => {
    if (bgmEnabled) engine.startBgm(); else engine.stopBgm();
    return () => engine.stopBgm();
  }, [bgmEnabled, engine]);

  useEffect(() => {
    const unlock = () => { void engine.unlock().catch(() => undefined); };
    const visibility = () => { if (document.hidden) void engine.suspend(); else void engine.unlock().catch(() => undefined); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
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
  private bgm: GainNode | null = null;
  private effects: GainNode | null = null;
  private bgmTimer: number | null = null;
  private bgmStep = 0;
  private wantsBgm = false;
  private muted = false;

  public async unlock(): Promise<void> {
    const context = this.ensureContext();
    if (context.state === "suspended") await context.resume().catch(() => undefined);
    if (this.wantsBgm) this.beginBgm();
  }

  public async suspend(): Promise<void> { if (this.context?.state === "running") await this.context.suspend().catch(() => undefined); }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master !== null && this.context !== null) this.master.gain.setTargetAtTime(muted ? 0 : 0.72, this.context.currentTime, 0.025);
  }

  public startBgm(): void { this.wantsBgm = true; if (this.context?.state === "running") this.beginBgm(); }
  public stopBgm(): void { this.wantsBgm = false; if (this.bgmTimer !== null) { window.clearInterval(this.bgmTimer); this.bgmTimer = null; } }

  public play(effect: GameSoundEffect): void {
    void this.unlock().then(() => {
      if (this.context === null || this.effects === null || this.muted) return;
      const now = this.context.currentTime;
      const effects = this.effects;
      if (effect === "click") this.tone(520, 720, now, 0.07, "sine", 0.075, effects);
      if (effect === "login") [392, 523, 659].forEach((frequency, index) => this.tone(frequency, frequency * 1.03, now + index * 0.09, 0.18, "triangle", 0.1, effects));
      if (effect === "spin") { this.noise(now, 0.22, 0.065); this.tone(230, 690, now, 0.3, "sawtooth", 0.055, effects); }
      if (effect === "win") [523, 659, 784, 1047].forEach((frequency, index) => this.tone(frequency, frequency * 1.04, now + index * 0.1, 0.28, "triangle", 0.13, effects));
      if (effect === "lose") this.tone(190, 105, now, 0.34, "sine", 0.09, effects);
    }).catch(() => undefined);
  }

  public dispose(): void { this.stopBgm(); if (this.context !== null) void this.context.close(); this.context = null; }

  private ensureContext(): AudioContext {
    if (this.context !== null) return this.context;
    const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextConstructor === undefined) throw new Error("Web Audio is not supported");
    this.context = new AudioContextConstructor();
    this.master = this.context.createGain(); this.master.gain.value = this.muted ? 0 : 0.72; this.master.connect(this.context.destination);
    this.bgm = this.context.createGain(); this.bgm.gain.value = 0.12; this.bgm.connect(this.master);
    this.effects = this.context.createGain(); this.effects.gain.value = 0.5; this.effects.connect(this.master);
    return this.context;
  }

  private beginBgm(): void {
    if (this.bgmTimer !== null || this.context === null || this.bgm === null) return;
    const playStep = () => {
      if (this.context === null || this.bgm === null || this.context.state !== "running") return;
      const notes = [130.81, 155.56, 196, 233.08, 196, 155.56, 146.83, 174.61];
      const root = notes[this.bgmStep % notes.length] ?? 130.81; this.bgmStep += 1;
      const now = this.context.currentTime;
      this.tone(root, root, now, 0.72, "sine", 0.06, this.bgm);
      this.tone(root * 2, root * 2.01, now + 0.04, 0.26, "triangle", 0.035, this.bgm);
      if (this.bgmStep % 4 === 0) this.tone(root * 3, root * 2.7, now + 0.28, 0.2, "sine", 0.025, this.bgm);
    };
    playStep(); this.bgmTimer = window.setInterval(playStep, 760);
  }

  private tone(startFrequency: number, endFrequency: number, start: number, duration: number, type: OscillatorType, volume: number, destination: AudioNode): void {
    if (this.context === null) return;
    const oscillator = this.context.createOscillator(); const gain = this.context.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(startFrequency, start); oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
    gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(volume, start + 0.012); gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain); gain.connect(destination); oscillator.start(start); oscillator.stop(start + duration + 0.02);
  }

  private noise(start: number, duration: number, volume: number): void {
    if (this.context === null || this.effects === null) return;
    const frameCount = Math.max(1, Math.floor(this.context.sampleRate * duration)); const buffer = this.context.createBuffer(1, frameCount, this.context.sampleRate); const data = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) data[index] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource(); const gain = this.context.createGain(); source.buffer = buffer;
    gain.gain.setValueAtTime(volume, start); gain.gain.exponentialRampToValueAtTime(0.0001, start + duration); source.connect(gain); gain.connect(this.effects); source.start(start); source.stop(start + duration);
  }
}
