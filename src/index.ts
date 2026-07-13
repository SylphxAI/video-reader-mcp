#!/usr/bin/env node

import { createRequire } from 'node:module';
import { formatDoctorReport, runDoctor } from './doctor.js';
import { createReadVideoHandler } from './handlers/readVideo.js';
import { createVideoEvidenceHandler } from './handlers/videoEvidence.js';
import { createServer, stdio } from './mcp.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version: string };

const server = createServer({
  name: 'video-reader-mcp',
  version: packageJson.version,
  instructions:
    'Evidence-first video reader. Use read_video to extract ffprobe metadata, embedded subtitles, scene boundaries, and timeline warnings. Use video_evidence for timestamped frame render or crop follow-up without frame-by-frame vision LLM calls.',
  tools: {
    read_video: createReadVideoHandler(packageJson.version),
    video_evidence: createVideoEvidenceHandler(),
  },
  transport: stdio(),
});

async function main(): Promise<void> {
  if (process.argv[2] === 'doctor') {
    const report = await runDoctor(packageJson.version);
    console.log(formatDoctorReport(report));
    process.exit(report.status === 'unavailable' ? 1 : 0);
  }

  await server.start();

  if (process.env['DEBUG_MCP']) {
    console.error('[Video Reader MCP] Server running on stdio');
    console.error('[Video Reader MCP] Project root:', process.cwd());
  }
}

main().catch((error: unknown) => {
  console.error('[Video Reader MCP] Server error:', error);
  process.exit(1);
});
