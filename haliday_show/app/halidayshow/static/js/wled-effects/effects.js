// WLED's own effects, translated to JavaScript from WLED 0.15.5 wled00/FX.cpp so the editor can preview
// them. Each takes the Segment (engine.js) and draws one frame at strip.now, as WLED does about 42 times
// a second; some return how long (ms) until WLED should draw them again. Keyed by WLED's effect id (FX.h).
// Effects not here yet get a stand-in in index.js.
//
// SPDX-License-Identifier: EUPL-1.2
// Copyright (c) 2016-present Christian Schwinne and individual WLED contributors
// Many effects are adapted by WLED's authors from earlier work (WS2812FX by Harm Aldick and Keith Lord,
// FastLED examples by Mark Kriegsman and others), as credited in WLED's FX.cpp.
// This folder is under the EUPL 1.2 (see LICENSE here), not the MIT licence of the rest of HA-liday Show.

import {
  B, BLACK, FRAMETIME, G, NUM_COLORS, R, STARBURST_MAX_FRAG, W, WHITE, addCRGB, beat16, beat8, beatsin16_t,
  beatsin88_t, beatsin8_t, ColorFromPalette, color_add, color_blend, color_fade, cos8_t, crgb, cubicwave8, fromCRGB,
  gamma8, get_random_wheel_index, getAverageLight, getSeed, hsv2rgb_rainbow, map, maxCRGB, nscale8, nscale8_video,
  qadd8, quadwave8, qsub8, random16, random8, RGBW32, scale16, scale8, setSeed, sin16_t, sin8_t, sin_gap, strip,
  triwave16, triwave8,
} from "./engine.js";
import { inoise16, inoise8 } from "./noise.js";

function mode_static(s) {
  s.fill(s.SEGCOLOR(0));
}

function blink(s, color1, color2, strobe, doPalette) {
  let cycleTime = (255 - s.speed) * 20;
  let onTime = FRAMETIME;
  if (!strobe) onTime += (cycleTime * s.intensity) >> 8;
  cycleTime += FRAMETIME * 2;
  const it = Math.floor(strip.now / cycleTime), rem = strip.now % cycleTime;
  const on = it !== s.step || rem <= onTime;
  s.step = it;
  const color = on ? color1 : color2;
  if (color === color1 && doPalette) {
    for (let i = 0; i < s.len; i++) s.setPixelColor(i, s.color_from_palette(i, true, false, 0));
  } else s.fill(color);
}

function mode_breath(s) {
  let v = 0;
  let counter = (strip.now * ((s.speed >> 3) + 10)) & 0xFFFF;
  counter = (counter >> 2) + (counter >> 4);
  if (counter < 16384) {
    if (counter > 8192) counter = 8192 - (counter - 8192);
    v = Math.trunc(sin16_t(counter) / 103);
  }
  const lum = 30 + v;
  for (let i = 0; i < s.len; i++) s.setPixelColor(i, color_blend(s.SEGCOLOR(1), s.color_from_palette(i, true, false, 0), lum));
}

function mode_fade(s) {
  const counter = strip.now * ((s.speed >> 3) + 10);
  const lum = triwave16(counter & 0xFFFF) >> 8;
  for (let i = 0; i < s.len; i++) s.setPixelColor(i, color_blend(s.SEGCOLOR(1), s.color_from_palette(i, true, false, 0), lum));
}

function color_wipe(s, rev, useRandomColors) {
  if (s.len === 1) return mode_static(s);
  const cycleTime = 750 + (255 - s.speed) * 150;
  const perc = strip.now % cycleTime;
  let prog = Math.floor((perc * 65535) / cycleTime);
  const back = prog > 32767;
  if (back) { prog -= 32767; if (s.step === 0) s.step = 1; } else if (s.step === 2) s.step = 3;
  if (useRandomColors) {
    if (s.call === 0) { s.aux0 = random8(); s.step = 3; }
    if (s.step === 1) { s.aux1 = get_random_wheel_index(s.aux0); s.step = 2; }
    if (s.step === 3) { s.aux0 = get_random_wheel_index(s.aux1); s.step = 0; }
  }
  const ledIndex = (prog * s.len) >> 15;
  let rem = ((prog * s.len) * 2) & 0xFFFF;
  rem = Math.floor(rem / (s.intensity + 1));
  if (rem > 255) rem = 255;
  const col1 = useRandomColors ? s.color_wheel(s.aux1) : s.SEGCOLOR(1);
  for (let i = 0; i < s.len; i++) {
    const index = rev && back ? s.len - 1 - i : i;
    const col0 = useRandomColors ? s.color_wheel(s.aux0) : s.color_from_palette(index, true, false, 0);
    if (i < ledIndex) s.setPixelColor(index, back ? col1 : col0);
    else {
      s.setPixelColor(index, back ? col0 : col1);
      if (i === ledIndex) s.setPixelColor(index, color_blend(back ? col0 : col1, back ? col1 : col0, rem));
    }
  }
}

function mode_rainbow(s) {
  const counter = ((strip.now * ((s.speed >> 2) + 2)) & 0xFFFF) >> 8;
  if (s.intensity < 128) s.fill(color_blend(s.color_wheel(counter), WHITE, 128 - s.intensity));
  else s.fill(s.color_wheel(counter));
}

function mode_rainbow_cycle(s) {
  const counter = ((strip.now * ((s.speed >> 2) + 2)) & 0xFFFF) >> 8;
  for (let i = 0; i < s.len; i++) {
    const index = (Math.floor((i * (16 << Math.floor(s.intensity / 29))) / s.len) + counter) & 0xFF;
    s.setPixelColor(i, s.color_wheel(index));
  }
}

function scan(s, dual) {
  if (s.len === 1) return mode_static(s);
  const cycleTime = 750 + (255 - s.speed) * 150;
  const perc = strip.now % cycleTime;
  const prog = Math.floor((perc * 65535) / cycleTime);
  const size = 1 + ((s.intensity * s.len) >> 9);
  const ledIndex = Math.floor((prog * (s.len * 2 - size * 2)) / 65536);
  if (!s.check2) s.fill(s.SEGCOLOR(1));
  const off = Math.abs(ledIndex - (s.len - size));
  if (dual) {
    for (let j = off; j < off + size; j++) {
      const i2 = s.len - 1 - j;
      s.setPixelColor(i2, s.color_from_palette(i2, true, false, s.SEGCOLOR(2) ? 2 : 0));
    }
  }
  for (let j = off; j < off + size; j++) s.setPixelColor(j, s.color_from_palette(j, true, false, 0));
}

function running(s, color1, color2, theatre) {
  const width = (theatre ? 3 : 1) + (s.intensity >> 4);
  const cycleTime = 50 + (255 - s.speed);
  const it = Math.floor(strip.now / cycleTime);
  const usePalette = color1 === s.SEGCOLOR(0);
  for (let i = 0; i < s.len; i++) {
    let col = color2;
    if (usePalette) color1 = s.color_from_palette(i, true, false, 0);
    if (theatre) { if (i % width === s.aux0) col = color1; } else {
      const pos = i % (width << 1);
      if (pos < s.aux0 - width || (pos >= s.aux0 && pos < s.aux0 + width)) col = color1;
    }
    s.setPixelColor(i, col);
  }
  if (it !== s.step) { s.aux0 = (s.aux0 + 1) % (theatre ? width : width << 1); s.step = it; }
}

function running_base(s, saw, dual = false) {
  const xScale = s.intensity >> 2;
  const counter = Math.floor((strip.now * s.speed) / 512);
  for (let i = 0; i < s.len; i++) {
    let a = (i * xScale - counter) >>> 0;
    if (saw) {
      a &= 0xFF;
      a = a < 16 ? 192 + a * 8 : map(a, 16, 255, 64, 192);
      a = 255 - a;
    }
    const v = dual ? sin_gap(a & 0xFFFF) : sin8_t(a & 0xFF);
    let ca = color_blend(s.SEGCOLOR(1), s.color_from_palette(i, true, false, 0), v);
    if (dual) {
      const b = ((s.len - 1 - i) * xScale - counter) >>> 0;
      const cb = color_blend(s.SEGCOLOR(1), s.color_from_palette(i, true, false, 2), sin_gap(b & 0xFFFF));
      ca = color_blend(ca, cb, 127);
    }
    s.setPixelColor(i, ca);
  }
}

function chase(s, color1, color2, color3, doPalette) {
  const counter = (strip.now * ((s.speed >> 2) + 1)) & 0xFFFF;
  const a = (counter * s.len) >> 16;
  const size = 1 + ((s.intensity * s.len) >> 10);
  let b = (a + size) & 0xFFFF;
  if (b > s.len) b -= s.len;
  let c = (b + size) & 0xFFFF;
  if (c > s.len) c -= s.len;
  s.step = a;
  if (doPalette) for (let i = 0; i < s.len; i++) s.setPixelColor(i, s.color_from_palette(i, true, false, 1));
  else s.fill(color1);
  const span = (from, to, col) => {
    if (from < to) for (let i = from; i < to; i++) s.setPixelColor(i, col);
    else { for (let i = from; i < s.len; i++) s.setPixelColor(i, col); for (let i = 0; i < to; i++) s.setPixelColor(i, col); }
  };
  span(a, b, color2);
  span(b, c, color3);
}

function mode_twinkle(s) {
  s.fade_out(224);
  const cycleTime = 20 + (255 - s.speed) * 5;
  const it = Math.floor(strip.now / cycleTime);
  if (it !== s.step) {
    const maxOn = map(s.intensity, 0, 255, 1, s.len);
    if (s.aux0 >= maxOn) { s.aux0 = 0; s.aux1 = random16(); }
    s.aux0++;
    s.step = it;
  }
  let prng = s.aux1;
  for (let i = 0; i < s.aux0; i++) {
    prng = (prng * 2053 + 13849) & 0xFFFF;
    const j = Math.floor((s.len * prng) / 65536);
    s.setPixelColor(j, s.color_from_palette(j, true, false, 0));
  }
}

function mode_sparkle(s) {
  if (!s.check2) for (let i = 0; i < s.len; i++) s.setPixelColor(i, s.color_from_palette(i, true, false, 1));
  const cycleTime = 10 + (255 - s.speed) * 2;
  const it = Math.floor(strip.now / cycleTime);
  if (it !== s.step) { s.aux0 = random16(s.len); s.step = it; }
  s.setPixelColor(s.aux0, s.SEGCOLOR(0));
}

function mode_larson_scanner(s) {
  if (s.len === 1) return mode_static(s);
  const speed = FRAMETIME * map(s.speed, 0, 255, 96, 2);
  const pixels = Math.floor(s.len / speed);
  s.fade_out(255 - s.intensity);
  if (s.step > strip.now) return;
  let index = s.aux1 + pixels;
  if (pixels === 0) {
    const frames = Math.floor(speed / s.len);
    if (s.step++ < frames) return;
    s.step = 0;
    index++;
  }
  if (index > s.len) {
    s.aux0 = s.aux0 ? 0 : 1;
    s.aux1 = 0;
    s.step = s.aux0 || s.check2 ? strip.now + s.custom1 * 25 : 0;
  } else {
    for (let i = s.aux1; i < index; i++) {
      const j = s.aux0 ? i : s.len - 1 - i;
      const c = s.color_from_palette(j, true, false, 0);
      s.setPixelColor(j, c);
      if (s.check1) s.setPixelColor(s.len - 1 - j, s.SEGCOLOR(2) ? s.SEGCOLOR(2) : c);
    }
    s.aux1 = index;
  }
}

function mode_lightning(s) {
  if (s.len === 1) return mode_static(s);
  const ledstart = random16(s.len);
  const ledlen = 1 + random16(s.len - ledstart);
  let bri = Math.floor(255 / random8(1, 3));
  if (s.aux1 === 0) {
    s.aux1 = random8(4, 4 + Math.floor(s.intensity / 20)) * 2;
    bri = 52;
    s.aux0 = 200;
  }
  if (!s.check2) s.fill(s.SEGCOLOR(1));
  if (s.aux1 > 3 && !(s.aux1 & 1)) {
    for (let i = ledstart; i < ledstart + ledlen; i++) s.setPixelColor(i, s.color_from_palette(i, true, false, 0, bri));
    s.aux1--;
    s.step = strip.now;
  } else if (strip.now - s.step > s.aux0) {
    s.aux1--;
    if (s.aux1 < 2) s.aux1 = 0;
    s.aux0 = 50 + random8(100);
    if (s.aux1 === 2) s.aux0 = random8(255 - s.speed) * 100;
    s.step = strip.now;
  }
}

function mode_juggle(s) {
  if (s.len === 1) return mode_static(s);
  s.fadeToBlackBy(192 - Math.floor((3 * s.intensity) / 4));
  let dothue = 0;
  for (let i = 0; i < 8; i++) {
    const index = beatsin88_t((16 + s.speed) * (i + 7), 0, s.len - 1);
    const add = s.palette === 0 ? hsv2rgb_rainbow(dothue, 220, 255) : ColorFromPalette(s.pal, dothue, 255);
    s.setPixelColor(index, fromCRGB(maxCRGB(crgb(s.getPixelColor(index)), add)));
    dothue = (dothue + 32) & 0xFF;
  }
}

function mode_palette(s) {
  // The 1D case of WLED's float (ESP32) version: one line, as a single segment would be.
  const cols = s.len, rows = 1;
  const inputShift = s.speed, inputSize = s.intensity, inputRotation = s.custom1;
  const theta = !s.check2 ? ((inputRotation + 128) * (Math.PI / 256)) : (((strip.now * ((inputRotation >> 4) + 1)) & 0xFFFF) * (2 * Math.PI / 0xFFFF));
  const sinT = Math.sin(theta), cosT = Math.cos(theta);
  const maxX = Math.max(1, cols - 1), maxY = Math.max(1, rows - 1);
  const square = s.check3;
  const maxXIn = square ? maxX : 1, maxYIn = square ? maxY : 1, maxXOut = !square ? maxX : 1, maxYOut = !square ? maxY : 1;
  const centerX = maxXOut / 2, centerY = maxYOut / 2;
  const scale = Math.abs(sinT) + (Math.abs(cosT) * maxYOut) / maxXOut;
  const ytCos = (cosT * (0 - centerY * maxYIn)) / (maxYIn * scale);
  for (let x = 0; x < cols; x++) {
    const xtSin = (sinT * (x - centerX * maxXIn)) / (maxXIn * scale);
    const sourceX = xtSin + ytCos + centerX;
    let ci = Math.trunc((Math.min(Math.max(sourceX, 0), maxXOut) * 255) / maxXOut);
    ci = inputSize <= 128 ? Math.trunc((ci * inputSize) / 128) : Math.trunc(((inputSize - 112) * ci) / 16);
    const offset = !s.check1 ? inputShift : (((strip.now * ((inputShift >> 3) + 1)) & 0xFFFF) >> 8);
    s.setPixelColor(x, s.color_wheel((ci - offset) & 0xFF));
  }
}

function mode_fire_2012(s) {
  if (s.len === 1) return mode_static(s);
  s.allocateData(s.len);
  const heat = s.data;
  const it = Math.floor(strip.now / 32);
  const ignition = Math.max(3, Math.floor(s.len / 10)) & 0xFF;
  for (let i = 0; i < s.len; i++) {
    const cool = it !== s.step ? random8(Math.floor(((20 + Math.floor(s.speed / 3)) * 16) / s.len) + 2) : random8(4);
    const minTemp = i < ignition ? Math.floor((ignition - i) / 4) + 16 : 0;
    const temp = qsub8(heat[i], cool);
    heat[i] = temp < minTemp ? minTemp : temp;
  }
  if (it !== s.step) {
    for (let k = s.len - 1; k > 1; k--) heat[k] = Math.floor((heat[k - 1] + (heat[k - 2] << 1)) / 3);
    if (random8() <= s.intensity) {
      const y = random8(ignition);
      const boost = Math.floor(((17 + s.custom3) * (ignition - (y >> 1))) / ignition) & 0xFF;
      heat[y] = qadd8(heat[y], random8(96 + 2 * boost, 207 + boost));
    }
  }
  for (let j = 0; j < s.len; j++) s.setPixelColor(j, fromCRGB(ColorFromPalette(s.pal, Math.min(heat[j], 240), 255, false)));
  if (it !== s.step) s.step = it;
}

function mode_colorwaves(s) {
  const duration = 10 + s.speed;
  let pseudo = s.step >>> 0, sHue16 = s.aux0 & 0xFFFF;
  const brightdepth = beatsin88_t(341, 96, 224);
  const thetaInc = beatsin88_t(203, 25 * 256, 40 * 256);
  const msmult = beatsin88_t(147, 23, 60);
  let hue16 = sHue16;
  const hueinc16 = Math.floor((beatsin88_t(113, 60, 300) * s.intensity * 10) / 255);
  pseudo = (pseudo + duration * msmult) >>> 0;
  sHue16 = (sHue16 + duration * beatsin88_t(400, 5, 9)) & 0xFFFF;
  let theta = pseudo;
  for (let i = 0; i < s.len; i++) {
    hue16 = (hue16 + hueinc16) >>> 0;
    const h16_128 = hue16 >>> 7;
    const hue8 = (h16_128 & 0x100 ? 255 - (h16_128 >>> 1) : h16_128 >>> 1) & 0xFF;
    theta = (theta + thetaInc) >>> 0;
    const b16 = sin16_t(theta & 0xFFFF) + 32768;
    const bri16 = Math.floor((b16 * b16) / 65536);
    let bri8 = Math.floor((bri16 * brightdepth) / 65536) & 0xFF;
    bri8 = (bri8 + (255 - brightdepth)) & 0xFF;
    s.blendPixelColor(i, s.color_from_palette(hue8, false, false, 0, bri8), 128);
  }
  s.step = pseudo;
  s.aux0 = sHue16;
}

function mode_meteor(s) {
  if (s.len === 1) return mode_static(s);
  s.allocateData(s.len);
  const trail = s.data;
  const meteorSize = 1 + Math.floor(s.len / 20);
  const counter = strip.now * ((s.speed >> 2) + 8);
  const inn = Math.floor(((counter % 4294967296) * s.len % 4294967296) / 65536) & 0xFFFF; // uint32 maths, as in C
  const max = s.palette === 5 ? 239 : 255;
  for (let i = 0; i < s.len; i++) {
    if (random8() <= 255 - s.intensity) {
      const decay = 128 + random8(127);
      trail[i] = scale8(trail[i], decay);
      let index = trail[i], idx = 255, bri = s.palette === 35 || s.palette === 36 ? 255 : trail[i];
      if (!s.check1) { idx = 0; index = map(i, 0, s.len, 0, max); bri = trail[i]; }
      s.setPixelColor(i, s.color_from_palette(index, false, false, idx, bri));
    }
  }
  for (let j = 0; j < meteorSize; j++) {
    const index = (inn + j) % s.len;
    let idx = 255;
    let i = trail[index] = max;
    if (!s.check1) { i = map(index, 0, s.len, 0, max); idx = 0; }
    s.setPixelColor(index, s.color_from_palette(i, false, false, idx, 255));
  }
}

function twinklefox_one_twinkle(s, ms, salt, cat) {
  const ticks = Math.floor(ms / s.aux0);
  const fast8 = ticks & 0xFF;
  let slow16 = ((ticks >>> 8) + salt) & 0xFFFF;
  slow16 = (slow16 + sin8_t(slow16 & 0xFF)) & 0xFFFF;
  slow16 = (slow16 * 2053 + 1384) & 0xFFFF;
  const slow8 = ((slow16 & 0xFF) + (slow16 >> 8)) & 0xFF;
  const density = (s.intensity >> 5) + 1;
  let bright = 0;
  if (((slow8 & 0x0E) >> 1) < density) {
    let ph = fast8;
    if (cat) bright = 255 - ph;
    else if (ph < 86) bright = ph * 3;
    else { ph -= 86; bright = 255 - (ph + (ph >> 1)); }
  }
  const hue = (slow8 - salt) & 0xFF;
  if (bright <= 0) return [0, 0, 0];
  const c = ColorFromPalette(s.pal, hue, bright, false);
  if (!s.check1 && fast8 >= 128) {
    const cooling = (fast8 - 128) >> 4;
    c[1] = qsub8(c[1], cooling);
    c[2] = qsub8(c[2], cooling * 2);
  }
  return c;
}
function twinklefox_base(s, cat) {
  let prng = 11337;
  s.aux0 = s.speed > 100 ? 3 + ((255 - s.speed) >> 3) : 22 + ((100 - s.speed) >> 1);
  let bg = crgb(s.SEGCOLOR(1));
  const bglight = getAverageLight(bg);
  bg = nscale8_video(bg, bglight > 64 ? 16 : bglight > 16 ? 64 : 86);
  const bgBright = getAverageLight(bg), bgBlack = !bg[0] && !bg[1] && !bg[2];
  for (let i = 0; i < s.len; i++) {
    prng = (prng * 2053 + 1384) & 0xFFFF;
    const offset = prng;
    prng = (prng * 2053 + 1384) & 0xFFFF;
    const mult = ((((prng & 0xFF) >> 4) + (prng & 0x0F)) & 0x0F) + 0x08;
    const clock = (Math.floor((strip.now * mult) / 8) + offset) >>> 0;
    const c = twinklefox_one_twinkle(s, clock, prng >> 8, cat);
    const delta = getAverageLight(c) - bgBright;
    if (delta >= 32 || bgBlack) s.setPixelColor(i, c[0], c[1], c[2]);
    else if (delta > 0) s.setPixelColor(i, color_blend(fromCRGB(bg), fromCRGB(c), delta * 8));
    else s.setPixelColor(i, bg[0], bg[1], bg[2]);
  }
}

function candle(s, multi) {
  if (multi && s.len > 1) s.allocateData(Math.max(1, s.len - 1) * 3);
  const valrange = s.intensity, rndval = valrange >> 1;
  const speedFactor = s.speed > 252 ? 1 : s.speed > 99 ? 2 : s.speed > 49 ? 3 : 4;
  const numCandles = multi ? s.len : 1;
  for (let i = 0; i < numCandles; i++) {
    let d = 0, v = s.aux0, target = s.aux1, fadeStep = s.step;
    if (i > 0) { d = (i - 1) * 3; v = s.data[d]; target = s.data[d + 1]; fadeStep = s.data[d + 2]; }
    if (fadeStep === 0) { v = 128; target = 130 + random8(4); fadeStep = 1; }
    let newTarget = false;
    if (target > v) { v = qadd8(v, fadeStep); if (v >= target) newTarget = true; } else { v = qsub8(v, fadeStep); if (v <= target) newTarget = true; }
    if (newTarget) {
      target = random8(rndval) + random8(rndval);
      if (target < rndval >> 1) target = (rndval >> 1) + random8(rndval);
      target += 255 - valrange;
      const dif = target > v ? target - v : v - target;
      fadeStep = dif >> speedFactor || 1;
    }
    if (i > 0) {
      s.setPixelColor(i, color_blend(s.SEGCOLOR(1), s.color_from_palette(i, true, false, 0), v));
      s.data[d] = v; s.data[d + 1] = target; s.data[d + 2] = fadeStep;
    } else {
      for (let j = 0; j < s.len; j++) s.setPixelColor(j, color_blend(s.SEGCOLOR(1), s.color_from_palette(j, true, false, 0), v));
      s.aux0 = v; s.aux1 = target; s.step = fadeStep;
    }
  }
}

function mode_starburst(s) {
  if (s.len === 1) return mode_static(s);
  const numStars = Math.min(1 + (s.len >> 3), 42); // ESP32: up to 42 stars on a lone segment
  if (!s.state) s.state = Array.from({ length: numStars }, () => ({ color: [0, 0, 0], birth: 0, last: 0, vel: 0, pos: 0, fragment: new Float32Array(STARBURST_MAX_FRAG) }));
  const stars = s.state, it = strip.now;
  const maxSpeed = 375, ignition = 250, fadeTime = 1500;
  for (const st of stars) {
    if (random8(144 - (s.speed >> 1)) === 0 && st.birth === 0) {
      const startPos = random16(s.len - 1);
      const multiplier = random8() / 255;
      st.color = crgb(s.color_wheel(random8()));
      st.pos = startPos;
      st.vel = (maxSpeed * random8()) / 255 * multiplier;
      st.birth = it;
      st.last = it;
      const num = random8(3, 6 + (s.intensity >> 5));
      for (let i = 0; i < STARBURST_MAX_FRAG; i++) st.fragment[i] = i < num ? startPos : -1;
    }
  }
  if (!s.check2) s.fill(s.SEGCOLOR(1));
  for (const st of stars) {
    if (st.birth !== 0) {
      const dt = (it - st.last) / 1000;
      for (let i = 0; i < STARBURST_MAX_FRAG; i++) {
        if (st.fragment[i] > 0) st.fragment[i] += st.vel * dt * (i >> 1) / 3;
      }
      st.last = it;
      st.vel -= 3 * st.vel * dt;
    }
    let c = st.color, fade = 0;
    let age = it - st.birth;
    if (age < ignition) c = crgb(color_blend(WHITE, fromCRGB(c), Math.trunc(254.5 * (age / ignition))));
    else if (age > ignition + fadeTime) { fade = 1; st.birth = 0; c = crgb(s.SEGCOLOR(1)); } else {
      age -= ignition;
      fade = age / fadeTime;
      c = crgb(color_blend(fromCRGB(c), s.SEGCOLOR(1), Math.trunc(254.5 * fade) & 0xFF));
    }
    const size = (1 - fade) * 2;
    for (let index = 0; index < STARBURST_MAX_FRAG * 2; index++) {
      const i = index >> 1;
      if (st.fragment[i] > 0) {
        let loc = st.fragment[i];
        if (index & 1) loc -= (loc - st.pos) * 2;
        let start = Math.trunc(loc - size), end = Math.trunc(loc + size);
        if (start < 0) start = 0;
        if (start === end) end++;
        if (end > s.len) end = s.len;
        for (let p = start; p < end; p++) s.setPixelColor(p, c[0], c[1], c[2]);
      }
    }
  }
}

function mode_plasma(s) {
  if (s.call === 0) s.aux0 = random8(0, 2);
  const thisPhase = beatsin8_t(6 + s.aux0, -64, 64), thatPhase = beatsin8_t(7 + s.aux0, -64, 64);
  for (let i = 0; i < s.len; i++) {
    const ci = (cubicwave8((i * (2 + 3 * (s.speed >> 5)) + thisPhase) & 0xFF) >> 1) + (cos8_t((i * (1 + 2 * (s.speed >> 5)) + thatPhase) & 0xFF) >> 1);
    const bright = qsub8(ci, beatsin8_t(7, 0, 128 - (s.intensity >> 1)));
    s.setPixelColor(i, s.color_from_palette(ci, false, false, 0, bright));
  }
}

const PACIFICA_1 = [0x000507, 0x000409, 0x00030B, 0x00030D, 0x000210, 0x000212, 0x000114, 0x000117, 0x000019, 0x00001C, 0x000026, 0x000031, 0x00003B, 0x000046, 0x14554B, 0x28AA50];
const PACIFICA_2 = [0x000507, 0x000409, 0x00030B, 0x00030D, 0x000210, 0x000212, 0x000114, 0x000117, 0x000019, 0x00001C, 0x000026, 0x000031, 0x00003B, 0x000046, 0x0C5F52, 0x19BE5F];
const PACIFICA_3 = [0x000208, 0x00030E, 0x000514, 0x00061A, 0x000820, 0x000927, 0x000B2D, 0x000C33, 0x000E39, 0x001040, 0x001450, 0x001860, 0x001C70, 0x002080, 0x1040BF, 0x2060FF];
const asPalette = (list) => list.map((v) => [(v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF]);
const PAC = [asPalette(PACIFICA_1), asPalette(PACIFICA_2), asPalette(PACIFICA_3)];

function pacifica_one_layer(s, i, pal, cistart, wavescale, bri, ioff) {
  let ci = cistart & 0xFFFF;
  const half = (wavescale >> 1) + 20;
  const waveangle = (ioff + (120 + s.intensity) * i) & 0xFFFF;
  const s16 = sin16_t(waveangle) + 32768;
  const cs = scale16(s16, half) + half;
  ci = (ci + cs * i) & 0xFFFF;
  const sindex8 = scale16(sin16_t(ci) + 32768, 240);
  return ColorFromPalette(pal, sindex8, bri, true);
}
function mode_pacifica(s) {
  const nowOld = strip.now;
  const [p1, p2, p3] = s.palette ? [s.pal, s.pal, s.pal] : PAC;
  let c1 = s.aux0 & 0xFFFF, c2 = s.aux1 & 0xFFFF, c3 = s.step & 0xFFFF, c4 = (s.step >>> 16) & 0xFFFF;
  const deltams = (FRAMETIME >> 2) + ((FRAMETIME * s.speed) >> 7);
  strip.now = (Math.floor(strip.now / 4) + Math.floor((strip.now * s.speed) / 128)) >>> 0;
  const sf1 = beatsin16_t(3, 179, 269), sf2 = beatsin16_t(4, 179, 269);
  const d1 = Math.floor((deltams * sf1) / 256), d2 = Math.floor((deltams * sf2) / 256), d21 = Math.floor((d1 + d2) / 2);
  c1 = (c1 + d1 * beatsin88_t(1011, 10, 13)) & 0xFFFF;
  c2 = (c2 - d21 * beatsin88_t(777, 8, 11)) & 0xFFFF;
  c3 = (c3 - d1 * beatsin88_t(501, 5, 7)) & 0xFFFF;
  c4 = (c4 - d2 * beatsin88_t(257, 4, 6)) & 0xFFFF;
  s.aux0 = c1; s.aux1 = c2; s.step = ((c4 << 16) | c3) >>> 0;
  const basethreshold = beatsin8_t(9, 55, 65);
  let wave = beat8(7);
  for (let i = 0; i < s.len; i++) {
    let c = [2, 6, 10];
    c = addCRGB(c, pacifica_one_layer(s, i, p1, c1, beatsin16_t(3, 11 * 256, 14 * 256), beatsin8_t(10, 70, 130), (0 - beat16(301)) & 0xFFFF));
    c = addCRGB(c, pacifica_one_layer(s, i, p2, c2, beatsin16_t(4, 6 * 256, 9 * 256), beatsin8_t(17, 40, 80), beat16(401)));
    c = addCRGB(c, pacifica_one_layer(s, i, p3, c3, 6 * 256, beatsin8_t(9, 10, 38), (0 - beat16(503)) & 0xFFFF));
    c = addCRGB(c, pacifica_one_layer(s, i, p3, c4, 5 * 256, beatsin8_t(8, 10, 28), beat16(601)));
    const threshold = scale8(sin8_t(wave & 0xFF), 20) + basethreshold;
    wave += 7;
    const l = getAverageLight(c);
    if (l > threshold) {
      const over = l - threshold, over2 = qadd8(over, over);
      c = addCRGB(c, [over, over2, qadd8(over2, over2)]);
    }
    c[2] = scale8(c[2], 145);
    c[1] = scale8(c[1], 200);
    c = maxCRGB(c, [2, 5, 7]);
    s.setPixelColor(i, c[0], c[1], c[2]);
  }
  strip.now = nowOld;
}

// ---- More effects: some set their own pace by returning a delay in ms (none means the next frame) -----

const FLASH_COUNT = 4, MAX_COMETS = 8, ULTRAWHITE = 0xFFFFFFFF;
const speedFormulaL = (s) => 5 + Math.floor((50 * (255 - s.speed)) / s.len);

function tristate_square8(x, pulsewidth, attdec) {
  x &= 0xFF;
  let a = 127;
  if (x > 127) { a = -127; x -= 127; }
  if (x < attdec) return Math.trunc((x * a) / attdec);
  if (x < pulsewidth - attdec) return a;
  if (x < pulsewidth) return Math.trunc(((pulsewidth - x) * a) / attdec);
  return 0;
}

function mode_random_color(s) {
  const cycleTime = 200 + (255 - s.speed) * 50;
  const it = Math.floor(strip.now / cycleTime), rem = strip.now % cycleTime;
  const fadedur = (cycleTime * s.intensity) >> 8;
  let fade = 255;
  if (fadedur) fade = Math.min(255, Math.floor((rem * 255) / fadedur));
  if (s.call === 0) { s.aux0 = random8(); s.step = 2; }
  if (it !== s.step) { s.aux1 = s.aux0; s.aux0 = get_random_wheel_index(s.aux0); s.step = it; }
  s.fill(color_blend(s.color_wheel(s.aux1), s.color_wheel(s.aux0), fade));
}

function mode_dynamic(s) {
  s.allocateData(s.len);
  if (s.call === 0) for (let i = 0; i < s.len; i++) s.data[i] = random8();
  const cycleTime = 50 + (255 - s.speed) * 15;
  const it = Math.floor(strip.now / cycleTime);
  if (it !== s.step && s.speed !== 0) {
    for (let i = 0; i < s.len; i++) if (random8() <= s.intensity) s.data[i] = random8();
    s.step = it;
  }
  for (let i = 0; i < s.len; i++) {
    if (s.check1) s.blendPixelColor(i, s.color_wheel(s.data[i]), 16);
    else s.setPixelColor(i, s.color_wheel(s.data[i]));
  }
}

function dissolve(s, color) {
  if (!s.state) s.state = new Uint32Array(s.len);
  const pixels = s.state;
  if (s.call === 0) { pixels.fill(s.SEGCOLOR(1)); s.aux0 = 1; }
  for (let j = 0; j <= Math.floor(s.len / 15); j++) {
    if (random8() <= s.intensity) {
      for (let times = 0; times < 10; times++) {
        const i = random16(s.len);
        if (s.aux0) {
          if (pixels[i] === s.SEGCOLOR(1)) {
            pixels[i] = color === s.SEGCOLOR(0) ? s.color_from_palette(i, true, false, 0) : color;
            break;
          }
        } else if (pixels[i] !== s.SEGCOLOR(1)) { pixels[i] = s.SEGCOLOR(1); break; }
      }
    }
  }
  for (let i = 0; i < s.len; i++) s.setPixelColor(i, pixels[i]);
  if (s.step > 255 - s.speed + 15) { s.aux0 = s.aux0 ? 0 : 1; s.step = 0; } else s.step++;
}

function sparkle_flash(s, hyper) {
  if (!s.check2) for (let i = 0; i < s.len; i++) s.setPixelColor(i, s.color_from_palette(i, true, false, 0));
  if (((strip.now - s.aux0) >>> 0) > s.step) {
    if (random8((255 - s.intensity) >> 4) === 0) {
      const n = hyper ? Math.max(1, Math.floor(s.len / 3)) : 1;
      for (let i = 0; i < n; i++) s.setPixelColor(random16(s.len), s.SEGCOLOR(1));
    }
    s.step = strip.now;
    s.aux0 = 255 - s.speed;
  }
}

function mode_multi_strobe(s) {
  for (let i = 0; i < s.len; i++) s.setPixelColor(i, s.color_from_palette(i, true, false, 1));
  s.aux0 = 50 + 20 * (255 - s.speed);
  const count = 2 * (Math.floor(s.intensity / 10) + 1);
  if (s.aux1 < count) {
    if ((s.aux1 & 1) === 0) { s.fill(s.SEGCOLOR(0)); s.aux0 = 15; } else s.aux0 = 50;
  }
  if (((strip.now - s.aux0) >>> 0) > s.step) {
    s.aux1++;
    if (s.aux1 > count) s.aux1 = 0;
    s.step = strip.now;
  }
}

function mode_android(s) {
  for (let i = 0; i < s.len; i++) s.setPixelColor(i, s.color_from_palette(i, true, false, 1));
  if (s.aux1 > Math.floor((s.intensity * s.len) / 255)) s.aux0 = 1;
  else if (s.aux1 < 2) s.aux0 = 0;
  let a = s.step & 0xFFFF;
  if (s.aux0 === 0) { if (s.call % 3 === 1) a++; else s.aux1++; } else { a++; if (s.call % 3 !== 1) s.aux1 = (s.aux1 - 1) & 0xFFFF; }
  if (a >= s.len) a = 0;
  if (a + s.aux1 < s.len) {
    for (let i = a; i < a + s.aux1; i++) s.setPixelColor(i, s.SEGCOLOR(0));
  } else {
    for (let i = a; i < s.len; i++) s.setPixelColor(i, s.SEGCOLOR(0));
    for (let i = 0; i < s.aux1 - (s.len - a); i++) s.setPixelColor(i, s.SEGCOLOR(0));
  }
  s.step = a;
  return 3 + Math.floor((8 * (255 - s.speed)) / s.len);
}

function mode_chase_rainbow(s) {
  const sep = Math.floor(256 / s.len) || 1;
  const color = s.color_wheel((s.step * sep + (s.call & 0xFF)) & 0xFF);
  chase(s, color, s.SEGCOLOR(0), s.SEGCOLOR(1), false);
}

function mode_chase_flash(s) {
  if (s.len === 1) return mode_static(s);
  const flashStep = s.call % (FLASH_COUNT * 2 + 1);
  for (let i = 0; i < s.len; i++) s.setPixelColor(i, s.color_from_palette(i, true, false, 0));
  let delay = 10 + Math.floor((30 * (255 - s.speed)) / s.len);
  if (flashStep < FLASH_COUNT * 2) {
    if (flashStep % 2 === 0) {
      s.setPixelColor(s.step, s.SEGCOLOR(1));
      s.setPixelColor((s.step + 1) % s.len, s.SEGCOLOR(1));
      delay = 20;
    } else delay = 30;
  } else s.step = (s.step + 1) % s.len;
  return delay;
}

function mode_chase_flash_random(s) {
  if (s.len === 1) return mode_static(s);
  const flashStep = s.call % (FLASH_COUNT * 2 + 1);
  for (let i = 0; i < s.aux1; i++) s.setPixelColor(i, s.color_wheel(s.aux0));
  let delay = 1 + Math.floor((10 * (255 - s.speed)) / s.len);
  if (flashStep < FLASH_COUNT * 2) {
    const n = s.aux1, m = (s.aux1 + 1) % s.len;
    if (flashStep % 2 === 0) {
      s.setPixelColor(n, s.SEGCOLOR(0)); s.setPixelColor(m, s.SEGCOLOR(0));
      delay = 20;
    } else {
      s.setPixelColor(n, s.color_wheel(s.aux0)); s.setPixelColor(m, s.SEGCOLOR(1));
      delay = 30;
    }
  } else {
    s.aux1 = (s.aux1 + 1) % s.len;
    if (s.aux1 === 0) s.aux0 = get_random_wheel_index(s.aux0);
  }
  return delay;
}

function mode_chase_rainbow_white(s) {
  const n = s.step & 0xFFFF, m = (n + 1) % s.len;
  const color2 = s.color_wheel((Math.floor((n * 256) / s.len) + (s.call & 0xFF)) & 0xFF);
  const color3 = s.color_wheel((Math.floor((m * 256) / s.len) + (s.call & 0xFF)) & 0xFF);
  chase(s, s.SEGCOLOR(0), color2, color3, false);
}

function mode_colorful(s) {
  let numColors = 4;
  const cols = [0xFF0000, 0xEEBB00, 0x00EE00, 0x0077CC, 0, 0, 0, 0, 0];
  if (s.intensity > 160 || s.palette) {
    if (!s.palette) { numColors = 3; for (let i = 0; i < 3; i++) cols[i] = s.SEGCOLOR(i); } else {
      let fac = 80;
      if (s.palette === 52) { numColors = 5; fac = 61; }
      for (let i = 0; i < numColors; i++) cols[i] = s.color_from_palette(i * fac, false, true, 255);
    }
  } else if (s.intensity < 80) { cols[0] = 0xFF8040; cols[1] = 0xE5D241; cols[2] = 0x77FF77; cols[3] = 0x77F0F0; }
  for (let i = numColors; i < numColors * 2 - 1; i++) cols[i] = cols[i - numColors];
  const cycleTime = 50 + 8 * (255 - s.speed);
  const it = Math.floor(strip.now / cycleTime);
  if (it !== s.step) {
    if (s.speed > 0) s.aux0++;
    if (s.aux0 >= numColors) s.aux0 = 0;
    s.step = it;
  }
  for (let i = 0; i < s.len; i += numColors) for (let j = 0; j < numColors; j++) s.setPixelColor(i + j, cols[s.aux0 + j]);
}

function mode_traffic_light(s) {
  if (s.len === 1) return mode_static(s);
  for (let i = 0; i < s.len; i++) s.setPixelColor(i, s.color_from_palette(i, true, false, 1));
  let mdelay = 500;
  const long = 150 + 100 * (255 - s.speed), short = 150 + 20 * (255 - s.speed);
  for (let i = 0; i < s.len - 2; i += 3) {
    switch (s.aux0) {
      case 0: s.setPixelColor(i, 0xFF0000); mdelay = long; break;
      case 1: s.setPixelColor(i, 0xFF0000); mdelay = short; s.setPixelColor(i + 1, 0xEECC00); break;
      case 2: s.setPixelColor(i + 2, 0x00FF00); mdelay = long; break;
      case 3: s.setPixelColor(i + 1, 0xEECC00); mdelay = short; break;
    }
  }
  if (strip.now - s.step > mdelay) {
    s.aux0++;
    if (s.aux0 === 1 && s.intensity > 140) s.aux0 = 2;
    if (s.aux0 > 3) s.aux0 = 0;
    s.step = strip.now;
  }
}

function mode_running_random(s) {
  const cycleTime = 25 + 3 * (255 - s.speed);
  const it = Math.floor(strip.now / cycleTime);
  if (s.call === 0) s.aux0 = random16();
  const zoneSize = ((255 - s.intensity) >> 4) + 1;
  let prng = s.aux0;
  let z = it % zoneSize;
  let nzone = !z && it !== s.aux1;
  for (let i = s.len - 1; i >= 0; i--) {
    if (nzone || z >= zoneSize) {
      const lastrand = prng >> 8;
      let diff = 0;
      while (Math.abs(diff) < 42) {
        prng = (prng * 2053 + 13849) & 0xFFFF;
        diff = (prng >> 8) - lastrand;
      }
      if (nzone) { s.aux0 = prng; nzone = false; }
      z = 0;
    }
    s.setPixelColor(i, s.color_wheel(prng >> 8));
    z++;
  }
  s.aux1 = it & 0xFFFF;
}

function mode_comet(s) {
  if (s.len === 1) return mode_static(s);
  const counter = (strip.now * ((s.speed >> 2) + 1)) & 0xFFFF;
  const index = (counter * s.len) >> 16;
  if (s.call === 0) s.aux0 = index;
  s.fade_out(s.intensity);
  s.setPixelColor(index, s.color_from_palette(index, true, false, 0));
  if (index > s.aux0) {
    for (let i = s.aux0; i < index; i++) s.setPixelColor(i, s.color_from_palette(i, true, false, 0));
  } else if (index < s.aux0 && index < 10) {
    for (let i = 0; i < index; i++) s.setPixelColor(i, s.color_from_palette(i, true, false, 0));
  }
  s.aux0 = index;
}

function mode_fire_flicker(s) {
  const cycleTime = 40 + (255 - s.speed);
  const it = Math.floor(strip.now / cycleTime);
  if (s.step === it) return;
  const c = s.SEGCOLOR(0);
  const w = W(c), r = R(c), g = G(c), b = B(c);
  let lum = s.palette === 0 ? Math.max(w, r, g, b) : 255;
  lum = Math.floor(lum / (Math.floor((256 - s.intensity) / 16) + 1));
  for (let i = 0; i < s.len; i++) {
    const flicker = random8(lum);
    if (s.palette === 0) s.setPixelColor(i, Math.max(r - flicker, 0), Math.max(g - flicker, 0), Math.max(b - flicker, 0), Math.max(w - flicker, 0));
    else s.setPixelColor(i, s.color_from_palette(i, true, false, 0, 255 - flicker));
  }
  s.step = it;
}

function gradient_base(s, loading) {
  if (s.len === 1) return mode_static(s);
  const counter = (strip.now * ((s.speed >> 2) + 1)) & 0xFFFF;
  let pp = (counter * s.len) >> 16;
  if (s.call === 0) pp = 0;
  const brd = s.intensity >> 1; // "1 + loading ? a : b" in WLED is always a
  const p1 = pp - s.len, p2 = pp + s.len;
  for (let i = 0; i < s.len; i++) {
    let val = loading ? Math.abs((i > pp ? p2 : pp) - i) : Math.min(Math.abs(pp - i), Math.abs(p1 - i), Math.abs(p2 - i));
    val = brd > val ? Math.floor((val * 255) / brd) : 255;
    s.setPixelColor(i, color_blend(s.SEGCOLOR(0), s.color_from_palette(i, true, false, 1), val));
  }
}

function police_base(s, color1, color2) {
  if (s.len === 1) return mode_static(s);
  const delay = 1 + Math.floor((FRAMETIME << 3) / s.len);
  const it = Math.floor(strip.now / map(s.speed, 0, 255, delay << 4, delay));
  const offset = it % s.len;
  const width = ((s.len * (s.intensity + 1)) >> 9) || 1;
  for (let i = 0; i < width; i++) {
    s.setPixelColor((offset + i) % s.len, color1);
    s.setPixelColor((offset + i + (s.len >> 1)) % s.len, color2);
  }
}

function tricolor_chase(s, color1, color2) {
  const cycleTime = 50 + ((255 - s.speed) << 1);
  const it = Math.floor(strip.now / cycleTime);
  const width = 1 + (s.intensity >> 4);
  let index = it % (width * 3);
  for (let i = 0; i < s.len; i++, index++) {
    if (index > width * 3 - 1) index = 0;
    let color = color1;
    if (index > (width << 1) - 1) color = s.color_from_palette(i, true, false, 1);
    else if (index > width - 1) color = color2;
    s.setPixelColor(s.len - i - 1, color);
  }
}

function mode_tricolor_wipe(s) {
  const cycleTime = 1000 + (255 - s.speed) * 200;
  const perc = strip.now % cycleTime;
  const prog = Math.floor((perc * 65535) / cycleTime);
  const ledIndex = Math.floor((prog * s.len * 3) / 65536);
  for (let i = 0; i < s.len; i++) s.setPixelColor(i, s.color_from_palette(i, true, false, 2));
  if (ledIndex < s.len) {
    for (let i = 0; i < s.len; i++) s.setPixelColor(i, i > ledIndex ? s.SEGCOLOR(0) : s.SEGCOLOR(1));
  } else if (ledIndex < s.len * 2) {
    for (let i = ledIndex - s.len + 1; i < s.len; i++) s.setPixelColor(i, s.SEGCOLOR(1));
  } else {
    for (let i = 0; i <= ledIndex - s.len * 2; i++) s.setPixelColor(i, s.SEGCOLOR(0));
  }
}

function mode_tricolor_fade(s) {
  const counter = (strip.now * ((s.speed >> 3) + 1)) & 0xFFFF;
  const prog = (counter * 768) >> 16;
  const stage = prog < 256 ? 0 : prog < 512 ? 1 : 2;
  const color1 = s.SEGCOLOR(stage), color2 = s.SEGCOLOR((stage + 1) % 3);
  const stp = prog & 0xFF;
  for (let i = 0; i < s.len; i++) {
    let color;
    if (stage === 2) color = color_blend(s.color_from_palette(i, true, false, 2), color2, stp);
    else if (stage === 1) color = color_blend(color1, s.color_from_palette(i, true, false, 2), stp);
    else color = color_blend(color1, color2, stp);
    s.setPixelColor(i, color);
  }
}

function mode_icu(s) {
  let dest = s.step & 0xFFFF;
  const space = (s.intensity >> 3) + 2;
  const gap = Math.floor(s.len / space);
  if (!s.check2) s.fill(s.SEGCOLOR(1));
  const pindex = map(dest, 0, s.len - gap, 0, 255) & 0xFF;
  const col = s.color_from_palette(pindex, false, false, 0);
  s.setPixelColor(dest, col);
  s.setPixelColor(dest + gap, col);
  if (s.aux0 === dest) {
    if (random8(6) === 0) {
      s.setPixelColor(dest, s.SEGCOLOR(1));
      s.setPixelColor(dest + gap, s.SEGCOLOR(1));
      return 200;
    }
    s.aux0 = random16(s.len - gap);
    return 1000 + random16(2000);
  }
  if (s.aux0 > s.step) { s.step++; dest++; } else if (s.aux0 < s.step) { s.step--; dest--; }
  s.setPixelColor(dest, col);
  s.setPixelColor(dest + gap, col);
  return speedFormulaL(s);
}

function mode_multi_comet(s) {
  const cycleTime = 10 + (255 - s.speed);
  const it = Math.floor(strip.now / cycleTime);
  if (s.step === it) return;
  if (!s.state) s.state = new Uint16Array(MAX_COMETS);
  const comets = s.state;
  s.fade_out((s.intensity >> 1) + 128);
  for (let i = 0; i < MAX_COMETS; i++) {
    if (comets[i] < s.len) {
      const index = comets[i];
      if (s.SEGCOLOR(2) !== 0) s.setPixelColor(index, i % 2 ? s.color_from_palette(index, true, false, 0) : s.SEGCOLOR(2));
      else s.setPixelColor(index, s.color_from_palette(index, true, false, 0));
      comets[i]++;
    } else if (!random16(s.len)) comets[i] = 0;
  }
  s.step = it;
}

function mode_random_chase(s) {
  if (s.call === 0) { s.step = RGBW32(random8(), random8(), random8(), 0); s.aux0 = random16(); }
  const prevSeed = getSeed();
  const cycleTime = 25 + 3 * (255 - s.speed);
  const it = Math.floor(strip.now / cycleTime);
  let color = s.step;
  setSeed(s.aux0);
  for (let i = s.len - 1; i >= 0; i--) {
    const r = random8(6) !== 0 ? (color >>> 16) & 0xFF : random8();
    const g = random8(6) !== 0 ? (color >>> 8) & 0xFF : random8();
    const b = random8(6) !== 0 ? color & 0xFF : random8();
    color = RGBW32(r, g, b, 0);
    s.setPixelColor(i, color);
    if (i === s.len - 1 && s.aux1 !== (it & 0xFFFF)) { s.step = color; s.aux0 = getSeed(); }
  }
  s.aux1 = it & 0xFFFF;
  setSeed(prevSeed);
}

function mode_oscillate(s) {
  const len = s.len;
  if (s.call === 0 || !s.state) {
    const size = (len >> 3) & 0xFF;
    s.state = [
      { pos: len >> 2, size, dir: 1, speed: 1 },
      { pos: ((len >> 2) * 3) & 0xFFFF, size, dir: 1, speed: 2 },
      { pos: ((len >> 2) * 2) & 0xFFFF, size, dir: -1, speed: 1 },
    ];
  }
  const cycleTime = 20 + 2 * (255 - s.speed);
  const it = Math.floor(strip.now / cycleTime);
  for (const o of s.state) {
    if (it !== s.step) o.pos = (o.pos + o.dir * o.speed) & 0xFFFF;
    o.size = Math.floor(len / (3 + (s.intensity >> 3))) & 0xFF;
    if (o.dir === -1 && o.pos > len << 1) { o.pos = 0; o.dir = 1; o.speed = s.speed > 100 ? random8(2, 4) : random8(1, 3); }
    if (o.dir === 1 && o.pos >= len - 1) { o.pos = len - 1; o.dir = -1; o.speed = s.speed > 100 ? random8(2, 4) : random8(1, 3); }
  }
  for (let i = 0; i < len; i++) {
    let color = BLACK;
    for (let j = 0; j < 3; j++) {
      const o = s.state[j];
      if (i >= o.pos - o.size && i <= o.pos + o.size) color = color === BLACK ? s.SEGCOLOR(j) : color_blend(color, s.SEGCOLOR(j), 128);
    }
    s.setPixelColor(i, color);
  }
  s.step = it;
}

function mode_pride_2015(s) {
  const duration = 10 + s.speed;
  let pseudo = s.step >>> 0, sHue16 = s.aux0 & 0xFFFF;
  const sat8 = beatsin88_t(87, 220, 250) & 0xFF;
  const brightdepth = beatsin88_t(341, 96, 224) & 0xFF;
  const thetaInc = beatsin88_t(203, 25 * 256, 40 * 256);
  const msmult = beatsin88_t(147, 23, 60);
  let hue16 = sHue16;
  const hueinc16 = beatsin88_t(113, 1, 3000);
  pseudo = (pseudo + duration * msmult) >>> 0;
  sHue16 = (sHue16 + duration * beatsin88_t(400, 5, 9)) >>> 0;
  let theta = pseudo;
  for (let i = 0; i < s.len; i++) {
    hue16 = (hue16 + hueinc16) >>> 0;
    const hue8 = (hue16 >>> 8) & 0xFF;
    theta = (theta + thetaInc) >>> 0;
    const b16 = sin16_t(theta & 0xFFFF) + 32768;
    const bri16 = Math.floor((b16 * b16) / 65536);
    const bri8 = (Math.floor((bri16 * brightdepth) / 65536) + (255 - brightdepth)) & 0xFF;
    s.blendPixelColor(i, fromCRGB(hsv2rgb_rainbow(hue8, sat8, bri8)), 64);
  }
  s.step = pseudo;
  s.aux0 = sHue16 & 0xFFFF;
}

function mode_bpm(s) {
  const stp = Math.floor(strip.now / 20) & 0xFF;
  const beat = beatsin8_t(s.speed, 64, 255);
  for (let i = 0; i < s.len; i++) s.setPixelColor(i, s.color_from_palette((stp + i * 2) & 0xFFFF, false, false, 0, (beat - stp + i * 10) & 0xFF));
}

function mode_static_pattern(s) {
  const lit = 1 + s.speed, unlit = 1 + s.intensity;
  let drawingLit = true, cnt = 0;
  for (let i = 0; i < s.len; i++) {
    s.setPixelColor(i, drawingLit ? s.color_from_palette(i, true, false, 0) : s.SEGCOLOR(1));
    if (++cnt >= (drawingLit ? lit : unlit)) { cnt = 0; drawingLit = !drawingLit; }
  }
}

function mode_tri_static_pattern(s) {
  const segSize = (s.intensity >> 5) + 1;
  let currSeg = 0, count = 0;
  for (let i = 0; i < s.len; i++) {
    s.setPixelColor(i, s.SEGCOLOR(currSeg % 3));
    if (++count >= segSize) { currSeg++; count = 0; }
  }
}

function spots_base(s, threshold) {
  if (s.len === 1) return mode_static(s);
  if (!s.check2) s.fill(s.SEGCOLOR(1));
  const maxZones = s.len >> 2;
  const zones = 1 + ((s.intensity * maxZones) >> 8);
  const zoneLen = Math.floor(s.len / zones);
  const offset = (s.len - zones * zoneLen) >> 1;
  for (let z = 0; z < zones; z++) {
    const pos = offset + z * zoneLen;
    for (let i = 0; i < zoneLen; i++) {
      const wave = triwave16(Math.floor((i * 0xFFFF) / zoneLen));
      if (wave > threshold) {
        const index = pos + i;
        const sv = Math.floor(((wave - threshold) * 255) / (0xFFFF - threshold));
        s.setPixelColor(index, color_blend(s.color_from_palette(index, true, false, 0), s.SEGCOLOR(1), 255 - sv));
      }
    }
  }
}

function mode_spots_fade(s) {
  const counter = strip.now * ((s.speed >> 2) + 8);
  const t = triwave16(counter & 0xFFFF);
  spots_base(s, (t >> 1) + (t >> 2));
}

function glitter_base(s, intensity, col = ULTRAWHITE) {
  if (intensity > random8()) s.setPixelColor(random16(s.len), col);
}

function mode_glitter(s) {
  if (!s.check2) {
    let counter = 0;
    if (s.speed !== 0) counter = ((strip.now * ((s.speed >> 3) + 1)) & 0xFFFF) >> 8;
    const noWrap = s.speed === 0;
    for (let i = 0; i < s.len; i++) {
      let ci = Math.floor((i * 255) / s.len) - counter;
      if (noWrap) ci = map(ci, 0, 255, 0, 240);
      s.setPixelColor(i, s.color_from_palette(ci & 0xFFFF, false, true, 255));
    }
  }
  glitter_base(s, s.intensity, s.SEGCOLOR(2) ? s.SEGCOLOR(2) : ULTRAWHITE);
}

function sinelon_base(s, dual, rainbow = false) {
  if (s.len === 1) return mode_static(s);
  s.fade_out(s.intensity);
  const pos = beatsin16_t(Math.floor(s.speed / 10), 0, s.len - 1);
  if (s.call === 0) s.aux0 = pos;
  let color1 = s.color_from_palette(pos, true, false, 0);
  let color2 = s.SEGCOLOR(2);
  if (rainbow) color1 = s.color_wheel((pos & 0x07) * 32);
  s.setPixelColor(pos, color1);
  if (dual) {
    if (!color2) color2 = s.color_from_palette(pos, true, false, 0);
    if (rainbow) color2 = color1;
    s.setPixelColor(s.len - 1 - pos, color2);
  }
  if (s.aux0 !== pos) {
    if (s.aux0 < pos) {
      for (let i = s.aux0; i < pos; i++) { s.setPixelColor(i, color1); if (dual) s.setPixelColor(s.len - 1 - i, color2); }
    } else {
      for (let i = s.aux0; i > pos; i--) { s.setPixelColor(i, color1); if (dual) s.setPixelColor(s.len - 1 - i, color2); }
    }
    s.aux0 = pos;
  }
}

function mode_percent(s) {
  const percent = Math.min(s.intensity, 200);
  const active = Math.round((s.len * (percent < 100 ? percent : 200 - percent)) / 100);
  const size = s.speed === 255 ? 255 : 1 + ((s.speed * s.len) >> 11);
  for (let i = 0; i < s.len; i++) {
    const lit = percent <= 100 ? i < s.aux1 : i >= s.len - s.aux1;
    if (!lit) s.setPixelColor(i, s.SEGCOLOR(1));
    else if (s.check1) s.setPixelColor(i, s.color_from_palette(percent <= 100 ? map(percent, 0, 100, 0, 255) : map(percent, 100, 200, 255, 0), false, false, 0));
    else s.setPixelColor(i, s.color_from_palette(i, true, false, 0));
  }
  if (active > s.aux1) { s.aux1 += size; if (s.aux1 > active) s.aux1 = active; } else if (active < s.aux1) {
    s.aux1 = s.aux1 > size ? s.aux1 - size : 0;
    if (s.aux1 < active) s.aux1 = active;
  }
}

function mode_heartbeat(s) {
  const bpm = 40 + (s.speed >> 3);
  const msPerBeat = Math.floor(60000 / bpm), secondBeat = Math.floor(msPerBeat / 3);
  const beatTimer = strip.now - s.step;
  s.aux1 = Math.floor((s.aux1 * 2042) / (2048 + s.intensity));
  if (beatTimer > secondBeat && !s.aux0) { s.aux1 = 0xFFFF; s.aux0 = 1; }
  if (beatTimer > msPerBeat) { s.aux1 = 0xFFFF; s.aux0 = 0; s.step = strip.now; }
  for (let i = 0; i < s.len; i++) s.setPixelColor(i, color_blend(s.color_from_palette(i, true, false, 0), s.SEGCOLOR(1), 255 - (s.aux1 >> 8)));
}

function mode_solid_glitter(s) {
  s.fill(s.SEGCOLOR(0));
  glitter_base(s, s.intensity, s.SEGCOLOR(2) ? s.SEGCOLOR(2) : ULTRAWHITE);
}

function phased_base(s, moder) { // WLED keeps the phase as a float in SEGENV.step
  if (s.call === 0 || typeof s.state !== "number") s.state = 0;
  const cutOff = 255 - s.intensity;
  let modVal = 5;
  let index = Math.floor(strip.now / 64);
  s.state = Math.fround(s.state + s.speed / 32);
  for (let i = 0; i < s.len; i++) {
    if (moder === 1) modVal = inoise8((i * 10 + i * 10) & 0xFFFF) >> 4;
    let val = (i + 1) * 16;
    if (modVal === 0) modVal = 1;
    val = Math.trunc(Math.fround(val + Math.fround((s.state * ((i % modVal) + 1)) / 2))) >>> 0;
    let b = cubicwave8(val & 0xFF);
    b = b > cutOff ? b - cutOff : 0;
    s.setPixelColor(i, color_blend(s.SEGCOLOR(1), s.color_from_palette(index & 0xFFFF, false, false, 0), b));
    index += Math.floor(256 / s.len);
    if (s.len > 256) index++;
  }
}

function mode_twinkleup(s) {
  const prevSeed = getSeed();
  setSeed(535);
  for (let i = 0; i < s.len; i++) {
    const ranstart = random8();
    let pixBri = sin8_t((ranstart + Math.floor(((16 * strip.now) >>> 0) / (256 - s.speed))) & 0xFF);
    if (random8() > s.intensity) pixBri = 0;
    s.setPixelColor(i, color_blend(s.SEGCOLOR(1), s.color_from_palette((random8() + Math.floor(strip.now / 100)) & 0xFFFF, false, false, 0), pixBri));
  }
  setSeed(prevSeed);
}

function mode_sinewave(s) {
  const colorIndex = Math.floor(strip.now / 32);
  s.step = (s.step + (s.speed >> 4)) >>> 0;
  const freq = s.intensity >> 2;
  for (let i = 0; i < s.len; i++) {
    const pixBri = cubicwave8((i * freq + s.step) & 0xFF);
    s.setPixelColor(i, color_blend(s.SEGCOLOR(1), s.color_from_palette(Math.floor(((i * colorIndex) >>> 0) / 255) & 0xFFFF, false, false, 0), pixBri));
  }
}

function mode_washing_machine(s) {
  const speed = tristate_square8((strip.now >>> 7) & 0xFF, 90, 15);
  s.step = (s.step + Math.trunc((speed * 2048) / (512 - s.speed))) >>> 0;
  for (let i = 0; i < s.len; i++) {
    const col = sin8_t((Math.floor(((Math.floor(s.intensity / 25) + 1) * 255 * i) / s.len) + (s.step >>> 7)) & 0xFF);
    s.setPixelColor(i, s.color_from_palette(col, false, false, 3));
  }
}

function mode_blends(s) {
  const pixelLen = Math.min(s.len, 255);
  if (!s.state || s.state.length !== pixelLen + 1) s.state = new Uint32Array(pixelLen + 1);
  const pixels = s.state;
  const blendSpeed = map(s.intensity, 0, 255, 10, 128);
  let shift = ((strip.now * ((s.speed >> 3) + 1)) >>> 0) >>> 8;
  for (let i = 0; i < pixelLen; i++) {
    pixels[i] = color_blend(pixels[i], s.color_from_palette((shift + quadwave8((i + 1) * 16)) & 0xFFFF, false, true, 255), blendSpeed);
    shift += 3;
  }
  let offset = 0;
  for (let i = 0; i < s.len; i++) {
    s.setPixelColor(i, pixels[offset++]);
    if (offset > pixelLen) offset = 0;
  }
}

// ---- Noise, physics and the rest of WLED's 1D effects --------------------------------------------------
// WLED does some of these in 32-bit floats; the preview uses JavaScript's numbers, which can differ in
// the last digit but not in what you see.

const W_MAX_COUNT = 20, W_MAX_SPEED = 6, W_WIDTH_FACTOR = 6; // ESP32 build
const FLASHERS_PER_ZONE = 6, MAX_SHIMMER = 92, IBN = 5100, MAX_RIPPLES = 100;
const SPOT_MAX_COUNT = 49, SPOT_TYPES_COUNT = 6, MAX_NUM_POPCORN = 21;
const FAIR_DATA_PER_SEG = 1280, SPARK_SIZE = 20; // ESP32: MAX_SEGMENT_DATA / 32 segments; sizeof(spark)
const crgbAdd = (a, b) => addCRGB(a, b);

function blur1d(s, amount, smear = false) {
  if (amount === 0) return;
  const keep = smear ? 255 : 255 - amount, seep = amount >> (1 + (smear ? 1 : 0));
  let carryover = BLACK, lastnew = 0, last = 0, curnew = BLACK;
  for (let i = 0; i < s.len; i++) {
    const cur = s.getPixelColor(i), part = color_fade(cur, seep);
    curnew = color_fade(cur, keep);
    if (i > 0) {
      if (carryover) curnew = color_add(curnew, carryover, true);
      const prev = color_add(lastnew, part, true);
      if (last !== prev) s.setPixelColor(i - 1, prev);
    } else s.setPixelColor(i, curnew);
    lastnew = curnew;
    last = cur;
    carryover = part;
  }
  s.setPixelColor(s.len - 1, curnew);
}

// Aurora (38)
function auroraInit(w, len, color) {
  w.ttl = random16(500, 1501);
  w.base = color;
  w.alpha = random8(60, 101) / 100;
  w.age = 0;
  w.width = random16(Math.floor(len / 20), Math.floor(len / W_WIDTH_FACTOR)) || 1;
  w.center = (random8(101) / 100) * len;
  w.left = random8(0, 2) === 0;
  w.speed = ((random8(10, 31) / 100) * W_MAX_SPEED) / 255;
  w.alive = true;
}
function auroraColor(w, i) {
  if (i < w.center - w.width || i > w.center + w.width) return null;
  const offsetFactor = Math.abs(i - w.center) / w.width;
  const ageFactor = w.age / w.ttl < 0.5 ? w.age / Math.floor(w.ttl / 2) : (w.ttl - w.age) / (w.ttl * 0.5);
  const f = (1 - offsetFactor) * ageFactor * w.alpha;
  return w.base.map((v) => Math.trunc(v * f) & 0xFF);
}
function mode_aurora(s) {
  const newWave = (w) => auroraInit(w, s.len, crgb(s.color_from_palette(random8(), false, false, random8(0, 3))));
  if (s.aux0 !== s.intensity || s.call === 0) {
    s.aux1 = map(s.intensity, 0, 255, 2, W_MAX_COUNT);
    s.aux0 = s.intensity;
    s.state = Array.from({ length: s.aux1 }, () => ({}));
    for (const w of s.state) newWave(w);
  }
  for (const w of s.state) {
    w.center += (w.left ? -1 : 1) * w.speed * s.speed;
    w.age++;
    if (w.age > w.ttl) w.alive = false;
    else if (w.left ? w.center + w.width < 0 : w.center - w.width > s.len) w.alive = false;
    if (!w.alive) newWave(w);
  }
  const back = 1 + (s.SEGCOLOR(0) ? 1 : 0) + (s.SEGCOLOR(1) ? 1 : 0) + (s.SEGCOLOR(2) ? 1 : 0);
  for (let i = 0; i < s.len; i++) {
    let mixed = [back, back, back];
    for (const w of s.state) {
      const c = auroraColor(w, i);
      if (c && (c[0] || c[1] || c[2])) mixed = crgbAdd(mixed, c);
    }
    s.setPixelColor(i, mixed[0], mixed[1], mixed[2]);
  }
}

// Fireworks (42) and Rain (43)
function mode_fireworks(s) {
  if (s.len === 1) return mode_static(s);
  const width = s.len;
  if (s.call === 0) { s.aux0 = 0xFFFF; s.aux1 = 0xFFFF; }
  s.fade_out(128);
  if (!s.step) {
    const valid1 = s.aux0 < width, valid2 = s.aux1 < width;
    const sv1 = valid1 ? s.getPixelColor(s.aux0) : 0, sv2 = valid2 ? s.getPixelColor(s.aux1) : 0;
    blur1d(s, 16);
    if (valid1) s.setPixelColor(s.aux0, sv1);
    if (valid2) s.setPixelColor(s.aux1, sv2);
  }
  for (let i = 0; i < Math.max(1, Math.floor(width / 20)); i++) {
    if (random8(129 - (s.intensity >> 1)) === 0) {
      const index = random16(width);
      s.setPixelColor(index, s.color_from_palette(random8(), false, false, 0));
      s.aux1 = s.aux0;
      s.aux0 = index;
    }
  }
}
function mode_rain(s) {
  if (s.len === 1) return mode_static(s);
  s.step += FRAMETIME;
  if (s.call && s.step > speedFormulaL(s)) {
    s.step = 1;
    const ctemp = s.getPixelColor(0);
    for (let i = 0; i < s.len - 1; i++) s.setPixelColor(i, s.getPixelColor(i + 1));
    s.setPixelColor(s.len - 1, ctemp);
    s.aux0 = (s.aux0 + 1) & 0xFFFF;
    s.aux1 = (s.aux1 + 1) & 0xFFFF;
    if (s.aux0 === 0) s.aux0 = 0xFFFF;
    if (s.aux1 === 0) s.aux0 = 0xFFFF; // sic
    if (s.aux0 >= s.len) s.aux0 = 0;
    if (s.aux1 >= s.len) s.aux1 = 0;
  }
  return mode_fireworks(s);
}

// Tetrix (44)
function mode_tetrix(s) {
  if (s.len === 1) return mode_static(s);
  if (!s.state) s.state = { pos: 0, speed: 0, col: 0, brick: 0, stack: 0, step: 0 };
  const d = s.state;
  if (s.call === 0) { d.stack = 0; d.step = strip.now + 2000; if (s.check1) d.col = 0; }
  if (d.step === 0) {
    let speed = s.speed ? s.speed : random8(1, 255);
    speed = map(speed, 1, 255, 5000, 250);
    d.speed = (s.len * FRAMETIME) / speed;
    d.pos = s.len;
    if (!s.check1) d.col = (random8(0, 15) << 4) & 0xFF;
    d.step = 1;
    d.brick = ((s.intensity ? (s.intensity >> 5) + 1 : random8(1, 5)) * (1 + (s.len >> 6))) & 0xFFFF;
  }
  if (d.step === 1 && random8() >> 6) d.step = 2;
  if (d.step === 2) {
    if (d.pos > d.stack) {
      d.pos -= d.speed;
      if (Math.trunc(d.pos) < d.stack) d.pos = d.stack;
      for (let i = Math.trunc(d.pos); i < s.len; i++) {
        s.setPixelColor(i, i < Math.trunc(d.pos) + d.brick ? s.color_from_palette(d.col, false, false, 0) : s.SEGCOLOR(1));
      }
    } else {
      d.step = 0;
      d.stack = (d.stack + d.brick) & 0xFFFF;
      if (d.stack >= s.len) d.step = strip.now + 2000;
    }
  }
  if (d.step > 2) {
    d.brick = 0;
    if (d.step > strip.now) { for (let i = 0; i < s.len; i++) s.blendPixelColor(i, s.SEGCOLOR(1), 25); } else {
      d.stack = 0;
      d.step = 0;
      if (s.check1) d.col = (d.col + 8) & 0xFF;
    }
  }
}

// Rolling Balls (48)
function mode_rolling_balls(s) {
  const maxNumBalls = 16;
  const numBalls = (s.intensity >> 4) + 1;
  const hasCol2 = !!s.SEGCOLOR(2);
  if (s.call === 0 || !s.state) {
    s.fill(hasCol2 ? BLACK : s.SEGCOLOR(1));
    s.state = [];
    for (let i = 0; i < maxNumBalls; i++) {
      const b = { last: strip.now, velocity: (20 * random16(1000, 10000)) / 10000, height: 0, mass: 0 };
      if (random8() < 128) b.velocity = -b.velocity;
      b.height = random16(0, 10000) / 10000;
      b.mass = random16(1000, 10000) / 10000;
      s.state.push(b);
    }
  }
  const balls = s.state;
  const cfac = (scale8(8, 255 - s.speed) + 1) * 20000;
  if (s.check3) s.fade_out(250);
  else if (!s.check2) s.fill(hasCol2 ? BLACK : s.SEGCOLOR(1));
  for (let i = 0; i < numBalls; i++) {
    const bi = balls[i];
    let h = bi.height + (bi.velocity * (strip.now - bi.last)) / cfac;
    if (h < -0.5 || h > 1.5) { h = bi.height = random16(0, 10000) / 10000; bi.last = strip.now; }
    if ((h <= 0 && bi.velocity < 0) || (h >= 1 && bi.velocity > 0)) { bi.velocity = -bi.velocity; bi.last = strip.now; bi.height = h; }
    if (s.check1) {
      for (let j = i + 1; j < numBalls; j++) {
        const bj = balls[j];
        if (bj.velocity !== bi.velocity) {
          const tc = (cfac * (bi.height - bj.height) + bi.velocity * (bj.last - bi.last)) / (bj.velocity - bi.velocity);
          if (tc > 2 && tc < strip.now - bj.last) {
            bi.height += (bi.velocity * (tc + (bj.last - bi.last))) / cfac;
            bj.height = bi.height;
            bi.last = Math.trunc(tc + 0.5) + bj.last;
            bj.last = bi.last;
            const v = bi.velocity;
            bi.velocity = ((bi.mass - bj.mass) * v + 2 * bj.mass * bj.velocity) / (bi.mass + bj.mass);
            bj.velocity = ((bj.mass - bi.mass) * bj.velocity + 2 * bi.mass * v) / (bi.mass + bj.mass);
            h = bi.height + (bi.velocity * (strip.now - bi.last)) / cfac;
          }
        }
      }
    }
    let color = s.SEGCOLOR(0);
    if (s.palette) color = s.color_from_palette(Math.floor((i * 255) / numBalls), false, false, 0);
    else if (hasCol2) color = s.SEGCOLOR(i % NUM_COLORS);
    h = Math.min(1, Math.max(0, h));
    s.setPixelColor(Math.round(h * (s.len - 1)), color);
    bi.last = strip.now;
    bi.height = h;
  }
}

// Fairy (49) and Fairytwinkle (51)
const nextPrng = (v) => (v * 2053 + 1384) & 0xFFFF;
function mode_fairy(s) {
  let prng = 5100;
  for (let i = 0; i < s.len; i++) { prng = nextPrng(prng); s.setPixelColor(i, s.color_from_palette(prng >> 8, false, false, 0)); }
  if (s.intensity === 0) return;
  const dist = Math.floor((255 - s.intensity) / 28) + 1;
  const numFlashers = Math.floor(s.len / dist) + 1;
  if (!s.state || s.state.length !== numFlashers) s.state = Array.from({ length: numFlashers }, () => ({ start: 0, dur: 0, on: false }));
  const fl = s.state;
  const now16 = strip.now & 0xFFFF;
  const zones = Math.floor(numFlashers / FLASHERS_PER_ZONE) || 1;
  let inZone = Math.floor(numFlashers / zones);
  const bri = new Array(FLASHERS_PER_ZONE * 2 - 1).fill(0);
  for (let z = 0; z < zones; z++) {
    let sum = 0;
    const first = z * inZone;
    if (z === zones - 1) inZone = numFlashers - inZone * (zones - 1);
    for (let f = first; f < first + inZone; f++) {
      let t = (now16 - fl[f].start) & 0xFFFF;
      if (t > fl[f].dur * 10) {
        fl[f].on = !fl[f].on;
        fl[f].dur = fl[f].on ? 12 + random8(12 + ((255 - s.speed) >> 2)) : 20 + random8(6 + ((255 - s.speed) >> 2));
        fl[f].start = now16;
        if (t < 255) {
          fl[f].start = (fl[f].start - (255 - t)) & 0xFFFF;
          fl[f].dur = (fl[f].dur + 26 - Math.floor(t / 10)) & 0xFF;
          t = 255 - t;
        } else t = 0;
      }
      if (t > 255) t = 255;
      bri[f - first] = fl[f].on ? t : 255 - t;
      sum += bri[f - first];
    }
    const peak = 255 - ((Math.floor(sum / inZone) * MAX_SHIMMER) >> 8);
    for (let f = first; f < first + inZone; f++) {
      const b = Math.floor((bri[f - first] * peak) / 255);
      prng = nextPrng(prng);
      const pos = f * dist;
      s.setPixelColor(pos, color_blend(s.SEGCOLOR(1), s.color_from_palette(prng >> 8, false, false, 0), b));
      for (let i = pos + 1; i < pos + dist && i < s.len; i++) {
        prng = nextPrng(prng);
        s.setPixelColor(i, s.color_from_palette(prng >> 8, false, false, 0, peak));
      }
    }
  }
}
function mode_fairytwinkle(s) {
  if (!s.state || s.state.length !== s.len) s.state = Array.from({ length: s.len }, () => ({ start: 0, dur: 0, on: false }));
  const fl = s.state;
  const now16 = strip.now & 0xFFFF;
  let prng = 5100;
  const rise = 400 + (255 - s.speed) * 3;
  const maxDur = Math.floor(rise / 100) + ((255 - s.intensity) >> 2) + 13 + ((255 - s.intensity) >> 1);
  for (let f = 0; f < s.len; f++) {
    let t = (now16 - fl[f].start) & 0xFFFF;
    if (t > fl[f].dur * 100) {
      fl[f].on = !fl[f].on;
      const init = !fl[f].dur;
      fl[f].dur = (fl[f].on
        ? Math.floor(rise / 100) + ((255 - s.intensity) >> 2) + random8(12 + ((255 - s.intensity) >> 1)) + 1
        : Math.floor(rise / 100) + random8(3 + ((255 - s.speed) >> 6)) + 1) & 0xFF;
      fl[f].start = now16;
      t = 0;
      if (init) {
        fl[f].start = (fl[f].start - rise) & 0xFFFF;
        fl[f].dur = (Math.floor(rise / 100) + random8(12 + ((255 - s.intensity) >> 1)) + 5) & 0xFF;
        t = rise & 0xFFFF;
      }
    }
    if (fl[f].on && fl[f].dur > maxDur) fl[f].dur = maxDur & 0xFF;
    if (t > rise) t = rise;
    const fadeprog = 255 - Math.floor((t * 255) / rise);
    const b = fl[f].on ? 255 - gamma8(fadeprog) : gamma8(fadeprog);
    const lastR = prng;
    let diff = 0;
    while (diff < 0x4000) { prng = nextPrng(prng); diff = Math.abs(prng - lastR); }
    s.setPixelColor(f, color_blend(s.SEGCOLOR(1), s.color_from_palette(prng >> 8, false, false, 0), b));
  }
}

// The noise effects
function mode_fillnoise8(s) {
  if (s.call === 0) s.step = random16(12345);
  for (let i = 0; i < s.len; i++) {
    const index = inoise8((i * s.len) & 0xFFFF, (s.step + i * s.len) & 0xFFFF);
    s.setPixelColor(i, s.color_from_palette(index, false, false, 0));
  }
  s.step = (s.step + beatsin8_t(s.speed, 1, 6)) >>> 0;
}
function mode_noise16_1(s) {
  const scale = 320;
  s.step = (s.step + 1 + (s.speed >> 4)) >>> 0;
  for (let i = 0; i < s.len; i++) {
    const shiftX = beatsin8_t(11, 0, 255), shiftY = Math.floor(s.step / 42);
    const noise = inoise16(((i + shiftX) * scale) >>> 0, ((i + shiftY) * scale) >>> 0, s.step) >> 8;
    s.setPixelColor(i, s.color_from_palette(sin8_t((noise * 3) & 0xFF), false, false, 0));
  }
}
function mode_noise16_2(s) {
  const scale = 1000;
  s.step = (s.step + 1 + (s.speed >> 1)) >>> 0;
  for (let i = 0; i < s.len; i++) {
    const noise = inoise16(((i + (s.step >>> 6)) * scale) >>> 0, 0, 4223) >> 8;
    s.setPixelColor(i, s.color_from_palette(sin8_t((noise * 3) & 0xFF), false, false, 0, noise));
  }
}
function mode_noise16_3(s) {
  const scale = 800;
  s.step = (s.step + 1 + s.speed) >>> 0;
  for (let i = 0; i < s.len; i++) {
    const noise = inoise16((i + 4223) * scale, (i + 1234) * scale, (s.step * 8) >>> 0) >> 8;
    s.setPixelColor(i, s.color_from_palette(sin8_t((noise * 3) & 0xFF), false, false, 0, noise));
  }
}
function mode_noise16_4(s) {
  const stp = ((strip.now * s.speed) >>> 0) >>> 7;
  for (let i = 0; i < s.len; i++) s.setPixelColor(i, s.color_from_palette(inoise16((i << 12) >>> 0, stp), false, false, 0));
}

// Colortwinkles (74)
function mode_colortwinkle(s) {
  s.allocateData((s.len + 7) >> 3);
  const bits = s.data;
  const up = 8 + (s.speed >> 2), down = 8 + (s.speed >> 3); // as at a WLED brightness above 28
  for (let i = 0; i < s.len; i++) {
    let c = crgb(s.getPixelColor(i));
    const prev = c, idx = i >> 3, bit = 1 << (i & 7);
    if (bits[idx] & bit) {
      c = addCRGB(c, nscale8_video(c, up));
      if (c[0] === 255 || c[1] === 255 || c[2] === 255) bits[idx] &= ~bit;
      s.setPixelColor(i, c[0], c[1], c[2]);
      if (s.getPixelColor(i) === RGBW32(prev[0], prev[1], prev[2], 0)) {
        c = addCRGB(c, c);
        s.setPixelColor(i, fromCRGB(c));
      }
    } else {
      c = nscale8(c, 255 - down);
      s.setPixelColor(i, fromCRGB(c));
    }
  }
  for (let j = 0; j <= Math.floor(s.len / 50); j++) {
    if (random8() <= s.intensity) {
      for (let times = 0; times < 5; times++) {
        const i = random16(s.len);
        if (s.getPixelColor(i) === 0) {
          const c = ColorFromPalette(s.pal, random8(), 64, false);
          bits[i >> 3] |= 1 << (i & 7);
          s.setPixelColor(i, fromCRGB(c));
          break;
        }
      }
    }
  }
}

function mode_lake(s) {
  const sp = Math.floor(s.speed / 10);
  const wave1 = beatsin8_t(sp + 2, -64, 64), wave2 = beatsin8_t(sp + 1, -64, 64), wave3 = beatsin8_t(sp + 2, 0, 80);
  for (let i = 0; i < s.len; i++) {
    const index = (cos8_t((i * 15 + wave1) & 0xFF) >> 1) + (cubicwave8((i * 23 + wave2) & 0xFF) >> 1);
    const lum = index > wave3 ? index - wave3 : 0;
    s.setPixelColor(i, s.color_from_palette(index, false, false, 0, lum));
  }
}

function mode_meteor_smooth(s) {
  if (s.len === 1) return mode_static(s);
  s.allocateData(s.len);
  const trail = s.data;
  const meteorSize = 1 + Math.floor(s.len / 20);
  const inn = map((s.step >>> 6) & 0xFF, 0, 255, 0, s.len - 1) & 0xFFFF;
  const max = s.palette === 5 || !s.check1 ? 240 : 255;
  const col = (i) => (s.check1 ? s.color_from_palette(i, true, false, 0, trail[i]) : s.color_from_palette(trail[i], false, true, 255));
  for (let i = 0; i < s.len; i++) {
    if (random8() <= 255 - s.intensity) {
      trail[i] = Math.min(max, Math.max(0, trail[i] + 4 - random8(24)));
      s.setPixelColor(i, col(i));
    }
  }
  for (let j = 0; j < meteorSize; j++) {
    let index = inn + j;
    if (index >= s.len) index -= s.len;
    trail[index] = max;
    s.setPixelColor(index, col(index));
  }
  s.step = (s.step + s.speed + 1) >>> 0;
}

function mode_railway(s) {
  if (s.len === 1) return mode_static(s);
  const dur = (256 - s.speed) * 40;
  const rampdur = ((dur * s.intensity) >> 8) & 0xFFFF;
  if (s.step > dur) { s.step = 0; s.aux0 = s.aux0 ? 0 : 1; }
  let pos = 255;
  if (rampdur !== 0) { const p0 = Math.floor((s.step * 255) / rampdur); if (p0 < 255) pos = p0; }
  if (s.aux0) pos = 255 - pos;
  for (let i = 0; i < s.len; i += 2) {
    s.setPixelColor(i, s.color_from_palette(255 - pos, false, false, 255));
    if (i < s.len - 1) s.setPixelColor(i + 1, s.color_from_palette(pos, false, false, 255));
  }
  s.step += FRAMETIME;
}

// Ripple (79) and Ripple Rainbow (99)
function ripple_base(s) {
  const maxRipples = Math.min(1 + (s.len >> 2), MAX_RIPPLES);
  if (!s.state || s.state.length !== maxRipples) s.state = Array.from({ length: maxRipples }, () => ({ state: 0, color: 0, pos: 0 }));
  for (const r of s.state) {
    let rs = r.state;
    if (rs) {
      const decay = (s.speed >> 4) + 1;
      const col = s.color_from_palette(r.color, false, false, 255);
      const propagation = Math.imul(Math.floor(rs / decay) - 1, s.speed + 1) >>> 0;
      const propI = (propagation >>> 8) | 0, propF = propagation & 0xFF;
      const amp = rs < 17 ? triwave8((rs - 1) * 8) : map(rs, 17, 255, 255, 2);
      const left = r.pos - propI - 1, right = r.pos + propI + 2;
      for (let v = 0; v < 4; v++) {
        const mag = scale8(cubicwave8(((propF >> 2) + v * 64) & 0xFF), amp);
        s.setPixelColor(left + v, color_blend(s.getPixelColor(left + v), col, mag));
        s.setPixelColor(right - v, color_blend(s.getPixelColor(right - v), col, mag));
      }
      rs += decay;
      r.state = rs > 254 ? 0 : rs;
    } else if (random16(IBN + 10000) <= s.intensity) {
      r.state = 1;
      r.pos = random16(s.len);
      r.color = random8();
    }
  }
}
function mode_ripple(s) {
  if (s.len === 1) return mode_static(s);
  if (!s.check2) s.fill(s.SEGCOLOR(1)); else s.fade_out(250);
  ripple_base(s);
}
function mode_ripple_rainbow(s) {
  if (s.len === 1) return mode_static(s);
  if (s.call === 0) { s.aux0 = random8(); s.aux1 = random8(); }
  if (s.aux0 === s.aux1) s.aux1 = random8();
  else if (s.aux1 > s.aux0) s.aux0++;
  else s.aux0--;
  s.fill(color_blend(s.color_wheel(s.aux0), BLACK, 235));
  ripple_base(s);
}

// Halloween Eyes (82)
function mode_halloween_eyes(s) {
  if (s.len === 1) return mode_static(s);
  const maxWidth = s.len;
  const SPACE = Math.max(2, s.len >> 5), WIDTH = SPACE >> 1;
  const eyeLength = 2 * WIDTH + SPACE;
  if (eyeLength >= maxWidth) return mode_static(s);
  if (!s.state) s.state = { state: 0, color: 0, startPos: 0, duration: 0, startTime: 0, blinkEnd: 0 };
  const d = s.state;
  if (!s.check2) s.fill(s.SEGCOLOR(1));
  d.state %= 5;
  let duration = Math.max(1, d.duration);
  const elapsed = (strip.now - d.startTime) >>> 0;
  switch (d.state) {
    case 0:
      d.startPos = random16(0, maxWidth - eyeLength - 1);
      d.color = random8();
      duration = 128 + random16(s.intensity * 64);
      d.duration = duration & 0xFFFF;
      d.state = 1;
      // falls through
    case 1: {
      const start2 = d.startPos + WIDTH + SPACE;
      duration = Math.min(duration, 128 + s.intensity * 64);
      const fadeIn = Math.floor((elapsed * 2048) / duration);
      const bg = s.SEGCOLOR(1), eye = s.color_from_palette(d.color, false, false, 0);
      let c = eye;
      if (fadeIn < 256) c = color_blend(bg, eye, fadeIn);
      else if (elapsed > 1024) {
        const remaining = elapsed >= duration ? 0 : duration - elapsed;
        if (remaining > 1024 && random8() < 4) { c = bg; d.state = 2; d.blinkEnd = strip.now + random8(8, 128); }
      }
      if (c !== bg) for (let i = 0; i < WIDTH; i++) { s.setPixelColor(d.startPos + i, c); s.setPixelColor(start2 + i, c); }
      break;
    }
    case 2:
      if (strip.now >= d.blinkEnd) d.state = 1;
      break;
    case 3: {
      const base = s.speed * 128;
      duration = base + random16(base);
      d.duration = duration & 0xFFFF;
      d.state = 4;
    }
      // falls through
    case 4:
      duration = Math.min(duration, 2 * s.speed * 128);
      break;
  }
  if (elapsed > duration) {
    d.state = d.state <= 2 ? 3 : 0;
    d.startTime = strip.now;
  }
}

// Fireworks 1D (90)
function mode_exploding_fireworks(s) {
  if (s.len === 1) return mode_static(s);
  const rows = s.len;
  const maxSparks = Math.floor((FAIR_DATA_PER_SEG * 4) / SPARK_SIZE); // one segment: four times the fair share
  const numSparks = Math.min(5 + (rows >> 1), maxSparks);
  if (!s.state || s.state.sparks.length !== numSparks) {
    s.state = { sparks: Array.from({ length: numSparks }, () => ({ pos: 0, posX: 0, vel: 0, col: 0, colIndex: 0 })), dying: 0 };
    s.aux0 = 0;
  }
  const { sparks } = s.state, flare = sparks[0];
  s.fade_out(252);
  const gravity = (-0.0004 - s.speed / 800000) * rows;
  if (s.aux0 < 2) {
    if (s.aux0 === 0) {
      flare.pos = 0;
      flare.posX = s.intensity > random8() ? 1 : 0;
      const peak = ((75 + random8(180)) * (rows - 1)) >> 8;
      flare.vel = Math.sqrt(-2 * gravity * peak);
      flare.col = 255;
      s.aux0 = 1;
    }
    if (flare.vel > 12 * gravity) {
      const v = flare.col & 0xFF;
      s.setPixelColor(flare.posX > 0 ? rows - Math.trunc(flare.pos) - 1 : Math.trunc(flare.pos), v, v, v);
      flare.pos = Math.min(rows - 1, Math.max(0, flare.pos + flare.vel));
      flare.vel += gravity;
      flare.col = (flare.col - 2) & 0xFFFF;
    } else s.aux0 = 2;
  } else if (s.aux0 < 4) {
    let n = Math.trunc(flare.pos + random8(4));
    n = Math.min(Math.max(n, 4), numSparks);
    if (s.aux0 === 2) {
      for (let i = 1; i < n; i++) {
        const sp = sparks[i];
        sp.pos = flare.pos;
        sp.posX = flare.posX;
        sp.vel = random16(20001) / 10000 - 0.9;
        sp.vel *= rows < 32 ? 0.5 : 1;
        sp.col = 345;
        sp.colIndex = random8();
        sp.vel *= flare.pos / rows;
        sp.vel *= -gravity * 50;
      }
      s.state.dying = gravity / 2;
      s.aux0 = 3;
    }
    if (sparks[1].col > 4) {
      for (let i = 1; i < n; i++) {
        const sp = sparks[i];
        sp.pos += sp.vel;
        sp.vel += s.state.dying;
        if (sp.col > 3) sp.col -= 4;
        if (sp.pos > 0 && sp.pos < rows) {
          const prog = sp.col;
          const spColor = s.palette ? s.color_wheel(sp.colIndex) : s.SEGCOLOR(0);
          let c = [0, 0, 0];
          if (prog > 300) c = crgb(color_blend(spColor, WHITE, (prog - 300) * 5));
          else if (prog > 45) {
            c = crgb(color_blend(BLACK, spColor, prog - 45));
            const cooling = (300 - prog) >> 5;
            c[1] = qsub8(c[1], cooling);
            c[2] = qsub8(c[2], cooling * 2);
          }
          s.setPixelColor(Math.trunc(sp.posX) ? rows - Math.trunc(sp.pos) - 1 : Math.trunc(sp.pos), c[0], c[1], c[2]);
        }
      }
      if (s.check3) blur1d(s, 16);
      s.state.dying *= 0.8;
    } else s.aux0 = 6 + random8(10);
  } else {
    s.aux0--;
    if (s.aux0 < 4) s.aux0 = 0;
  }
}

// Bouncing Balls (91)
function mode_bouncing_balls(s) {
  if (s.len === 1) return mode_static(s);
  const maxNumBalls = 16;
  if (!s.state) s.state = Array.from({ length: maxNumBalls }, () => ({ last: 0, impact: 0, height: 0 }));
  const balls = s.state;
  if (!s.check2) s.fill(s.SEGCOLOR(2) ? BLACK : s.SEGCOLOR(1));
  const numBalls = Math.floor((s.intensity * (maxNumBalls - 1)) / 255) + 1;
  const gravity = -9.81, hasCol2 = !!s.SEGCOLOR(2), time = strip.now;
  if (s.call === 0) for (const b of balls) b.last = time;
  for (let i = 0; i < numBalls; i++) {
    const b = balls[i];
    const since = Math.floor((time - b.last) / (Math.floor((255 - s.speed) / 64) + 1));
    const t = since / 1000;
    b.height = (0.5 * gravity * t + b.impact) * t;
    if (b.height <= 0) {
      b.height = 0;
      b.impact *= 0.9 - i / (numBalls * numBalls);
      b.last = time;
      if (b.impact < 0.015) b.impact = (Math.sqrt(-2 * gravity) * random8(5, 11)) / 10;
    } else if (b.height > 1) continue;
    let color = s.SEGCOLOR(0);
    if (s.palette) color = s.color_wheel(i * Math.floor(256 / Math.max(numBalls, 8)));
    else if (hasCol2) color = s.SEGCOLOR(i % NUM_COLORS);
    s.setPixelColor(Math.round(b.height * (s.len - 1)), color);
  }
}

// Popcorn (95)
function mode_popcorn(s) {
  if (s.len === 1) return mode_static(s);
  const usable = MAX_NUM_POPCORN * SPARK_SIZE > FAIR_DATA_PER_SEG ? Math.floor(FAIR_DATA_PER_SEG / SPARK_SIZE) + 1 : MAX_NUM_POPCORN;
  if (!s.state) s.state = Array.from({ length: usable }, () => ({ pos: 0, vel: 0, colIndex: 0 }));
  const pop = s.state;
  if (!s.check2) s.fill(s.SEGCOLOR(2) ? BLACK : s.SEGCOLOR(1));
  const gravity = (-0.0001 - s.speed / 200000) * s.len;
  const num = Math.floor((s.intensity * usable) / 255) || 1;
  for (let i = 0; i < num; i++) {
    const p = pop[i];
    if (p.pos >= 0) { p.pos += p.vel; p.vel += gravity; } else if (random8() < 2) {
      p.pos = 0.01;
      const peak = ((128 + random8(128)) * (s.len - 1)) >> 8;
      p.vel = Math.sqrt(-2 * gravity * peak);
      if (s.palette) p.colIndex = random8();
      else {
        let col = random8(0, NUM_COLORS);
        if (!s.SEGCOLOR(2) || !s.SEGCOLOR(col)) col = 0;
        p.colIndex = col;
      }
    }
    if (p.pos >= 0) {
      let col = s.color_wheel(p.colIndex);
      if (!s.palette && p.colIndex < NUM_COLORS) col = s.SEGCOLOR(p.colIndex);
      const led = Math.trunc(p.pos);
      if (led < s.len) s.setPixelColor(led, col);
    }
  }
}

// Drip (96)
function mode_drip(s) {
  if (s.len === 1) return mode_static(s);
  if (!s.state) s.state = Array.from({ length: 4 }, () => ({ pos: 0, vel: 0, col: 0, colIndex: 0 }));
  if (!s.check2) s.fill(s.SEGCOLOR(1));
  const numDrops = 1 + (s.intensity >> 6);
  const gravity = (-0.0005 - s.speed / 50000) * Math.max(1, s.len - 1);
  const source = 12;
  for (let j = 0; j < numDrops; j++) {
    const d = s.state[j];
    if (d.colIndex === 0) { d.pos = s.len - 1; d.vel = 0; d.col = source; d.colIndex = 1; }
    s.setPixelColor(s.len - 1, color_blend(BLACK, s.SEGCOLOR(0), source));
    if (d.colIndex === 1) {
      if (d.col > 255) d.col = 255;
      s.setPixelColor(Math.trunc(d.pos) & 0xFFFF, color_blend(BLACK, s.SEGCOLOR(0), d.col));
      d.col += map(s.speed, 0, 255, 1, 6);
      if (random8() < Math.floor(d.col / 10)) { d.colIndex = 2; d.col = 255; }
    }
    if (d.colIndex > 1) {
      if (d.pos > 0) {
        d.pos += d.vel;
        if (d.pos < 0) d.pos = 0;
        d.vel += gravity;
        for (let i = 1; i < 7 - d.colIndex; i++) {
          const pos = Math.min(s.len - 1, Math.max(0, (Math.trunc(d.pos) & 0xFFFF) + i));
          s.setPixelColor(pos, color_blend(BLACK, s.SEGCOLOR(0), Math.floor(d.col / i) & 0xFF));
        }
        if (d.colIndex > 2) s.setPixelColor(0, color_blend(s.SEGCOLOR(0), BLACK, d.col & 0xFF));
      } else if (d.colIndex > 2) { d.colIndex = 0; d.col = source; } else {
        if (d.colIndex === 2) { d.vel = -d.vel / 4; d.pos += d.vel; }
        d.col = source * 2;
        d.colIndex = 5;
      }
    }
  }
}

// Sunrise (104): WLED times it with millis(); the preview with the effect clock.
function mode_sunrise(s) {
  if (s.len === 1) return mode_static(s);
  if (s.call === 0 || s.speed !== s.aux0) { s.step = strip.now; s.aux0 = s.speed; }
  s.fill(BLACK);
  let stage = 0xFFFF;
  let s10 = Math.floor((strip.now - s.step) / 100);
  if (s.speed > 120) {
    const counter = ((strip.now >>> 1) * (((s.speed - 120) >> 1) + 1)) >>> 0;
    stage = triwave16(counter & 0xFFFF);
  } else if (s.speed) {
    let mins = s.speed;
    if (mins > 60) mins -= 60;
    const target = mins * 600;
    if (s10 > target) s10 = target;
    stage = map(s10, 0, target, 0, 0xFFFF);
    if (s.speed > 60) stage = 0xFFFF - stage;
  }
  for (let i = 0; i <= s.len >> 1; i++) {
    let wave = triwave16(Math.floor((i * stage) / s.len) & 0xFFFF);
    wave = (wave >> 8) + ((wave * s.intensity) >> 15);
    const c = s.color_from_palette(wave > 240 ? 240 : wave, false, true, 255);
    s.setPixelColor(i, c);
    s.setPixelColor(s.len - i - 1, c);
  }
}

// Noise Pal (107)
function fillGradientHSV(entries, start, c1, end, c2) {
  if (c2[2] === 0 || c2[1] === 0) c2 = [c1[0], c2[1], c2[2]];
  if (c1[2] === 0 || c1[1] === 0) c1 = [c2[0], c1[1], c1[2]];
  const s16 = (v) => ((v & 0xFFFF) ^ 0x8000) - 0x8000;
  const satDist = (c2[1] - c1[1]) << 7, valDist = (c2[2] - c1[2]) << 7;
  const hueDelta8 = (c2[0] - c1[0]) & 0xFF;
  const hueDist = hueDelta8 > 127 ? -(((256 - hueDelta8) & 0xFF) << 7) : hueDelta8 << 7;
  const divisor = end - start || 1;
  const hd = s16(Math.trunc(hueDist / divisor) * 2), sd = s16(Math.trunc(satDist / divisor) * 2), vd = s16(Math.trunc(valDist / divisor) * 2);
  let h = c1[0] << 8, sa = c1[1] << 8, v = c1[2] << 8;
  for (let i = start; i <= end; i++) {
    entries[i] = hsv2rgb_rainbow(h >> 8, sa >> 8, v >> 8);
    h = (h + hd) & 0xFFFF; sa = (sa + sd) & 0xFFFF; v = (v + vd) & 0xFFFF;
  }
}
function paletteFromHSV(c1, c2, c3, c4) {
  const e = new Array(16);
  fillGradientHSV(e, 0, c1, 5, c2); fillGradientHSV(e, 5, c2, 10, c3); fillGradientHSV(e, 10, c3, 15, c4);
  return e;
}
function mode_noisepal(s) {
  const scale = 15 + (s.intensity >> 2);
  if (!s.state) s.state = [Array.from({ length: 16 }, () => [0, 0, 0]), Array.from({ length: 16 }, () => [0, 0, 0])];
  const [current, target] = s.state;
  if (strip.now - s.step > 4000 + s.speed * 10) {
    s.step = strip.now;
    const base = random8();
    const hsv = (dh, sat) => [(base + dh) & 0xFF, sat, random8(128, 255)];
    const t = paletteFromHSV(hsv(random8(64), 255), hsv(128, 255), hsv(random8(92), 192), hsv(random8(92), 255));
    for (let k = 0; k < 16; k++) target[k] = t[k];
  }
  // FastLED's nblendPaletteTowardPalette(current, target, 48)
  let changes = 0;
  outer: for (let k = 0; k < 16; k++) {
    for (let ch = 0; ch < 3; ch++) {
      const a = current[k][ch], b = target[k][ch];
      if (a === b) continue;
      if (a < b) { current[k][ch]++; changes++; }
      if (current[k][ch] > b) { current[k][ch]--; changes++; if (current[k][ch] > b) current[k][ch]--; }
      if (changes >= 48) break outer;
    }
  }
  const pal = s.palette > 0 ? s.pal : current;
  for (let i = 0; i < s.len; i++) {
    const c = ColorFromPalette(pal, inoise8((i * scale) & 0xFFFF, (s.aux0 + i * scale) & 0xFFFF), 255, true);
    s.setPixelColor(i, c[0], c[1], c[2]);
  }
  s.aux0 = (s.aux0 + beatsin8_t(10, 1, 4)) & 0xFFFF;
}

function mode_flow(s) {
  let counter = 0;
  if (s.speed !== 0) counter = ((strip.now * ((s.speed >> 2) + 1)) >>> 0) >>> 8;
  const maxZones = Math.floor(s.len / 6);
  let zones = (s.intensity * maxZones) >> 8;
  if (zones & 1) zones++;
  if (zones < 2) zones = 2;
  const zoneLen = Math.floor(s.len / zones), offset = (s.len - zones * zoneLen) >> 1;
  s.fill(s.color_from_palette(-counter & 0xFFFF, false, true, 255));
  for (let z = 0; z < zones; z++) {
    const pos = offset + z * zoneLen;
    for (let i = 0; i < zoneLen; i++) {
      const ci = (Math.floor((i * 255) / zoneLen) - counter) & 0xFFFF;
      const led = z & 1 ? i : zoneLen - 1 - i;
      s.setPixelColor(pos + led, s.color_from_palette(ci, false, true, 255));
    }
  }
}

function mode_chunchun(s) {
  if (s.len === 1) return mode_static(s);
  s.fade_out(254);
  let counter = (strip.now * (6 + (s.speed >> 4))) >>> 0;
  const numBirds = 2 + (s.len >> 3);
  const span = Math.floor((s.intensity << 8) / numBirds);
  for (let i = 0; i < numBirds; i++) {
    counter = (counter - span) >>> 0;
    const megumin = sin16_t(counter & 0xFFFF) + 0x8000;
    const bird = Math.min(s.len - 1, (Math.imul(megumin, s.len) >>> 0) >>> 16);
    s.setPixelColor(bird, s.color_from_palette(Math.floor((i * 255) / numBirds), false, false, 0));
  }
}

// Dancing Shadows (112)
function mode_dancing_shadows(s) {
  if (s.len === 1) return mode_static(s);
  const num = map(s.intensity, 0, 255, 2, SPOT_MAX_COUNT);
  const initialize = s.aux0 !== num;
  s.aux0 = num;
  if (initialize || !s.state || s.state.length !== num) s.state = Array.from({ length: num }, () => ({ speed: 0, colorIdx: 0, position: 0, last: 0, width: 0, type: 0 }));
  s.fill(BLACK);
  const time = strip.now;
  let respawn = false;
  for (const sp of s.state) {
    if (!initialize) {
      const delta = Math.trunc((time - sp.last) * (sp.speed * ((1 + s.speed) / 100)));
      if (Math.abs(delta) >= 1) { sp.position = ((sp.position + delta) << 16) >> 16; sp.last = time; }
      respawn = (sp.speed > 0 && sp.position > s.len + 2) || (sp.speed < 0 && sp.position < -(sp.width + 2));
    }
    if (initialize || respawn) {
      sp.colorIdx = random8();
      sp.width = random8(1, 10);
      sp.speed = Math.fround(1 / random8(4, 50));
      if (initialize) {
        sp.position = random16(s.len);
        sp.speed *= random8(2) ? 1 : -1;
      } else if (random8(2)) { sp.position = s.len + sp.width; sp.speed *= -1; } else sp.position = -sp.width;
      sp.last = time;
      sp.type = random8(SPOT_TYPES_COUNT);
    }
    const color = s.color_from_palette(sp.colorIdx, false, false, 255);
    const start = sp.position;
    const put = (j, blend) => { if (start + j >= 0 && start + j < s.len) s.blendPixelColor(start + j, color, blend); };
    if (sp.width <= 1) put(0, 128);
    else {
      const step = [1, 1, 1, 2, 3, 4][sp.type];
      for (let j = 0; j < sp.width; j += step) {
        if (sp.type === 1) put(j, cubicwave8(map(j, 0, sp.width - 1, 0, 255) & 0xFF));
        else if (sp.type === 2) put(j, cubicwave8((2 * map(j, 0, sp.width - 1, 0, 255)) & 0xFF));
        else put(j, 128);
      }
    }
  }
}

// TV Simulator (116)
function mode_tv_simulator(s) {
  if (!s.state) s.state = { total: 0, fade: 0, start: 0, elapsed: 0, sliders: 0, sceneStart: 0, sceneDur: 0, hue: 0, sat: 0, bri: 0, r: 0, g: 0, b: 0, pr: 0, pg: 0, pb: 0 };
  const tv = s.state;
  const colorSpeed = map(s.speed, 0, 255, 1, 20), colorIntensity = map(s.intensity, 0, 255, 10, 30);
  const sliders = ((s.speed << 8) | s.intensity) & 0xFFFF;
  if (sliders !== tv.sliders) { tv.sliders = sliders; s.aux1 = 0; }
  if (strip.now - tv.sceneStart >= tv.sceneDur || s.aux1 === 0) {
    tv.sceneStart = strip.now;
    tv.sceneDur = random16(60 * 250 * colorSpeed, 60 * 750 * colorSpeed);
    tv.hue = random16(0, 768);
    tv.sat = random8(100, 130 + colorIntensity);
    tv.bri = random8(200, 240);
    s.aux1 = 1;
    s.aux0 = 0;
  }
  if (s.aux0 === 0) {
    let j = random8(4 * colorIntensity);
    const hue = random8() < 128 ? (j < tv.hue ? tv.hue - j : 767 - tv.hue - j) : (j + tv.hue < 767 ? tv.hue + j : tv.hue + j - 767);
    j = random8(2 * colorIntensity);
    const sat = tv.sat - j < 0 ? 0 : (tv.sat - j) & 0xFF;
    j = random8(100);
    const bri = tv.bri - j < 0 ? 0 : (tv.bri - j) & 0xFF;
    const n = (hue >> 8) % 3;
    const x = ((((hue & 255) * sat) >> 8) * bri) >> 8 & 0xFF;
    const sv = (((256 - sat) * bri) >> 8) & 0xFF;
    const temp = [sv, (x + sv) & 0xFF, (bri - x) & 0xFF, sv, (x + sv) & 0xFF];
    tv.r = temp[n + 2]; tv.g = temp[n + 1]; tv.b = temp[n];
  }
  const nr = gamma8(tv.r) * 257, ng = gamma8(tv.g) * 257, nb = gamma8(tv.b) * 257;
  if (s.aux0 === 0) {
    s.aux0 = 1;
    tv.total = random16(250, 2500);
    tv.fade = random16(0, tv.total);
    if (random8(10) < 3) tv.fade = 0;
    tv.start = strip.now;
  }
  tv.elapsed = strip.now - tv.start;
  let r = nr, g = ng, b = nb;
  if (tv.elapsed < tv.fade) {
    r = map(tv.elapsed, 0, tv.fade, tv.pr, nr);
    g = map(tv.elapsed, 0, tv.fade, tv.pg, ng);
    b = map(tv.elapsed, 0, tv.fade, tv.pb, nb);
  }
  for (let i = 0; i < s.len; i++) s.setPixelColor(i, (r >> 8) & 0xFF, (g >> 8) & 0xFF, (b >> 8) & 0xFF);
  if (tv.elapsed >= tv.total) { tv.pr = nr; tv.pg = ng; tv.pb = nb; s.aux0 = 0; }
}

function mode_perlinmove(s) {
  if (s.len === 1) return mode_static(s);
  s.fade_out(255 - s.custom1);
  for (let i = 0; i < (s.intensity >> 4) + 1; i++) {
    const t = Math.floor(((strip.now * 128) >>> 0) / (260 - s.speed));
    const locn = inoise16((t + i * 15000) >>> 0, t);
    const pixloc = map(locn, 50 * 256, 192 * 256, 0, s.len - 1);
    if (pixloc >= 0) s.setPixelColor(pixloc, s.color_from_palette(pixloc % 255, false, false, 0));
  }
}

function mode_flow_stripe(s) {
  if (s.len === 1) return mode_static(s);
  const hl = Math.floor((s.len * 10) / 13);
  const hue = Math.floor(strip.now / (s.speed + 1)) & 0xFF;
  const t = Math.floor(strip.now / ((s.intensity >> 3) + 1));
  for (let i = 0; i < s.len; i++) {
    let c = Math.trunc(Math.abs(i - hl) / hl) * 127;
    c = sin8_t(c & 0xFF);
    c = sin8_t(((c >> 1) + t) & 0xFF);
    const b = sin8_t((c + Math.floor(t / 8)) & 0xFF);
    s.setPixelColor(i, fromCRGB(hsv2rgb_rainbow((b + hue) & 0xFF, 255, 255)));
  }
}

function mode_wavesins(s) {
  for (let i = 0; i < s.len; i++) {
    const bri = sin8_t((Math.floor(strip.now / 4) + i * s.intensity) & 0xFF);
    const index = beatsin8_t(s.speed, s.custom1, s.custom1 + s.custom2, 0, (i * (s.custom3 << 3)) & 0xFF);
    s.setPixelColor(i, s.color_from_palette(index, false, false, 0, bri));
  }
}

// WLED effect id (FX.h) -> one frame of it.
export const MODES = {
  0: mode_static,
  1: (s) => blink(s, s.SEGCOLOR(0), s.SEGCOLOR(1), false, true), // Blink
  2: mode_breath, // Breathe
  3: (s) => color_wipe(s, false, false), // Wipe
  8: mode_rainbow, // Colorloop
  9: mode_rainbow_cycle, // Rainbow
  10: (s) => scan(s, false), // Scan
  11: (s) => scan(s, true), // Scan Dual
  12: mode_fade, // Fade
  13: (s) => running(s, s.SEGCOLOR(0), s.SEGCOLOR(1), true), // Theater
  15: (s) => running_base(s, false), // Running
  16: (s) => running_base(s, true), // Saw
  17: mode_twinkle, // Twinkle
  20: mode_sparkle, // Sparkle
  23: (s) => blink(s, s.SEGCOLOR(0), s.SEGCOLOR(1), true, true), // Strobe
  28: (s) => chase(s, s.SEGCOLOR(1), s.SEGCOLOR(2) ? s.SEGCOLOR(2) : s.SEGCOLOR(0), s.SEGCOLOR(0), true), // Chase
  40: mode_larson_scanner, // Scanner
  52: (s) => running_base(s, false, true), // Running Dual
  57: mode_lightning, // Lightning
  60: (s) => { s.check1 = true; mode_larson_scanner(s); }, // Scanner Dual
  64: mode_juggle, // Juggle
  65: mode_palette, // Palette
  66: mode_fire_2012, // Fire 2012
  67: mode_colorwaves, // Colorwaves
  76: mode_meteor, // Meteor
  80: (s) => twinklefox_base(s, false), // Twinklefox
  81: (s) => twinklefox_base(s, true), // Twinklecat
  88: (s) => candle(s, false), // Candle
  89: mode_starburst, // Fireworks Starburst
  97: mode_plasma, // Plasma
  101: mode_pacifica, // Pacifica
  102: (s) => candle(s, true), // Candle Multi
  4: (s) => color_wipe(s, false, true), // Wipe Random
  5: mode_random_color, // Random Colors
  6: (s) => color_wipe(s, true, false), // Sweep
  7: mode_dynamic, // Dynamic
  14: (s) => running(s, s.color_wheel(s.step & 0xFF), s.SEGCOLOR(1), true), // Theater Rainbow
  18: (s) => dissolve(s, s.check1 ? s.color_wheel(random8()) : s.SEGCOLOR(0)), // Dissolve
  19: (s) => dissolve(s, s.color_wheel(random8())), // Dissolve Rnd
  21: (s) => sparkle_flash(s, false), // Sparkle Dark
  22: (s) => sparkle_flash(s, true), // Sparkle+
  24: (s) => blink(s, s.color_wheel(s.call & 0xFF), s.SEGCOLOR(1), true, false), // Strobe Rainbow
  25: mode_multi_strobe, // Strobe Mega
  26: (s) => blink(s, s.color_wheel(s.call & 0xFF), s.SEGCOLOR(1), false, false), // Blink Rainbow
  27: mode_android, // Android
  29: (s) => chase(s, s.SEGCOLOR(1), s.SEGCOLOR(2) ? s.SEGCOLOR(2) : s.SEGCOLOR(0), s.SEGCOLOR(0), false), // Chase Random
  30: mode_chase_rainbow, // Chase Rainbow
  31: mode_chase_flash, // Chase Flash
  32: mode_chase_flash_random, // Chase Flash Rnd
  33: mode_chase_rainbow_white, // Rainbow Runner
  34: mode_colorful, // Colorful
  35: mode_traffic_light, // Traffic Light
  36: (s) => color_wipe(s, true, true), // Sweep Random
  37: (s) => running(s, s.SEGCOLOR(0), s.SEGCOLOR(1), false), // Chase 2
  39: mode_running_random, // Stream
  41: mode_comet, // Lighthouse
  45: mode_fire_flicker, // Fire Flicker
  46: (s) => gradient_base(s, false), // Gradient
  47: (s) => gradient_base(s, true), // Loading
  50: (s) => { // Two Dots
    if (!s.check2) s.fill(s.SEGCOLOR(2));
    police_base(s, s.SEGCOLOR(0), s.SEGCOLOR(1) === s.SEGCOLOR(2) ? s.SEGCOLOR(0) : s.SEGCOLOR(1));
  },
  54: (s) => tricolor_chase(s, s.SEGCOLOR(2), s.SEGCOLOR(0)), // Chase 3
  55: mode_tricolor_wipe, // Tri Wipe
  56: mode_tricolor_fade, // Tri Fade
  58: mode_icu, // ICU
  59: mode_multi_comet, // Multi Comet
  61: mode_random_chase, // Stream 2
  62: mode_oscillate, // Oscillate
  63: mode_pride_2015, // Pride 2015
  68: mode_bpm, // Bpm
  83: mode_static_pattern, // Solid Pattern
  84: mode_tri_static_pattern, // Solid Pattern Tri
  85: (s) => spots_base(s, (255 - s.speed) << 8), // Spots
  86: mode_spots_fade, // Spots Fade
  87: mode_glitter, // Glitter
  92: (s) => sinelon_base(s, false), // Sinelon
  93: (s) => sinelon_base(s, true), // Sinelon Dual
  94: (s) => sinelon_base(s, false, true), // Sinelon Rainbow
  98: mode_percent, // Percent
  100: mode_heartbeat, // Heartbeat
  103: mode_solid_glitter, // Solid Glitter
  105: (s) => phased_base(s, 0), // Phased
  106: mode_twinkleup, // Twinkleup
  108: mode_sinewave, // Sine
  113: mode_washing_machine, // Washing Machine
  115: mode_blends, // Blends
  117: (s) => { const old = s.check1; s.check1 = true; mode_dynamic(s); s.check1 = old; }, // Dynamic Smooth
  38: mode_aurora, // Aurora
  42: mode_fireworks, // Fireworks
  43: mode_rain, // Rain
  44: mode_tetrix, // Tetrix
  48: mode_rolling_balls, // Rolling Balls
  49: mode_fairy, // Fairy
  51: mode_fairytwinkle, // Fairytwinkle
  69: mode_fillnoise8, // Fill Noise
  70: mode_noise16_1, // Noise 1
  71: mode_noise16_2, // Noise 2
  72: mode_noise16_3, // Noise 3
  73: mode_noise16_4, // Noise 4
  74: mode_colortwinkle, // Colortwinkles
  75: mode_lake, // Lake
  77: mode_meteor_smooth, // Meteor Smooth
  78: mode_railway, // Railway
  79: mode_ripple, // Ripple
  82: mode_halloween_eyes, // Halloween Eyes
  90: mode_exploding_fireworks, // Fireworks 1D
  91: mode_bouncing_balls, // Bouncing Balls
  95: mode_popcorn, // Popcorn
  96: mode_drip, // Drip
  99: mode_ripple_rainbow, // Ripple Rainbow
  104: mode_sunrise, // Sunrise
  107: mode_noisepal, // Noise Pal
  109: (s) => phased_base(s, 1), // Phased Noise
  110: mode_flow, // Flow
  111: mode_chunchun, // Chunchun
  112: mode_dancing_shadows, // Dancing Shadows
  116: mode_tv_simulator, // TV Simulator
  147: mode_perlinmove, // Perlin Move
  179: mode_flow_stripe, // Flow Stripe
  184: mode_wavesins, // Wavesins
};
export { BLACK, RGBW32 };
