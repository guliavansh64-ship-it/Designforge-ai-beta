import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/connections.js', () => ({ markConnection: vi.fn(async () => undefined), getCredential: vi.fn() }));
const { __test } = await import('../src/services/stitch.js');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
function fakeClient(files: Record<string, { html?: string; image?: string }>) {
  return { callTool: vi.fn(async (tool: string, args: { name: string }) => {
    if (tool !== 'download_file') throw new Error('unexpected tool ' + tool);
    if (!files[args.name]) throw new Error('not found');
    return files[args.name];
  }) } as any;
}
const screen = (data: unknown) => ({ screenId: 's1', projectId: 'p1', data, getHtmlUrl: vi.fn(async () => 'x'), getImageUrl: vi.fn(async () => 'x') });

describe('Stitch file download (download_file tool, Nov 2026 API)', () => {
  it('downloads HTML + screenshot through download_file, never via the credentialed download URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = fakeClient({
      'projects/p1/files/h': { html: '<!DOCTYPE html><html><body>Hi</body></html>' },
      'projects/p1/files/i': { image: PNG.toString('base64') },
    });
    const r = await __test.materialize(screen({
      htmlCode: { name: 'projects/p1/files/h', downloadUrl: 'https://stitch.googleapis.com/v1/projects/p1/files/h' },
      screenshot: { name: 'projects/p1/files/i', mimeType: 'image/png' },
    }), client);
    expect(r.html).toContain('<body>Hi</body>');
    expect(r.image?.data.equals(PNG)).toBe(true);
    expect(r.image?.mime).toBe('image/png');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('fetches missing file refs via get_screen (SDK getHtmlUrl) before downloading', async () => {
    const s = screen({});
    s.getHtmlUrl.mockImplementation(async () => { (s as any).data = { htmlCode: { name: 'projects/p1/files/h' } }; return 'u'; });
    const r = await __test.materialize(s, fakeClient({ 'projects/p1/files/h': { html: '<html><body>x</body></html>' } }));
    expect(s.getHtmlUrl).toHaveBeenCalled();
    expect(r.html).toContain('<body>x</body>');
    expect(r.image).toBeUndefined(); // screenshot is optional
  });

  it('fails clearly (502) instead of saving an empty design when Stitch returns no HTML', async () => {
    await expect(__test.materialize(screen({ htmlCode: { name: 'projects/p1/files/h' } }), fakeClient({ 'projects/p1/files/h': { html: '' } })))
      .rejects.toMatchObject({ status: 502, code: 'STITCH_ERROR' });
  });
});
