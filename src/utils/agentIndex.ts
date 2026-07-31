/**
 * Agent Index: a text-first reformatting of video structure.
 * Agents "read" the film (timeline architecture), not sample arbitrary frames.
 */

export type AgentVideoIndex = {
  policy: 'agent_video_index_v1';
  source: string;
  duration_ms?: number;
  outline: string;
  scene_count: number;
  keyframe_count: number;
  subtitle_cue_count: number;
  transcript_segment_count: number;
  audio_stream_count: number;
  video_stream_count: number;
};

export function buildAgentVideoIndex(doc: {
  provenance: { source: string };
  format?: { duration_ms?: number; format_name?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
  scenes?: Array<{ time_ms?: number }>;
  keyframes?: Array<{ time_ms?: number; frame_hash?: string }>;
  subtitles?: Array<{ cues?: unknown[]; text?: string }>;
  transcript?: Array<{ text?: string; start_ms?: number }>;
  warnings?: string[];
}): AgentVideoIndex {
  const streams = doc.streams ?? [];
  const audio = streams.filter((s) => s.codec_type === 'audio');
  const video = streams.filter((s) => s.codec_type === 'video');
  const scenes = doc.scenes ?? [];
  const keyframes = doc.keyframes ?? [];
  const subtitleCueCount = (doc.subtitles ?? []).reduce((n, s) => {
    if (Array.isArray(s.cues)) return n + s.cues.length;
    return n + (s.text ? 1 : 0);
  }, 0);
  const transcript = doc.transcript ?? [];
  const duration = doc.format?.duration_ms;

  const lines: string[] = [
    `# Video index: ${doc.provenance.source}`,
    `- duration_ms: ${duration ?? 'unknown'}`,
    `- container: ${doc.format?.format_name ?? 'unknown'}`,
    `- video_streams: ${video.length}${video[0] ? ` (${video[0].width ?? '?'}x${video[0].height ?? '?'} ${video[0].codec_name ?? ''})` : ''}`,
    `- audio_streams: ${audio.length}${audio[0] ? ` (${audio[0].codec_name ?? ''})` : ''}`,
    `- scenes: ${scenes.length}`,
    `- structural_keyframes: ${keyframes.length}`,
    `- subtitle_cues: ${subtitleCueCount}`,
    `- transcript_segments: ${transcript.length}`,
  ];

  if (scenes.length > 0) {
    lines.push('', '## Scene architecture (not fixed-interval sampling)');
    scenes.slice(0, 40).forEach((s, i) => {
      lines.push(`- scene cut ${i + 1}: ${s.time_ms ?? '?'}ms`);
    });
    if (scenes.length > 40) lines.push(`- … ${scenes.length - 40} more scenes`);
  }

  if (keyframes.length > 0) {
    lines.push('', '## Structural keyframe locators');
    keyframes.slice(0, 32).forEach((k, i) => {
      lines.push(
        `- kf ${i + 1}: t=${k.time_ms ?? '?'}ms hash=${String(k.frame_hash ?? '').slice(0, 12) || 'n/a'}`
      );
    });
  }

  if (subtitleCueCount > 0) {
    lines.push('', '## Subtitles present (embedded) — prefer as dialogue evidence over vision');
  }
  if (transcript.length > 0) {
    lines.push('', '## Transcript segments (optional ASR)');
    transcript.slice(0, 12).forEach((tseg) => {
      const text = String(tseg.text ?? '')
        .replace(/\s+/g, ' ')
        .slice(0, 120);
      lines.push(`- ${tseg.start_ms ?? '?'}ms: ${text}`);
    });
  }

  if ((doc.warnings ?? []).length > 0) {
    lines.push('', '## Warnings', ...(doc.warnings ?? []).map((w) => `- ${w}`));
  }

  lines.push(
    '',
    '## Agent guidance',
    '- Use scenes + keyframe locators for structure; do not invent uniform N-second sampling as architecture.',
    '- For pixel-level claims, follow up with video_evidence render_frame/crop_frame at a locator time_ms.',
    '- Optional LLM vision is non-authority; timeline evidence is the local-first truth.'
  );

  return {
    policy: 'agent_video_index_v1',
    source: doc.provenance.source,
    ...(duration !== undefined ? { duration_ms: duration } : {}),
    outline: lines.join('\n'),
    scene_count: scenes.length,
    keyframe_count: keyframes.length,
    subtitle_cue_count: subtitleCueCount,
    transcript_segment_count: transcript.length,
    audio_stream_count: audio.length,
    video_stream_count: video.length,
  };
}
