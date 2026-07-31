export interface Provenance {
  source: string;
  tool: 'read_video';
  version: string;
  extracted_at: string;
  source_hash?: string;
  cache_key?: string;
  assembly_route?: string;
}

export interface StreamInfo {
  index: number;
  codec_type: string;
  codec_name?: string;
  language?: string;
  channels?: number;
  sample_rate?: number;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: number;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
}

export interface ChapterInfo {
  id: number;
  start_ms: number;
  end_ms: number;
  title?: string;
}

export interface SceneInfo {
  index: number;
  time_ms: number;
  provenance: {
    method: 'ffmpeg_scene_filter';
    threshold: number;
  };
}

export interface SubtitleCue {
  index: number;
  start_ms: number;
  end_ms: number;
  text: string;
  stream_index?: number;
  language?: string;
  provenance: {
    method: 'ffmpeg_extract' | 'embedded_parse';
    format: 'srt' | 'vtt' | 'webvtt';
  };
}

export interface TranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  provenance: {
    method: 'asr_adapter';
    adapter: string;
  };
}

export interface FrameEvidence {
  index: number;
  time_ms: number;
  provenance: {
    method: 'ffmpeg_keyframe_select';
    pict_type: 'I';
  };
  route?: string;
  frame_hash?: string;
  mime?: string;
  width?: number;
  height?: number;
  image_base64?: string;
}

export interface FormatInfo {
  format_name?: string;
  duration_ms: number;
  bit_rate?: number;
  size_bytes?: number;
  tags?: Record<string, string>;
}

export interface TimelineDocument {
  provenance: Provenance;
  format: FormatInfo;
  streams: StreamInfo[];
  chapters: ChapterInfo[];
  scenes: SceneInfo[];
  subtitles: SubtitleCue[];
  transcript: TranscriptSegment[];
  keyframes: FrameEvidence[];
  warnings: string[];
  /** Text outline of film architecture for non-vision agents. */
  agent_index?: {
    policy: string;
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
}

export interface VideoSourceResult {
  source: string;
  success: boolean;
  data?: TimelineDocument;
  error?: string;
}
