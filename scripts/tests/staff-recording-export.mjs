#!/usr/bin/env node
/**
 * Export real, silent Playwright recordings; never synthesize product states.
 * node scripts/tests/staff-recording-export.mjs --input reports/run/live-results.json --out reports/run/media
 * Input: { clips: [{ name, title, role, raw, duration, events: [{ seconds, label, kind }] }],
 *          scope?, evidence?, limitations?, checks?, humanUat? }
 * Kinds: caption, result, wait-start/end, private-start/end. Private markers must pair.
 * Times are seconds from the beginning of the raw video. ffprobe duration is authoritative.
 * --self-check runs pure timeline checks; --self-check-media also verifies synthetic media.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPORTS = path.join(ROOT, 'reports');
const KINDS = new Set(['caption', 'result', 'wait-start', 'wait-end', 'private-start', 'private-end']);
const WAIT_LABEL = 'Waiting shortened · actual result';
const DISCLOSURE = 'REAL TEST · fictional business data';
const EPSILON = 0.000001;
const round = value => Math.round(value * 1000) / 1000;
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const html = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function english(value, description) {
  if (typeof value !== 'string' || !value.trim() || value.length > 350 || /[\r\n\u0000-\u001f]/u.test(value)) throw new Error(`Invalid ${description}: use a single English line, 1–350 characters`);
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}]/u.test(value)) throw new Error(`${description} must be in English`);
  return value.trim();
}

async function checkedExisting(candidate) {
  const absolute = await fs.realpath(candidate);
  const realRoot = await fs.realpath(ROOT);
  if (!inside(realRoot, absolute)) throw new Error('Input and raw media must resolve within this repository');
  if (!(await fs.stat(absolute)).isFile()) throw new Error('Input and raw media must be files');
  return absolute;
}

async function checkedOutput(candidate) {
  const absolute = path.resolve(candidate);
  if (absolute === REPORTS || !inside(REPORTS, absolute)) throw new Error('Output must be a new directory below reports/');
  let ancestor = path.dirname(absolute);
  while (true) {
    try { const real = await fs.realpath(ancestor); if (!inside(await fs.realpath(REPORTS), real)) throw new Error('Output ancestor resolves outside reports/'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); }
  }
  try { await fs.lstat(absolute); throw new Error('Output already exists; choose a new directory'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return absolute;
}

function command(binary, args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, shell: false, windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-2_000_000); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-100_000); });
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`${binary} exceeded 30 minutes`)); }, 30 * 60 * 1000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); if (code !== 0) reject(new Error(`${binary} failed (${code}): ${stderr}`)); else resolve(stdout); });
  });
}

async function probe(filename) {
  return JSON.parse(await command('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filename]));
}

async function hash(filename) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  return digest.digest('hex');
}

function normalizeEvents(events, duration) {
  if (!Array.isArray(events)) throw new Error('Every clip requires an events array');
  return events.map((event, index) => {
    if (!event || !KINDS.has(event.kind) || !Number.isFinite(event.seconds) || event.seconds < 0 || event.seconds > duration + 0.75) throw new Error(`Invalid event at index ${index}`);
    // Private labels are deliberately never read, copied, displayed, or logged.
    return { seconds: Math.min(duration, event.seconds), kind: event.kind, label: event.kind.startsWith('private-') ? undefined : english(event.label, `event ${index} label`), index };
  }).sort((a, b) => a.seconds - b.seconds || a.index - b.index);
}

function pairs(events, prefix) {
  const ranges = []; let start;
  for (const event of events) {
    if (event.kind === `${prefix}-start`) { if (start !== undefined) throw new Error(`Overlapping ${prefix} intervals are not allowed`); start = event.seconds; }
    if (event.kind === `${prefix}-end`) { if (start === undefined || event.seconds <= start) throw new Error(`Invalid or unpaired ${prefix}-end`); ranges.push({ start, end: event.seconds }); start = undefined; }
  }
  if (start !== undefined) throw new Error(`Unpaired ${prefix}-start; export refused`);
  return ranges;
}

function union(ranges) {
  const output = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const previous = output.at(-1);
    if (previous && range.start <= previous.end + EPSILON) previous.end = Math.max(previous.end, range.end);
    else output.push({ start: range.start, end: range.end });
  }
  return output;
}

export function planTimeline(duration, inputEvents) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Raw video duration must be positive');
  const events = normalizeEvents(inputEvents, duration);
  const privateRanges = pairs(events, 'private');
  const shortenedWaits = pairs(events, 'wait').filter(range => range.end - range.start > 5);
  for (const wait of shortenedWaits) {
    if (events.some(event => ['caption', 'result'].includes(event.kind) && event.seconds > wait.start + 1.5 && event.seconds < wait.end - 1.5 && !privateRanges.some(hidden => event.seconds >= hidden.start && event.seconds < hidden.end))) throw new Error('A long wait encloses a caption/result action; correct the wait markers to preserve that action');
  }
  const removed = union([...privateRanges, ...shortenedWaits.map(range => ({ start: range.start + 1.5, end: range.end - 1.5 }))]);
  const retained = []; let cursor = 0; let outputCursor = 0;
  for (const range of [...removed, { start: duration, end: duration }]) {
    if (range.start > cursor + EPSILON) { retained.push({ start: cursor, end: range.start, outputStart: outputCursor, outputEnd: outputCursor + range.start - cursor }); outputCursor += range.start - cursor; }
    cursor = Math.max(cursor, range.end);
  }
  if (outputCursor < 0.25) throw new Error('No deliverable footage remains after credential and wait removal');
  const isPrivate = seconds => privateRanges.some(range => seconds >= range.start && seconds < range.end);
  const map = seconds => {
    for (const range of retained) {
      if (seconds < range.start) return range.outputStart;
      if (seconds <= range.end) return range.outputStart + seconds - range.start;
    }
    return outputCursor;
  };
  const fragments = (start, end) => retained.flatMap(range => {
    const left = Math.max(start, range.start); const right = Math.min(end, range.end);
    return right > left + EPSILON ? [{ start: map(left), end: map(right) }] : [];
  });
  const publicEvents = events.filter(event => !event.kind.startsWith('private-') && !isPrivate(event.seconds));
  let captions = publicEvents.flatMap((event, index) => fragments(event.seconds, Math.min(duration, event.seconds + 4, publicEvents[index + 1]?.seconds ?? duration)).map(fragment => ({ ...fragment, label: event.label })));
  for (const wait of shortenedWaits) {
    // Never disclose a wait whose retained edges contain private footage.
    const spans = fragments(wait.start, wait.end);
    if (!spans.length) continue;
    const start = spans[0].start; const end = spans.at(-1).end;
    captions = captions.flatMap(caption => {
      if (caption.end <= start || caption.start >= end) return [caption];
      return [caption.start < start ? { ...caption, end: start } : null, caption.end > end ? { ...caption, start: end } : null].filter(Boolean);
    });
    captions.push({ start, end, label: WAIT_LABEL });
  }
  captions.sort((a, b) => a.start - b.start);
  const bookmarks = publicEvents.map(event => ({ seconds: round(Math.max(0, Math.min(map(event.seconds), outputCursor - 0.2))), rawSeconds: round(event.seconds), kind: event.kind, label: event.label }));
  return { duration: outputCursor, retained, removed, privateRanges, shortenedWaits, captions, bookmarks };
}

const vttTime = seconds => { const milliseconds = Math.max(0, Math.round(seconds * 1000)); return `${String(Math.floor(milliseconds / 3_600_000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60_000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`; };
const assTime = seconds => { const centiseconds = Math.max(0, Math.round(seconds * 100)); return `${Math.floor(centiseconds / 360_000)}:${String(Math.floor(centiseconds / 6000) % 60).padStart(2, '0')}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`; };
const assText = value => value.replace(/\\/g, '/').replace(/\{/g, '(').replace(/\}/g, ')');
const vttText = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function overlays(title, role, timeline) {
  const dialogue = (style, start, end, text) => `Dialogue: 0,${assTime(start)},${assTime(end)},${style},,0,0,0,,${assText(text)}`;
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Caption,Segoe UI,36,&H00FFFFFF,&H00FFFFFF,&HCC000000,&HCC000000,0,0,0,0,100,100,0,0,3,12,0,2,110,110,35,1\nStyle: Banner,Segoe UI,28,&H00FFFFFF,&H00FFFFFF,&HCC000000,&HCC000000,0,0,0,0,100,100,0,0,3,8,0,7,24,24,18,1\nStyle: Disclosure,Segoe UI,21,&H00FFFFFF,&H00FFFFFF,&HCC000000,&HCC000000,0,0,0,0,100,100,0,0,3,6,0,9,24,24,18,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n${dialogue('Banner', 0, timeline.duration, `${role} · ${title}`)}\n${dialogue('Disclosure', 0, timeline.duration, DISCLOSURE)}\n${timeline.captions.map(caption => dialogue('Caption', caption.start, caption.end, caption.label)).join('\n')}\n`;
}

async function encode(raw, stage, name, timeline, title, role) {
  const ass = `${name}.overlay.ass`; const filter = `${name}.filter.txt`; const mp4 = `${name}.mp4`;
  await fs.writeFile(path.join(stage, ass), overlays(title, role, timeline));
  const count = timeline.retained.length;
  // trim/concat preserves action speed. Audio is omitted because Playwright is silent.
  const pieces = timeline.retained.map((range, index) => `[s${index}]trim=start=${range.start.toFixed(6)}:end=${range.end.toFixed(6)},setpts=PTS-STARTPTS[p${index}]`);
  const filters = [count === 1 ? '[0:v]null[s0]' : `[0:v]split=${count}${timeline.retained.map((_, index) => `[s${index}]`).join('')}`, ...pieces, `${timeline.retained.map((_, index) => `[p${index}]`).join('')}concat=n=${count}:v=1:a=0,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,subtitles=${ass},format=yuv420p[out]`];
  await fs.writeFile(path.join(stage, filter), filters.join(';\n'));
  await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-threads', '2', '-i', raw, '-filter_complex_threads', '2', '-filter_complex_script', filter, '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-map_metadata', '-1', mp4], stage);
  const metadata = await probe(path.join(stage, mp4));
  const video = metadata.streams.find(stream => stream.codec_type === 'video');
  const actualDuration = Number(metadata.format.duration);
  if (!video || video.width !== 1920 || video.height !== 1080 || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' || video.display_aspect_ratio !== '16:9' || !Number.isFinite(actualDuration) || Math.abs(actualDuration - timeline.duration) > Math.max(0.12, count / 30 + 0.04)) throw new Error(`MP4 validation failed for ${name}`);
  // Decode validation detects broken packet/frame output in addition to container metadata.
  await command('ffmpeg', ['-v', 'error', '-xerror', '-threads', '2', '-i', path.join(stage, mp4), '-an', '-f', 'null', '-']);
  await fs.unlink(path.join(stage, ass)); await fs.unlink(path.join(stage, filter));
  return { metadata, actualDuration, mp4, sha256: await hash(path.join(stage, mp4)) };
}

function gallery(manifest) {
  const rows = manifest.clips.map(clip => `<article><h2>${html(clip.title)}</h2><p>${html(clip.role)} · ${clip.outputDuration.toFixed(2)} seconds</p><video id="video-${html(clip.name)}" controls preload="metadata"><source src="${html(clip.mp4)}" type="video/mp4"><track src="${html(clip.vtt)}" kind="captions" srclang="en" label="English"></video><p><a href="${html(clip.mp4)}" download>Download MP4</a> · <a href="${html(clip.vtt)}">English captions</a></p><nav>${clip.bookmarks.map(bookmark => `<button data-video="video-${html(clip.name)}" data-seconds="${bookmark.seconds}">${vttTime(bookmark.seconds).slice(0, 8)} · ${html(bookmark.label)}</button>`).join('')}</nav></article>`).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Staff real Test recordings</title><style>body{margin:0;background:#111820;color:#eef5fc;font:16px/1.5 system-ui}main{max-width:1400px;margin:auto;padding:28px}article{margin:28px 0;padding:22px;background:#1b2632;border-radius:14px}video{width:100%;aspect-ratio:16/9;background:#000}a{color:#80d7ff}button{background:#28455d;color:white;border:1px solid #557b94;padding:8px 12px;margin:4px;cursor:pointer;border-radius:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1,h2{line-height:1.2}</style><main><h1>Staff real Test recordings</h1><p>${html(DISCLOSURE)}. UI actions remain at recorded speed. Long waits retain their first and last 1.5 seconds; passwords stay masked; marked private segments are removed.</p><p>These videos show the recorded results. They do not establish Human UAT or universal provider reliability.</p><details><summary>Scope and evidence supplied by the recording run</summary><pre>${html(JSON.stringify(manifest.evidence, null, 2))}</pre></details>${rows}<p><a href="edit-manifest.json">Edit ranges, timeline mapping and SHA-256 hashes</a></p></main><script>document.querySelectorAll('button[data-video]').forEach(button=>button.addEventListener('click',()=>{const video=document.getElementById(button.dataset.video);video.currentTime=Number(button.dataset.seconds);video.play().catch(()=>{});}));</script></html>`;
}

async function exportRecordings(inputName, outputName) {
  const input = await checkedExisting(path.resolve(inputName));
  if (path.extname(input).toLowerCase() !== '.json') throw new Error('Recording input must be a JSON file');
  const out = await checkedOutput(outputName);
  const source = JSON.parse(await fs.readFile(input, 'utf8'));
  if (!Array.isArray(source.clips) || !source.clips.length) throw new Error('Input needs at least one clip');
  const names = new Set(); const prepared = [];
  // Validate every timeline before writing any deliverable media.
  for (const clip of source.clips) {
    if (!clip || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(clip.name) || names.has(clip.name.toLowerCase())) throw new Error('Clip names must be unique safe filename stems');
    names.add(clip.name.toLowerCase());
    const title = english(clip.title, 'clip title'); const role = english(clip.role, 'clip role');
    if (typeof clip.raw !== 'string' || !clip.raw) throw new Error('Clip raw path is required');
    const raw = await checkedExisting(path.resolve(path.dirname(input), clip.raw));
    if (!['.webm', '.mp4', '.mkv', '.mov'].includes(path.extname(raw).toLowerCase())) throw new Error('Raw media must be a supported video file');
    if (inside(out, raw)) throw new Error('Raw video cannot reside in the public output directory');
    const rawMetadata = await probe(raw); const duration = Number(rawMetadata.format.duration);
    if (!rawMetadata.streams.some(stream => stream.codec_type === 'video')) throw new Error('Raw media has no video stream');
    if (clip.duration !== undefined && (!Number.isFinite(clip.duration) || clip.duration <= 0 || Math.abs(clip.duration - duration) > 1)) throw new Error(`Declared and probed duration differ by more than one second for ${clip.name}`);
    prepared.push({ name: clip.name, title, role, raw, rawMetadata, rawDuration: duration, timeline: planTimeline(duration, clip.events) });
  }
  await fs.mkdir(path.dirname(out), { recursive: true });
  const stage = path.join(path.dirname(out), `.staff-export-${randomUUID()}`);
  await fs.mkdir(stage);
  try {
    const evidence = Object.fromEntries(['scope', 'evidence', 'limitations', 'checks', 'humanUat'].filter(key => source[key] !== undefined).map(key => [key, source[key]]));
    if (!Object.keys(evidence).length) evidence.note = 'No additional scope or acceptance evidence was supplied in the input.';
    const manifest = { formatVersion: 1, generatedAt: new Date().toISOString(), disclosure: DISCLOSURE, input: path.relative(ROOT, input).replace(/\\/g, '/'), inputSha256: await hash(input), evidence, editing: { actionSpeed: 1, longWaitThresholdSeconds: 5, retainedWaitEdgeSeconds: 1.5, credentialIntervals: 'removed completely', resultStates: 'recorded footage only', audio: 'silent Playwright video; no audio track', rawCopied: false }, clips: [] };
    for (const clip of prepared) {
      console.log(`Exporting ${clip.name}: ${round(clip.rawDuration)}s raw → ${round(clip.timeline.duration)}s edited`);
      const result = await encode(clip.raw, stage, clip.name, clip.timeline, clip.title, clip.role);
      const captions = clip.timeline.captions.map(caption => ({ ...caption, start: Math.max(0, Math.min(caption.start, result.actualDuration)), end: Math.min(caption.end, result.actualDuration) })).filter(caption => caption.end > caption.start);
      const bookmarks = clip.timeline.bookmarks.map(bookmark => ({ ...bookmark, seconds: round(Math.min(bookmark.seconds, Math.max(0, result.actualDuration - 0.2))) }));
      const vtt = `${clip.name}.vtt`;
      await fs.writeFile(path.join(stage, vtt), `WEBVTT\n\n${captions.map((caption, index) => `${index + 1}\n${vttTime(caption.start)} --> ${vttTime(caption.end)}\n${vttText(caption.label)}\n`).join('\n')}`);
      manifest.clips.push({ name: clip.name, title: clip.title, role: clip.role, raw: path.relative(ROOT, clip.raw).replace(/\\/g, '/'), rawSha256: await hash(clip.raw), rawDuration: clip.rawDuration, plannedOutputDuration: clip.timeline.duration, outputDuration: result.actualDuration, mp4: result.mp4, vtt, mp4Sha256: result.sha256, vttSha256: await hash(path.join(stage, vtt)), retainedRanges: clip.timeline.retained, removedRanges: clip.timeline.removed, privateRanges: clip.timeline.privateRanges, shortenedWaits: clip.timeline.shortenedWaits, captions, bookmarks, ffprobe: result.metadata, decodeValidation: 'completed without ffmpeg decode errors' });
    }
    await fs.writeFile(path.join(stage, 'edit-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await fs.writeFile(path.join(stage, 'index.html'), gallery(manifest));
    await fs.rename(stage, out);
    console.log(`Exported ${manifest.clips.length} clip(s): ${path.relative(ROOT, out)}`);
    return manifest;
  } catch (error) {
    // Only this exact exporter-owned directory is removed, after path verification.
    if (inside(REPORTS, stage) && path.basename(stage).startsWith('.staff-export-')) await fs.rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function selfCheck(media) {
  const events = [{ seconds: 1, kind: 'caption', label: 'Open orders' }, { seconds: 2, kind: 'private-start' }, { seconds: 4, kind: 'private-end' }, { seconds: 5, kind: 'wait-start', label: 'Waiting for the recorded response' }, { seconds: 15, kind: 'wait-end', label: 'Response arrived' }, { seconds: 19.9, kind: 'result', label: 'Recorded result' }];
  const plan = planTimeline(20, events);
  assert.equal(plan.duration, 11);
  assert.deepEqual(plan.removed, [{ start: 2, end: 4 }, { start: 6.5, end: 13.5 }]);
  assert.equal(plan.bookmarks.at(-1).seconds, 10.8);
  assert.equal(plan.bookmarks.find(bookmark => bookmark.kind === 'wait-end').seconds, 6);
  assert.deepEqual(plan.captions.filter(caption => caption.label === WAIT_LABEL), [{ start: 3, end: 6, label: WAIT_LABEL }]);
  assert.throws(() => planTimeline(20, [{ seconds: 2, kind: 'private-start' }]), /Unpaired/);
  assert.throws(() => planTimeline(20, [{ seconds: 2, kind: 'private-end' }]), /unpaired/);
  assert.throws(() => planTimeline(20, [{ seconds: 2, kind: 'wait-start', label: 'Wait' }]), /Unpaired/);
  assert.throws(() => planTimeline(20, [{ seconds: 2, kind: 'wait-start', label: 'Wait' }, { seconds: 8, kind: 'caption', label: 'Click recorded control' }, { seconds: 15, kind: 'wait-end', label: 'Result' }]), /preserve that action/);
  assert.throws(() => planTimeline(20, [{ seconds: -1, kind: 'caption', label: 'Invalid time' }]), /Invalid event/);
  assert.throws(() => planTimeline(20, [{ seconds: 1, kind: 'unknown', label: 'Invalid kind' }]), /Invalid event/);
  assert.throws(() => planTimeline(20, [{ seconds: 2, kind: 'caption', label: '中文' }]), /English/);
  assert.ok(plan.bookmarks.every(bookmark => !bookmark.kind.startsWith('private-')));
  assert.ok(plan.retained.every(range => !plan.privateRanges.some(hidden => range.start < hidden.end && range.end > hidden.start)));
  assert.equal(vttText('A < B & C > D'), 'A &lt; B &amp; C &gt; D');
  const overlap = planTimeline(20, [{ seconds: 2, kind: 'wait-start', label: 'Wait' }, { seconds: 7, kind: 'private-start' }, { seconds: 11, kind: 'private-end' }, { seconds: 15, kind: 'wait-end', label: 'Result' }]);
  assert.equal(overlap.duration, 10);
  assert.deepEqual(overlap.removed, [{ start: 3.5, end: 13.5 }]);
  console.log('Synthetic timeline self-check completed (not product evidence).');
  if (!media) return;
  const temporary = path.join(REPORTS, `.staff-export-selfcheck-${randomUUID()}`);
  await fs.mkdir(temporary);
  try {
    await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=8', '-threads', '2', '-c:v', 'libvpx', '-deadline', 'realtime', path.join(temporary, 'synthetic.webm')]);
    await fs.writeFile(path.join(temporary, 'input.json'), JSON.stringify({ scope: 'Synthetic exporter validation only. No product, Auth, database or provider evidence.', clips: [{ name: 'synthetic', title: 'Exporter validation', role: 'Synthetic', raw: 'synthetic.webm', duration: 8, events: [{ seconds: 0, kind: 'wait-start', label: 'Synthetic wait' }, { seconds: 6, kind: 'wait-end', label: 'Synthetic result' }, { seconds: 6.1, kind: 'private-start' }, { seconds: 7, kind: 'private-end' }, { seconds: 7.5, kind: 'result', label: 'Synthetic final frame' }] }] }));
    const manifest = await exportRecordings(path.join(temporary, 'input.json'), path.join(temporary, 'output'));
    assert.ok(Math.abs(manifest.clips[0].outputDuration - 4.1) < 0.12);
    assert.ok(manifest.clips[0].bookmarks.every(bookmark => bookmark.seconds <= manifest.clips[0].outputDuration - 0.199));
    const files = await fs.readdir(path.join(temporary, 'output'));
    assert.deepEqual(files.sort(), ['edit-manifest.json', 'index.html', 'synthetic.mp4', 'synthetic.vtt']);
    console.log('Synthetic FFmpeg MP4/decode/export self-check completed (not product evidence).');
  } finally {
    if (inside(REPORTS, temporary) && path.basename(temporary).startsWith('.staff-export-selfcheck-')) await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--self-check', '--self-check-media'].includes(args[0])) return selfCheck(args[0] === '--self-check-media');
  if (args.length !== 4 || !args.includes('--input') || !args.includes('--out')) throw new Error('Usage: node scripts/tests/staff-recording-export.mjs --input <json> --out <new reports directory> | --self-check | --self-check-media');
  const input = args[args.indexOf('--input') + 1]; const out = args[args.indexOf('--out') + 1];
  if (!input || !out || input.startsWith('--') || out.startsWith('--')) throw new Error('Both --input and --out need path values');
  await exportRecordings(input, out);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
