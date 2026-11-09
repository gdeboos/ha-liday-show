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
  B, BLACK, FRAMETIME, G, R, STARBURST_MAX_FRAG, W, WHITE, addCRGB, beat16, beat8, beatsin16_t, beatsin88_t,
  beatsin8_t, ColorFromPalette, color_blend, cos8_t, crgb, cubicwave8, fromCRGB, get_random_wheel_index,
  getAverageLight, getSeed, hsv2rgb_rainbow, map, maxCRGB, nscale8_video, qadd8, quadwave8, qsub8, random16, random8,
  RGBW32, scale16, scale8, setSeed, sin16_t, sin8_t, sin_gap, strip, triwave16,
} from "./engine.js";

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

function phased_base(s) { // the "Phased" (moder 0) case; WLED keeps the phase as a float in SEGENV.step
  if (s.call === 0 || typeof s.state !== "number") s.state = 0;
  const cutOff = 255 - s.intensity, modVal = 5;
  let index = Math.floor(strip.now / 64);
  s.state = Math.fround(s.state + s.speed / 32);
  for (let i = 0; i < s.len; i++) {
    let val = (i + 1) * 16;
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
  105: phased_base, // Phased
  106: mode_twinkleup, // Twinkleup
  108: mode_sinewave, // Sine
  113: mode_washing_machine, // Washing Machine
  115: mode_blends, // Blends
  117: (s) => { const old = s.check1; s.check1 = true; mode_dynamic(s); s.check1 = old; }, // Dynamic Smooth
};
export { BLACK, RGBW32 };
