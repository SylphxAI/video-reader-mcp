import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

const readText = (path: string) => readFileSync(path, 'utf8');

describe('README discovery surfaces', () => {
  it('keeps pain-first fold content and honest discovery status', () => {
    const readme = readText('README.md');

    expect(readme).toContain('Did it read the timeline?');
    expect(readme).toContain('## Why not frame-by-frame vision?');
    expect(readme).toContain('20 tests');
    expect(readme).toMatch(/Star the repo|Star this repo/);
    expect(readme).not.toMatch(/Listed on \[MCP Servers\]/);
    expect(readme).toContain('Not listed yet');
    expect(readme).toContain('glama.ai/mcp/servers/SylphxAI/video-reader-mcp');
    expect(readme).toContain('registry.modelcontextprotocol.io');
    expect(readme).toContain('io.github.SylphxAI/video-reader-mcp');
    expect(readme).not.toContain('Publishing on next release');
    expect(readme).toContain('chatmcp/mcpso/issues/3068');
    expect(readme).toContain('Listed — `io.github.SylphxAI/video-reader-mcp`');
    expect(readme).toContain('ffprobe');
    expect(readme).toContain('smart-reader-mcp');
    expect(readme).not.toContain('not in pdf-reader-mcp');
    expect(readme).not.toContain('polluting pdf-reader');
    expect(readme).not.toContain('ADR-0002');
  });

  it('ships official MCP Registry metadata aligned with package.json', () => {
    const pkg = JSON.parse(readText('package.json'));
    const server = JSON.parse(readText('server.json'));

    expect(pkg.mcpName).toBe('io.github.SylphxAI/video-reader-mcp');
    expect(server.name).toBe(pkg.mcpName);
    expect(server.packages[0].identifier).toBe(pkg.name);
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].version).toBe(pkg.version);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(existsSync('.github/workflows/publish-mcp-registry.yml')).toBe(true);
  });
});
