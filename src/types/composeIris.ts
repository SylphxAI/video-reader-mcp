export interface ComposedKeyframeObject {
  id: string;
  label: string;
  category?: string | undefined;
  bbox?: { x: number; y: number; width: number; height: number } | undefined;
  score?: number | undefined;
  mask_ref?: string | null | undefined;
}

export interface ComposedKeyframe {
  time_ms: number;
  frame: string;
  semantics_available: boolean;
  skipped_reason?: string | undefined;
  objects: ComposedKeyframeObject[];
  caption?: string | undefined;
  model?: string | undefined;
}

export interface ComposedIrisResult {
  policy: 'cue_compose_iris_v1';
  video: string;
  keyframe_policy: string;
  generated_at: string;
  keyframe_count: number;
  total_objects: number;
  keyframes: ComposedKeyframe[];
  warnings: string[];
}
