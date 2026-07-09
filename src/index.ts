#!/usr/bin/env node

import { createRequire } from 'node:module';
import { formatDoctorReport, runDoctor } from './doctor.js';
import { createReadVideoHandler } from './handlers/readVideo.js';
import { createVideoEvidenceHandler } from './handlers/videoEvidence.js';
import { createServer, http, stdio } from './mcp.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version: string };

const transportType = process.env['MCP_TRANSPORT'] ?? 'stdio';
const httpPort = Number.parseInt(process.env['MCP_HTTP_PORT'] ?? '8080', 10);
const httpHost = process.env['MCP_HTTP_HOST'] ?? '127.0.0.1';
const apiKey = process.env['MCP_API_KEY'];
const corsOrigin = process.env['MCP_CORS_ORIGIN'];

const isLoopbackHost = (host: string): boolean =>
  host === 'localhost' || host === '::1' || host === '127.0.0.1' || host.startsWith('127.');

function createTransport() {
  if (transportType === 'http') {
    return http({
      port: httpPort,
      hostname: httpHost,
      ...(corsOrigin ? { cors: corsOrigin } : {}),
      ...(apiKey ? { apiKey } : {}),
    });
  }
  return stdio();
}

const server = createServer({
  name: 'video-reader-mcp',
  version: packageJson.version,
  instructions:
    'Evidence-first video reader. Use read_video to extract ffprobe metadata, embedded subtitles, scene boundaries, and timeline warnings. Use video_evidence for timestamped frame render or crop follow-up without frame-by-frame vision LLM calls.',
  tools: {
    read_video: createReadVideoHandler(packageJson.version),
    video_evidence: createVideoEvidenceHandler(),
  },
  transport: createTransport(),
});

const logHttpStartup = (): void => {
  console.log(`[Video Reader MCP] Server running on http://${httpHost}:${httpPort}/mcp`);
  console.log(`[Video Reader MCP] Health check: http://${httpHost}:${httpPort}/mcp/health`);
  if (apiKey) {
    console.log('[Video Reader MCP] API key authentication enabled (X-API-Key header)');
  } else if (!isLoopbackHost(httpHost)) {
    console.warn(
      `[Video Reader MCP] WARNING: bound to non-loopback host ${httpHost} with no API key. ` +
        'Any client that can reach this port can read every video this process can access. ' +
        'Set MCP_API_KEY to require an X-API-Key header, or bind MCP_HTTP_HOST=127.0.0.1.'
    );
  }
  if (corsOrigin) {
    console.log(`[Video Reader MCP] CORS allowed origin: ${corsOrigin}`);
  }
  console.log('[Video Reader MCP] Project root:', process.cwd());
};

async function main(): Promise<void> {
  if (process.argv[2] === 'doctor') {
    const report = await runDoctor(packageJson.version);
    console.log(formatDoctorReport(report));
    process.exit(report.status === 'unavailable' ? 1 : 0);
  }

  await server.start();

  if (transportType === 'http') {
    logHttpStartup();
  } else if (process.env['DEBUG_MCP']) {
    console.error('[Video Reader MCP] Server running on stdio');
    console.error('[Video Reader MCP] Project root:', process.cwd());
  }
}

main().catch((error: unknown) => {
  console.error('[Video Reader MCP] Server error:', error);
  process.exit(1);
});
