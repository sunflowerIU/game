# Neon Dice — Section 6: adaptive music and sound

Section 6 adds an original procedural audio identity for Neon Dice. No external
recordings, downloads, or licensed music assets are used.

The Web Audio engine now provides:

- a dedicated `neon-dice` music scene with a restrained cosmic pulse, evolving
  bass foundation, orbiting melodic notes, and subtle percussive noise;
- a rising roll sound while the dice remain in motion;
- a physical two-dice landing impact;
- separate celebratory and losing result cues;
- temporary music ducking so important result effects remain clear;
- result sounds synchronized with the authoritative server result; and
- the existing persistent mute control, browser gesture unlock, hidden-tab
  suspension, and audio-context cleanup behavior.

Repeat-roll animation now runs continuously while settlement is pending and
stops only when the authoritative dice are ready. This prevents slow network
responses from revealing stale dice before the real result arrives.
