#!/usr/bin/env bun
/**
 * TS pure-contract oracle for video-reader-mcp differential residual (rej-010 / BW2).
 *
 * Pure residual only:
 * - tool route contract / allow-list / server contract
 * - hash_source (sha256 file bytes)
 * - build_cache_key (sha256 of source_hash + canonical CacheOptions JSON)
 * - assemble_probe_timeline from probe fixtures (pure JSON transform)
 *
 * Fail-closed: no SKIP-as-pass. Does NOT claim read_video effect parity,
 * ffprobe/ffmpeg effect, HTTP transport, parity_proven, or authority_rust.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");
const CORPUS_PATH = join(__dirname, "fixtures/video-reader-mcp-corpus.json");
const FIXTURES_ROOT = join(REPO_ROOT, "test/fixtures");

interface ToolRouteCase {
  id: string;
  tool: string;
  expect: string;
}

interface HashCase {
  id: string;
  fixture: string;
  expect: { status: "ok"; source_hash: string };
}

interface CacheKeyCase {
  id: string;
  source_hash: string;
  options: Record<string, unknown>;
  expect: { status: "ok"; cache_key: string };
}

interface TimelineCase {
  id: string;
  probe_fixture: string;
  options: { include_streams: boolean; include_chapters: boolean };
  expect: {
    status: "ok";
    route: string;
    duration_ms?: number;
    stream_count?: number;
    chapter_title?: string;
    warnings_contains: string[];
  };
}

interface Corpus {
  corpusVersion: number;
  toolRouteCases: ToolRouteCase[];
  serverContract: { name: string; version: string; tools: string[] };
  allowList: { tools: string[] };
  hashCases: HashCase[];
  cacheKeyCases: CacheKeyCase[];
  timelineCases: TimelineCase[];
}

export interface DifferentialCase {
  readonly id: string;
  readonly slice: string;
  readonly domain:
    | "toolRouteContract"
    | "serverContract"
    | "allowList"
    | "hash"
    | "cacheKey"
    | "timeline";
  readonly input: Record<string, unknown>;
  readonly output: unknown;
}

function fixtureCorpusHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function pureHashSource(filePath: string): string {
  const bytes = readFileSync(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

/** Match Rust video_reader_core::hash::build_cache_key serialization order. */
function pureBuildCacheKey(
  sourceHash: string,
  options: Record<string, unknown>
): string {
  const ordered = {
    include_streams: options.include_streams,
    include_chapters: options.include_chapters,
    include_subtitles: options.include_subtitles,
    include_scenes: options.include_scenes,
    include_transcript: options.include_transcript,
    include_keyframes: options.include_keyframes,
    include_keyframe_images: options.include_keyframe_images,
    keyframe_limit: options.keyframe_limit,
    keyframe_max_dimension:
      options.keyframe_max_dimension === undefined
        ? null
        : options.keyframe_max_dimension,
    scene_threshold: options.scene_threshold,
  };
  const canonical = JSON.stringify(ordered);
  const payload = `${sourceHash}:${canonical}`;
  return createHash("sha256").update(payload).digest("hex");
}

function secondsToMs(value: unknown): number {
  if (value === undefined || value === null) return 0;
  let seconds: number | undefined;
  if (typeof value === "number") seconds = value;
  else if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    seconds = Number.isFinite(parsed) ? parsed : undefined;
  }
  if (seconds === undefined || !Number.isFinite(seconds)) return 0;
  return Math.round(seconds * 1000);
}

function parseU64(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function mapStreams(streams: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const stream of streams) {
    if (!stream || typeof stream !== "object") continue;
    const s = stream as Record<string, unknown>;
    const index = parseU64(s.index);
    const codecType = typeof s.codec_type === "string" ? s.codec_type : undefined;
    if (index === undefined || !codecType) continue;
    const tags =
      s.tags && typeof s.tags === "object"
        ? (s.tags as Record<string, unknown>)
        : undefined;
    const language =
      tags && typeof tags.language === "string" ? tags.language : undefined;
    const sampleRate =
      typeof s.sample_rate === "string"
        ? Number.parseInt(s.sample_rate, 10)
        : undefined;
    const bitRate =
      typeof s.bit_rate === "string" ? Number.parseInt(s.bit_rate, 10) : undefined;
    const entry: Record<string, unknown> = {
      index,
      codec_type: codecType,
    };
    if (typeof s.codec_name === "string") entry.codec_name = s.codec_name;
    if (language) entry.language = language;
    if (parseU64(s.channels) !== undefined) entry.channels = parseU64(s.channels);
    if (sampleRate !== undefined && Number.isFinite(sampleRate)) {
      entry.sample_rate = sampleRate;
    }
    if (parseU64(s.width) !== undefined) entry.width = parseU64(s.width);
    if (parseU64(s.height) !== undefined) entry.height = parseU64(s.height);
    if (typeof s.avg_frame_rate === "string") entry.avg_frame_rate = s.avg_frame_rate;
    if (typeof s.r_frame_rate === "string") entry.r_frame_rate = s.r_frame_rate;
    if (bitRate !== undefined && Number.isFinite(bitRate)) entry.bit_rate = bitRate;
    if (s.disposition && typeof s.disposition === "object") {
      entry.disposition = s.disposition;
    }
    if (tags) entry.tags = tags;
    out.push(entry);
  }
  return out;
}

function mapChapters(chapters: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const chapter of chapters) {
    if (!chapter || typeof chapter !== "object") continue;
    const c = chapter as Record<string, unknown>;
    const id = parseU64(c.id);
    if (id === undefined) continue;
    const tags =
      c.tags && typeof c.tags === "object"
        ? (c.tags as Record<string, unknown>)
        : undefined;
    const title =
      tags && typeof tags.title === "string" ? tags.title : undefined;
    const entry: Record<string, unknown> = {
      id,
      start_ms: secondsToMs(c.start),
      end_ms: secondsToMs(c.end),
    };
    if (title) entry.title = title;
    out.push(entry);
  }
  return out;
}

function collectWarnings(
  streams: unknown[],
  format: Record<string, unknown>,
  includeStreams: boolean
): string[] {
  const warnings: string[] = [];
  if (includeStreams) {
    const video = streams.filter(
      (s) =>
        s &&
        typeof s === "object" &&
        (s as Record<string, unknown>).codec_type === "video"
    );
    const audio = streams.filter(
      (s) =>
        s &&
        typeof s === "object" &&
        (s as Record<string, unknown>).codec_type === "audio"
    );
    if (video.length === 0) warnings.push("No video stream detected.");
    if (audio.length === 0) warnings.push("No audio stream detected.");
    for (const stream of video) {
      const s = stream as Record<string, unknown>;
      const avg = typeof s.avg_frame_rate === "string" ? s.avg_frame_rate : undefined;
      const r = typeof s.r_frame_rate === "string" ? s.r_frame_rate : undefined;
      if (avg && r && avg !== r) {
        const index =
          parseU64(s.index) !== undefined ? String(parseU64(s.index)) : "?";
        warnings.push(
          `Stream ${index}: variable frame rate suspected (avg_frame_rate=${avg}, r_frame_rate=${r}).`
        );
      }
    }
  }
  const durationSeconds = (() => {
    const d = format.duration;
    if (typeof d === "string") {
      const n = Number.parseFloat(d);
      return Number.isFinite(n) ? n : 0;
    }
    if (typeof d === "number") return d;
    return 0;
  })();
  if (durationSeconds <= 0) {
    warnings.push(
      "Duration unavailable or zero; timeline bounds may be incomplete."
    );
  }
  return warnings;
}

function pureAssembleProbeTimeline(
  ffprobe: Record<string, unknown>,
  options: { include_streams: boolean; include_chapters: boolean }
): Record<string, unknown> {
  const streamsValue = Array.isArray(ffprobe.streams) ? ffprobe.streams : [];
  const chaptersValue = Array.isArray(ffprobe.chapters) ? ffprobe.chapters : [];
  const formatValue =
    ffprobe.format && typeof ffprobe.format === "object"
      ? (ffprobe.format as Record<string, unknown>)
      : {};

  const format: Record<string, unknown> = {
    duration_ms: secondsToMs(formatValue.duration),
  };
  if (typeof formatValue.format_name === "string") {
    format.format_name = formatValue.format_name;
  }
  if (typeof formatValue.bit_rate === "string") {
    const n = Number.parseInt(formatValue.bit_rate, 10);
    if (Number.isFinite(n)) format.bit_rate = n;
  }
  if (typeof formatValue.size === "string") {
    const n = Number.parseInt(formatValue.size, 10);
    if (Number.isFinite(n)) format.size_bytes = n;
  }
  if (formatValue.tags && typeof formatValue.tags === "object") {
    format.tags = formatValue.tags;
  }

  const warnings = collectWarnings(
    streamsValue,
    formatValue,
    options.include_streams
  );

  return {
    format,
    streams: options.include_streams ? mapStreams(streamsValue) : [],
    chapters: options.include_chapters ? mapChapters(chaptersValue) : [],
    warnings,
    route: "rust-timeline",
  };
}

function timelineView(
  timeline: Record<string, unknown>,
  expect: TimelineCase["expect"]
): Record<string, unknown> {
  const streams = Array.isArray(timeline.streams) ? timeline.streams : [];
  const chapters = Array.isArray(timeline.chapters) ? timeline.chapters : [];
  const format =
    timeline.format && typeof timeline.format === "object"
      ? (timeline.format as Record<string, unknown>)
      : {};
  const warnings = Array.isArray(timeline.warnings)
    ? (timeline.warnings as string[])
    : [];

  const view: Record<string, unknown> = {
    status: "ok",
    route: timeline.route,
    duration_ms: format.duration_ms ?? 0,
    stream_count: streams.length,
    chapter_title:
      chapters[0] && typeof chapters[0] === "object"
        ? ((chapters[0] as Record<string, unknown>).title ?? null)
        : null,
    warnings,
  };

  // Validate against corpus expect needles for fail-closed oracle self-check
  if (expect.duration_ms !== undefined && view.duration_ms !== expect.duration_ms) {
    throw new Error(
      `oracle duration_ms mismatch: got ${view.duration_ms} expected ${expect.duration_ms}`
    );
  }
  if (
    expect.stream_count !== undefined &&
    view.stream_count !== expect.stream_count
  ) {
    throw new Error(
      `oracle stream_count mismatch: got ${view.stream_count} expected ${expect.stream_count}`
    );
  }
  if (
    expect.chapter_title !== undefined &&
    view.chapter_title !== expect.chapter_title
  ) {
    throw new Error(
      `oracle chapter_title mismatch: got ${view.chapter_title} expected ${expect.chapter_title}`
    );
  }
  for (const needle of expect.warnings_contains) {
    if (!warnings.some((w) => w.includes(needle))) {
      throw new Error(
        `oracle warnings missing needle "${needle}": ${JSON.stringify(warnings)}`
      );
    }
  }
  if (timeline.route !== expect.route) {
    throw new Error(
      `oracle route mismatch: got ${timeline.route} expected ${expect.route}`
    );
  }
  return view;
}

async function main(): Promise<void> {
  const raw = await readFile(CORPUS_PATH, "utf8");
  const corpus = JSON.parse(raw) as Corpus;
  if (corpus.corpusVersion !== 1) {
    throw new Error(`unsupported corpusVersion: ${corpus.corpusVersion}`);
  }

  const cases: DifferentialCase[] = [];

  for (const testCase of corpus.toolRouteCases) {
    cases.push({
      id: testCase.id,
      slice: "tool-route-contract",
      domain: "toolRouteContract",
      input: { tool: testCase.tool },
      output: { route: testCase.expect },
    });
  }

  cases.push({
    id: "allow-list-tools",
    slice: "allow-list",
    domain: "allowList",
    input: { tools: corpus.allowList.tools },
    output: { tools: corpus.allowList.tools },
  });

  cases.push({
    id: "server-contract-rmcp",
    slice: "server-contract",
    domain: "serverContract",
    input: { tools: corpus.serverContract.tools },
    output: {
      name: corpus.serverContract.name,
      version: corpus.serverContract.version,
      tools: corpus.serverContract.tools,
    },
  });

  for (const testCase of corpus.hashCases) {
    const fixturePath = resolve(FIXTURES_ROOT, testCase.fixture);
    if (!existsSync(fixturePath)) {
      throw new Error(`missing hash fixture ${testCase.fixture} at ${fixturePath}`);
    }
    const sourceHash = pureHashSource(fixturePath);
    if (sourceHash !== testCase.expect.source_hash) {
      throw new Error(
        `TS pure hash mismatch for ${testCase.id}: got ${sourceHash} expected ${testCase.expect.source_hash}`
      );
    }
    cases.push({
      id: testCase.id,
      slice: "pure-hash",
      domain: "hash",
      input: { fixture: testCase.fixture },
      output: { status: "ok", source_hash: sourceHash },
    });
  }

  for (const testCase of corpus.cacheKeyCases) {
    const cacheKey = pureBuildCacheKey(testCase.source_hash, testCase.options);
    if (cacheKey !== testCase.expect.cache_key) {
      throw new Error(
        `TS pure cache_key mismatch for ${testCase.id}: got ${cacheKey} expected ${testCase.expect.cache_key}`
      );
    }
    cases.push({
      id: testCase.id,
      slice: "pure-cache-key",
      domain: "cacheKey",
      input: {
        source_hash: testCase.source_hash,
        options: testCase.options,
      },
      output: { status: "ok", cache_key: cacheKey },
    });
  }

  for (const testCase of corpus.timelineCases) {
    const probePath = resolve(FIXTURES_ROOT, testCase.probe_fixture);
    if (!existsSync(probePath)) {
      throw new Error(
        `missing probe fixture ${testCase.probe_fixture} at ${probePath}`
      );
    }
    const probe = JSON.parse(await readFile(probePath, "utf8")) as Record<
      string,
      unknown
    >;
    const timeline = pureAssembleProbeTimeline(probe, {
      include_streams: testCase.options.include_streams,
      include_chapters: testCase.options.include_chapters,
    });
    const view = timelineView(timeline, testCase.expect);
    cases.push({
      id: testCase.id,
      slice: "pure-timeline",
      domain: "timeline",
      input: {
        probe_fixture: testCase.probe_fixture,
        options: testCase.options,
      },
      output: view,
    });
  }

  const payload = {
    corpusVersion: corpus.corpusVersion,
    fixtureCorpusHash: fixtureCorpusHash(raw),
    cases,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

await main();
