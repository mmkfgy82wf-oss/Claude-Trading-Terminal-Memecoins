"use client";

/**
 * Tiny Web-Audio stingers for the desk chrome. Off until the operator arms
 * them — AudioContext needs a gesture, and a trading screen that beeps
 * uninvited is a nuisance, not a feature.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, duration: number, type: OscillatorType, gain = 0.035, slideTo?: number) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + duration);
  g.gain.setValueAtTime(gain, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
  osc.connect(g).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + duration + 0.02);
}

export type DeskSound = "buy" | "sell" | "win" | "loss" | "ui";

export function playDeskSound(kind: DeskSound) {
  switch (kind) {
    case "buy":
      tone(880, 0.09, "sine", 0.03);
      break;
    case "sell":
      tone(520, 0.1, "triangle", 0.028);
      break;
    case "win":
      tone(523, 0.08, "sine", 0.03);
      setTimeout(() => tone(784, 0.14, "sine", 0.032), 70);
      break;
    case "loss":
      tone(220, 0.18, "sawtooth", 0.02, 90);
      break;
    case "ui":
      tone(660, 0.05, "sine", 0.02);
      break;
  }
}

export function armAudio() {
  audio();
}
