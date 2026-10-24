import { getFrontendUrls } from '../config.js';

describe('allowed website addresses', () => {
  const original = process.env.FRONTEND_URL;
  afterEach(() => { process.env.FRONTEND_URL = original; });

  it('ignores trailing slashes and spaces, since browsers send origins without them', () => {
    process.env.FRONTEND_URL = ' https://proof-web.vercel.app/ , http://localhost:5173// ';
    expect(getFrontendUrls()).toEqual(['https://proof-web.vercel.app', 'http://localhost:5173']);
  });

  it('keeps a plain address as it is and falls back to the local dev site', () => {
    process.env.FRONTEND_URL = 'https://proof-web.vercel.app';
    expect(getFrontendUrls()).toEqual(['https://proof-web.vercel.app']);
    delete process.env.FRONTEND_URL;
    expect(getFrontendUrls()).toEqual(['http://localhost:5173']);
  });
});
