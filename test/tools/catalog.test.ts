import { describe, it, expect } from 'vitest';
import { getBuiltinToolCatalog } from '../../src/tools/catalog.js';

describe('getBuiltinToolCatalog', () => {
  it('returns two servers: da-tools and eds-preview', () => {
    const catalog = getBuiltinToolCatalog();
    expect(catalog.servers).toHaveLength(2);
    expect(catalog.servers[0].id).toBe('da-tools');
    expect(catalog.servers[1].id).toBe('eds-preview');
  });

  it('da-tools server includes DA + canvas tools', () => {
    const catalog = getBuiltinToolCatalog();
    const daServer = catalog.servers[0];
    expect(daServer.transport).toBe('built-in');
    const names = daServer.tools.map((t) => t.name);
    expect(names).toContain('content_list');
    expect(names).toContain('content_read');
    expect(names).toContain('content_create');
    expect(names).toContain('content_update');
    expect(names).toContain('content_upload');
    expect(names).toContain('da_get_skill');
    expect(names).toContain('da_create_skill');
    expect(names).toContain('write_project_memory');
    expect(names).toContain('da_bulk_preview');
    expect(names).toContain('da_bulk_publish');
  });

  it('eds-preview server includes EDS tools', () => {
    const catalog = getBuiltinToolCatalog();
    const edsServer = catalog.servers[1];
    expect(edsServer.transport).toBe('built-in');
    const names = edsServer.tools.map((t) => t.name);
    expect(names).toContain('content_preview');
    expect(names).toContain('content_publish');
    expect(names).toContain('content_unpreview');
    expect(names).toContain('content_unpublish');
  });

  it('each tool has a name and description', () => {
    const catalog = getBuiltinToolCatalog();
    for (const server of catalog.servers) {
      for (const tool of server.tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe('string');
      }
    }
  });

  it('returns cached result on second call', () => {
    const a = getBuiltinToolCatalog();
    const b = getBuiltinToolCatalog();
    expect(a).toBe(b);
  });
});
