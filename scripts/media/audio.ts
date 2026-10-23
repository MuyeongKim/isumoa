// 홍보 영상의 배경음악과 효과음을 코드로 만든다. 외부 음원을 쓰지 않으므로 저작권 걱정 없이 기관에서 틀 수 있다.
//   배경음악: 라장조, 100 BPM. 부드러운 패드 → (올리기 장면부터) 드럼·베이스 → (대시보드에서) 더 밝게 → 끝 화면에서 으뜸화음으로 마무리
//   효과음: promo.html의 window.__cues(장면과 같은 시간 상수로 만든 목록)대로 넣는다
// 기관이 쓸 수 있는 음원이 따로 있으면 options.music(48kHz 스테레오 PCM)으로 배경음악만 바꾼다.

export const SR = 48000;

export interface Cue {
  t: number;
  type: string;
  pan: number;
  dur?: number;
  step?: number;
  soft?: boolean;
}

// ── 기본 도구 ──────────────────────────────────────────────

/** 같은 결과가 나오도록 씨앗이 정해진 난수 */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20261023);
const noise = () => random() * 2 - 1;
const mtof = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const TAU = Math.PI * 2;

class Bus {
  L: Float32Array;
  R: Float32Array;
  constructor(length: number) {
    this.L = new Float32Array(length);
    this.R = new Float32Array(length);
  }
  /** 같은 세기로 들리게 좌우 나누기 (pan: -1 왼쪽 ~ 1 오른쪽) */
  add(i: number, v: number, pan = 0) {
    if (i < 0 || i >= this.L.length) return;
    const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
    this.L[i] += v * Math.cos(a);
    this.R[i] += v * Math.sin(a);
  }
}

/** RBJ 쿡북 2차 필터 */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private type: 'lowpass' | 'highpass' | 'bandpass';
  constructor(type: 'lowpass' | 'highpass' | 'bandpass', freq: number, q = 0.707) {
    this.type = type;
    this.set(freq, q);
  }
  set(freq: number, q = 0.707) {
    const w = (TAU * Math.min(freq, SR * 0.45)) / SR;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number;
    if (this.type === 'lowpass') [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    else if (this.type === 'highpass') [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    else [b0, b1, b2] = [alpha, 0, -alpha];
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** 프리버브를 줄인 잔향 (빗살 8개 + 올패스 4개, 오른쪽은 조금 늦게) */
function reverb(send: Bus, room = 0.84, damp = 0.28): Bus {
  const scale = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const alls = [556, 441, 341, 225];
  const out = new Bus(send.L.length);
  for (const [side, spread] of [
    ['L', 0],
    ['R', 23],
  ] as const) {
    const input = side === 'L' ? send.L : send.R;
    const target = side === 'L' ? out.L : out.R;
    const cb = combs.map((d) => ({ buf: new Float32Array(Math.round((d + spread) * scale)), i: 0, store: 0 }));
    const ab = alls.map((d) => ({ buf: new Float32Array(Math.round((d + spread) * scale)), i: 0 }));
    for (let n = 0; n < input.length; n++) {
      const x = input[n] * 0.015;
      let y = 0;
      for (const c of cb) {
        const o = c.buf[c.i];
        c.store = o * (1 - damp) + c.store * damp;
        c.buf[c.i] = x + c.store * room;
        c.i = (c.i + 1) % c.buf.length;
        y += o;
      }
      for (const a of ab) {
        const o = a.buf[a.i];
        a.buf[a.i] = y + o * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        y = o - y;
      }
      target[n] = y;
    }
  }
  return out;
}

// ── 악기 ──────────────────────────────────────────────────

/** 뜯는 소리: 배음마다 빠르게 줄어드는 사인파를 더한다 (높은 배음일수록 빨리 사라진다) */
function pluck(bus: Bus, time: number, midi: number, amp: number, pan: number, dur = 1.2, bright = 1) {
  const f = mtof(midi);
  const start = Math.round(time * SR);
  const n = Math.round(dur * SR);
  const harmonics = Math.max(1, Math.min(8, Math.floor(9000 / f)));
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (let k = 1; k <= harmonics; k++) s += (k === 1 ? 1 : bright / Math.pow(k, 1.3)) * Math.sin(TAU * f * k * t) * Math.exp(-t * (2.6 + k * 2.4));
    const attack = Math.min(1, i / 96);
    const tail = i > n - 480 ? (n - i) / 480 : 1;
    bus.add(start + i, s * amp * attack * tail, pan);
  }
}

/** 띠 제한한 톱니파 한 주기 (거친 소리 없이 따뜻하게) */
const SAW = (() => {
  const size = 4096;
  const table = new Float32Array(size + 1);
  for (let i = 0; i <= size; i++) {
    let s = 0;
    for (let k = 1; k <= 24; k++) s += Math.sin((TAU * k * i) / size) / k;
    table[i] = s * 0.55;
  }
  return table;
})();

/** 패드: 조금씩 음을 어긋나게 한 톱니파 셋을 저역 필터로 부드럽게 */
function padNote(bus: Bus, from: number, to: number, midi: number, amp: number, cutoff: number) {
  const voices = [
    { detune: -0.07, pan: -0.6 },
    { detune: 0, pan: 0 },
    { detune: 0.07, pan: 0.6 },
  ];
  const attack = 0.5;
  const release = 0.9;
  const start = Math.round(from * SR);
  const n = Math.round((to - from + release) * SR);
  for (const v of voices) {
    const f = mtof(midi + v.detune);
    const filter = new Biquad('lowpass', cutoff, 0.6);
    let phase = random();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.min(1, t / attack) * (t > to - from ? Math.max(0, 1 - (t - (to - from)) / release) : 1);
      const x = phase * 4096;
      const j = Math.floor(x);
      const s = SAW[j] + (SAW[j + 1] - SAW[j]) * (x - j);
      phase += f / SR;
      if (phase >= 1) phase -= 1;
      bus.add(start + i, filter.run(s) * amp * env, v.pan);
    }
  }
}

function bassNote(bus: Bus, time: number, midi: number, dur: number, amp: number) {
  const f = mtof(midi);
  const start = Math.round(time * SR);
  const n = Math.round((dur + 0.08) * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.008) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.08) : 1) * (0.75 + 0.25 * Math.exp(-t * 6));
    const s = Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2 * f * t) + 0.08 * Math.sin(TAU * 3 * f * t);
    bus.add(start + i, (Math.tanh(s * 1.4) / Math.tanh(1.4)) * amp * env);
  }
}

function kick(bus: Bus, time: number, amp: number) {
  const start = Math.round(time * SR);
  let phase = 0;
  for (let i = 0; i < SR * 0.42; i++) {
    const t = i / SR;
    phase += (TAU * (48 + 75 * Math.exp(-t * 32))) / SR;
    const click = i < 140 ? noise() * 0.25 * (1 - i / 140) : 0;
    bus.add(start + i, (Math.sin(phase) * Math.exp(-t * 7.5) + click) * amp);
  }
}

function clap(bus: Bus, time: number, amp: number) {
  const start = Math.round(time * SR);
  const bp = new Biquad('bandpass', 1400, 0.9);
  const hp = new Biquad('highpass', 600);
  for (let i = 0; i < SR * 0.22; i++) {
    const t = i / SR;
    // 손뼉처럼 아주 짧게 세 번 겹친 뒤 줄어든다
    const burst = t < 0.03 ? (Math.floor(t / 0.01) % 2 === 0 ? 1 : 0.55) : 1;
    const s = hp.run(bp.run(noise())) * Math.exp(-t * 22) * burst + Math.sin(TAU * 190 * t) * Math.exp(-t * 40) * 0.25;
    bus.add(start + i, s * amp, 0.05);
  }
}

function hat(bus: Bus, time: number, amp: number) {
  const start = Math.round(time * SR);
  const hp = new Biquad('highpass', 7500, 0.8);
  for (let i = 0; i < SR * 0.05; i++) bus.add(start + i, hp.run(noise()) * Math.exp(-(i / SR) * 70) * amp, 0.25);
}

// ── 효과음 ────────────────────────────────────────────────

function whoosh(bus: Bus, time: number, dur: number, pan: number, amp = 0.16) {
  const start = Math.round(time * SR);
  const n = Math.round(dur * SR);
  const bp = new Biquad('bandpass', 500, 0.9);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    if (i % 64 === 0) bp.set(500 * Math.pow(5.6, x), 0.9);
    const env = Math.pow(Math.sin(Math.PI * x), 1.6);
    bus.add(start + i, bp.run(noise()) * env * amp * 2.2, pan - 0.5 + x);
  }
}

function paper(bus: Bus, time: number, pan: number, soft = false) {
  const start = Math.round(time * SR);
  const bp = new Biquad('bandpass', 2300, 0.8);
  const amp = soft ? 0.13 : 0.22;
  for (let i = 0; i < SR * 0.11; i++) {
    const t = i / SR;
    const s = bp.run(noise()) * Math.exp(-t * 48) * 1.6 + Math.sin(TAU * (90 + 60 * Math.exp(-t * 40)) * t) * Math.exp(-t * 34) * 0.7;
    bus.add(start + i, s * amp, pan);
  }
}

function pop(bus: Bus, time: number, pan: number, step = 0, amp = 0.17) {
  const start = Math.round(time * SR);
  const base = 560 * Math.pow(2, (step * 2) / 12);
  let phase = 0;
  for (let i = 0; i < SR * 0.16; i++) {
    const t = i / SR;
    phase += (TAU * base * (0.85 + 0.55 * (1 - Math.exp(-t * 60)))) / SR;
    const s = (Math.sin(phase) + 0.25 * Math.sin(2 * phase)) * Math.min(1, t / 0.002) * Math.exp(-t * 30);
    bus.add(start + i, s * amp, pan);
  }
}

function tick(bus: Bus, time: number, freq: number, amp: number, pan: number) {
  const start = Math.round(time * SR);
  const hp = new Biquad('highpass', 3000);
  for (let i = 0; i < SR * 0.02; i++) {
    const t = i / SR;
    bus.add(start + i, (Math.sin(TAU * freq * t) * Math.exp(-t * 260) + hp.run(noise()) * Math.exp(-t * 500) * 0.5) * amp, pan);
  }
}

function sweepTone(bus: Bus, time: number, dur: number, f0: number, f1: number, amp: number, tremolo: number, pan = 0) {
  const start = Math.round(time * SR);
  const n = Math.round(dur * SR);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    phase += (TAU * f0 * Math.pow(f1 / f0, x)) / SR;
    const env = Math.pow(Math.sin(Math.PI * x), 0.8) * (1 - 0.45 * (0.5 + 0.5 * Math.sin((TAU * tremolo * i) / SR)));
    bus.add(start + i, Math.sin(phase) * env * amp, pan);
  }
}

function scan(bus: Bus, time: number, dur: number) {
  const start = Math.round(time * SR);
  const n = Math.round(dur * SR);
  const bp = new Biquad('bandpass', 900, 5);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    if (i % 64 === 0) bp.set(900 * Math.pow(4.5, x), 5);
    const env = Math.pow(Math.sin(Math.PI * x), 0.7) * (0.6 + 0.4 * Math.sin((TAU * 26 * i) / SR));
    bus.add(start + i, bp.run(noise()) * env * 0.22, -0.3 + 0.6 * x);
  }
  sweepTone(bus, time, dur, 330, 990, 0.025, 13);
}

function bell(bus: Bus, send: Bus, time: number, midi: number, amp: number, pan: number, length = 2.4) {
  const f = mtof(midi);
  const partials: [number, number, number][] = [
    [1, 1, 1.6],
    [2.0, 0.45, 2.4],
    [3.01, 0.25, 3.4],
    [4.2, 0.16, 5],
    [5.43, 0.1, 7],
  ];
  const start = Math.round(time * SR);
  for (let i = 0; i < SR * length; i++) {
    const t = i / SR;
    let s = 0;
    for (const [ratio, a, d] of partials) s += a * Math.sin(TAU * f * ratio * t) * Math.exp(-t * d);
    const v = s * amp * Math.min(1, i / 48);
    bus.add(start + i, v, pan);
    send.add(start + i, v * 0.6, pan);
  }
}

function stamp(bus: Bus, send: Bus, time: number, pan: number) {
  whoosh(bus, time - 0.13, 0.13, pan, 0.07);
  const start = Math.round(time * SR);
  const lp = new Biquad('lowpass', 900, 0.7);
  let phase = 0;
  for (let i = 0; i < SR * 0.9; i++) {
    const t = i / SR;
    phase += (TAU * (40 + 34 * Math.exp(-t * 9))) / SR;
    const boom = Math.sin(phase) * Math.exp(-t * 5.5) * 0.6;
    const hit = lp.run(noise()) * Math.exp(-t * 26) * 0.75;
    const thock = Math.sin(TAU * 210 * t) * Math.exp(-t * 32) * 0.25;
    const v = (boom + hit + thock) * 0.75;
    bus.add(start + i, v, pan * 0.5);
    send.add(start + i, v * 0.3, pan * 0.5);
  }
}

function typeTicks(bus: Bus, time: number, pan: number) {
  for (const [dt, f] of [
    [0, 1900],
    [0.065, 2300],
    [0.13, 2100],
  ]) {
    tick(bus, time + dt, f + random() * 300, 0.07 + random() * 0.03, pan + (random() - 0.5) * 0.3);
  }
}

function riser(bus: Bus, time: number, dur: number) {
  const start = Math.round(time * SR);
  const n = Math.round(dur * SR);
  const hp = new Biquad('highpass', 300, 0.9);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    if (i % 64 === 0) hp.set(300 * Math.pow(18, x), 0.9);
    const env = Math.pow(x, 2.2) * (i > n - 960 ? (n - i) / 960 : 1);
    bus.add(start + i, hp.run(noise()) * env * 0.2, Math.sin(x * 9) * 0.3);
  }
  sweepTone(bus, time + dur * 0.3, dur * 0.7, 180, 720, 0.035, 0);
}

function impact(bus: Bus, send: Bus, time: number) {
  const start = Math.round(time * SR);
  const lp = new Biquad('lowpass', 9000);
  const hp = new Biquad('highpass', 2500);
  let phase = 0;
  for (let i = 0; i < SR * 2.4; i++) {
    const t = i / SR;
    phase += (TAU * (36 + 30 * Math.exp(-t * 7))) / SR;
    const boom = Math.sin(phase) * Math.exp(-t * 2.4) * 0.62;
    const wash = lp.run(hp.run(noise())) * Math.exp(-t * 1.9) * 0.11;
    bus.add(start + i, boom + wash);
    send.add(start + i, (boom * 0.2 + wash) * 0.8);
  }
  for (const [dt, midi] of [
    [0, 74],
    [0.05, 81],
    [0.1, 86],
  ]) {
    bell(bus, send, time + dt, midi, 0.09, (midi - 80) / 12, 3.2);
  }
}

// ── 배경음악 ──────────────────────────────────────────────

const BEAT = 0.6; // 100 BPM
const BAR = BEAT * 4;
// 라장조. 소리 이름 → 패드 화음(가운데 음역)과 베이스 뿌리음
const CHORDS: Record<string, { pad: number[]; bass: number }> = {
  G: { pad: [55, 59, 62, 66], bass: 43 },
  A: { pad: [57, 61, 64, 66], bass: 45 },
  'F#m': { pad: [54, 57, 61, 64], bass: 42 },
  Bm: { pad: [59, 62, 66, 69], bass: 47 },
  Em: { pad: [52, 55, 59, 62], bass: 40 },
  D: { pad: [50, 54, 57, 61, 64], bass: 38 },
};
// 4도-5도-3도-6도로 도는 밝은 진행, 대시보드 장면(12마디~)에서 2도로 바꿔 한 번 들어 올린다
const PROGRESSION = ['G', 'A', 'F#m', 'Bm', 'G', 'A', 'F#m', 'Bm', 'G', 'A', 'F#m', 'Bm', 'Em', 'A', 'F#m', 'Bm', 'G', 'A'];

interface MusicTimes {
  /** 드럼·베이스가 들어오는 때 (올리기 장면) */
  groove: number;
  /** 드럼이 빠지는 때 (끝 화면 앞 고조) */
  drop: number;
  /** 끝 화면 으뜸화음이 울리는 때 */
  resolve: number;
  total: number;
}

function music(bus: Bus, send: Bus, m: MusicTimes) {
  const chordAt = (bar: number) => PROGRESSION[Math.min(bar, PROGRESSION.length - 1)];
  const bars = Math.ceil(m.resolve / BAR);
  for (let bar = 0; bar < bars; bar++) {
    const from = bar * BAR;
    if (from >= m.resolve) break;
    const to = Math.min((bar + 1) * BAR, m.resolve);
    const chord = CHORDS[chordAt(bar)];
    const lift = bar >= 12 && bar < 16;
    for (const midi of chord.pad) padNote(bus, from, to, midi, from < m.groove ? 0.018 : 0.012, lift ? 2400 : 1600);
    for (const midi of chord.pad) padNote(send, from, to, midi, 0.006, 1600);

    // 뜯는 소리 아르페지오: 처음엔 4분음표, 그루브부터 8분음표, 대시보드에서 16분음표
    const division = from < m.groove ? 1 : lift ? 4 : 2;
    const tones = [...chord.pad.slice(0, 4).map((x) => x + 12), chord.pad[1] + 24];
    const order = [0, 2, 1, 3, 4, 3, 1, 2];
    for (let s = 0; s < 4 * division; s++) {
      const t = from + (s * BEAT) / division;
      if (t >= Math.min(to, m.drop + BAR)) break;
      const midi = tones[order[s % order.length] % tones.length];
      const accent = s % division === 0 ? 1 : 0.7;
      pluck(bus, t, midi, 0.055 * accent, s % 2 ? 0.35 : -0.35, division === 4 ? 0.6 : 1.1, 0.8);
      pluck(send, t, midi, 0.03 * accent, 0, 0.8, 0.5);
    }

    if (from >= m.groove && from < m.drop) {
      // 베이스: 1박, 2박 반, 3박 (살짝 밀고 당기는 박자)
      for (const [beat, len] of [
        [0, 1.4],
        [1.5, 0.45],
        [2, 0.9],
        [3.5, 0.45],
      ]) {
        bassNote(bus, from + beat * BEAT, chord.bass + (beat === 3.5 ? 12 : 0), len * BEAT, 0.085);
      }
      // 드럼: 킥 1·3박(+3박 반), 손뼉 2·4박(14초부터), 하이햇 8분음표
      for (const beat of [0, 2, 2.5]) if (beat !== 2.5 || bar % 2 === 1) kick(bus, from + beat * BEAT, beat === 2.5 ? 0.2 : 0.3);
      if (from >= 14) for (const beat of [1, 3]) clap(bus, from + beat * BEAT, 0.16);
      for (let e = 0; e < 8; e++) hat(bus, from + e * BEAT * 0.5, e % 2 ? 0.05 : 0.08);
      // 대시보드 들어가기 직전 마디 끝에 손뼉 몰아치기
      if (bar === 11) for (let k = 0; k < 4; k++) clap(bus, from + 3 * BEAT + (k * BEAT) / 4, 0.07 + k * 0.025);
    }
  }
  // 끝: 라장조 으뜸화음(9도 더함)을 길게, 위로 천천히 펼친다
  const end = m.total - m.resolve;
  for (const midi of CHORDS.D.pad) {
    padNote(bus, m.resolve, m.total - 0.9, midi, 0.014, 2000);
    padNote(send, m.resolve, m.total - 0.9, midi, 0.008, 2000);
  }
  bassNote(bus, m.resolve, 38, end - 1.2, 0.08);
  [62, 66, 69, 73, 76, 81].forEach((midi, i) => pluck(bus, m.resolve + 0.5 + i * 0.3, midi, 0.06, i % 2 ? 0.3 : -0.3, 2.4, 0.7));
}

/** 효과음 넣기 (신호 목록대로) */
function effects(bus: Bus, send: Bus, cues: Cue[]) {
  const RISE = [74, 76, 78, 81, 83, 86, 88, 90, 93, 95, 98, 100, 102, 105, 107];
  const GLITTER = [86, 88, 90, 93, 95, 98];
  const BLIP = [81, 85, 88, 93];
  for (const c of cues) {
    const t = c.t / 1000;
    switch (c.type) {
      case 'paper':
        paper(bus, t, c.pan, c.soft);
        break;
      case 'pop':
        pop(bus, t, c.pan, c.step ?? 0);
        break;
      case 'count':
        for (let i = 0; i < 16; i++) tick(bus, t + ((c.dur ?? 1000) / 1000) * (1 - Math.pow(1 - i / 16, 1.7)), 1300 + i * 70, 0.05, 0.1);
        break;
      case 'whoosh':
        whoosh(bus, t, (c.dur ?? 600) / 1000, c.pan);
        break;
      case 'thunk':
        paper(bus, t, 0, false);
        pop(bus, t + 0.02, 0, -12, 0.12);
        break;
      case 'process':
        sweepTone(bus, t, (c.dur ?? 1500) / 1000, 220, 440, 0.03, 11);
        break;
      case 'glitter':
        pluck(bus, t, GLITTER[(c.step ?? 0) % GLITTER.length], 0.035, c.pan, 0.5, 0.5);
        pluck(send, t, GLITTER[(c.step ?? 0) % GLITTER.length], 0.03, c.pan, 0.5, 0.5);
        break;
      case 'scan':
        scan(bus, t, (c.dur ?? 1500) / 1000);
        break;
      case 'blip':
        bell(bus, send, t, BLIP[(c.step ?? 0) % BLIP.length], 0.07, c.pan, 0.9);
        break;
      case 'click':
        tick(bus, t, 2400, 0.16, c.pan);
        break;
      case 'stamp':
        stamp(bus, send, t, c.pan);
        break;
      case 'rise':
        pluck(bus, t, RISE[(c.step ?? 0) % RISE.length], 0.075, c.pan, 0.8, 0.7);
        pluck(send, t, RISE[(c.step ?? 0) % RISE.length], 0.05, c.pan, 0.8, 0.5);
        break;
      case 'chime':
        [86, 90, 93, 98].forEach((midi, i) => bell(bus, send, t + i * 0.07, midi, 0.075, (i - 1.5) * 0.3));
        break;
      case 'type':
        typeTicks(bus, t, c.pan);
        break;
      case 'riser':
        riser(bus, t, (c.dur ?? 1500) / 1000);
        break;
      case 'impact':
        impact(bus, send, t);
        break;
    }
  }
}

export interface SoundtrackOptions {
  /** 배경음악 대신 쓸 음원 (48kHz 스테레오, 길이가 짧으면 거기까지만) */
  music?: { L: Float32Array; R: Float32Array };
}

/** 영상 전체 소리 (48kHz 스테레오) */
export function renderSoundtrack(cues: Cue[], totalMs: number, options: SoundtrackOptions = {}): Bus {
  const total = totalMs / 1000;
  const length = Math.round(total * SR);
  const bed = new Bus(length);
  const sfx = new Bus(length);
  const send = new Bus(length);

  const at = (type: string) => (cues.find((c) => c.type === type)?.t ?? 0) / 1000;
  if (options.music) {
    // 받은 음원: 앞뒤를 부드럽게 열고 닫는다
    for (let i = 0; i < length && i < options.music.L.length; i++) {
      const t = i / SR;
      const g = Math.min(1, t / 1.5) * Math.min(1, (total - t) / 2.5) * 0.55;
      bed.L[i] = options.music.L[i] * g;
      bed.R[i] = options.music.R[i] * g;
    }
  } else {
    music(bed, send, { groove: 3 * BAR, drop: at('riser'), resolve: at('impact'), total });
  }
  effects(sfx, send, cues);

  // 도장·마지막 쾅 소리 때는 배경음악을 살짝 줄여 효과음이 또렷하게
  const ducks = cues.filter((c) => c.type === 'stamp' || c.type === 'impact').map((c) => c.t / 1000);
  const wet = reverb(send);
  const out = new Bus(length);
  const hpL = new Biquad('highpass', 28);
  const hpR = new Biquad('highpass', 28);
  for (let i = 0; i < length; i++) {
    const t = i / SR;
    let duck = 1;
    for (const d of ducks) if (t > d - 0.05 && t < d + 0.6) duck = Math.min(duck, 0.55 + 0.45 * Math.min(1, Math.abs(t - d) / 0.6));
    const fade = Math.min(1, (total - t) / 1.6);
    out.L[i] = hpL.run(bed.L[i] * duck + sfx.L[i] + wet.L[i] * 0.9) * fade;
    out.R[i] = hpR.run(bed.R[i] * duck + sfx.R[i] + wet.R[i] * 0.9) * fade;
  }

  // 마무리: 평균 소리 크기를 맞추고(-17.5dBFS RMS ≈ -16 LUFS), 그보다 튀는 봉우리만 부드럽게 눌러 -1dBFS 안쪽으로
  let sum = 0;
  for (let i = 0; i < length; i++) sum += (out.L[i] * out.L[i] + out.R[i] * out.R[i]) / 2;
  const gain = Math.pow(10, -17.5 / 20) / Math.sqrt(sum / length || 1);
  const knee = 0.7;
  const ceiling = 0.89;
  const limit = (x: number) => {
    const a = Math.abs(x);
    return a <= knee ? x : Math.sign(x) * (knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee)));
  };
  for (let i = 0; i < length; i++) {
    out.L[i] = limit(out.L[i] * gain);
    out.R[i] = limit(out.R[i] * gain);
  }
  return out;
}

/** 16비트 PCM WAV */
export function wav(bus: Bus): Buffer {
  const n = bus.L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, bus.L[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, bus.R[i])) * 32767), 46 + i * 4);
  }
  return buf;
}
