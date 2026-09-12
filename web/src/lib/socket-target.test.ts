import { describe, it, expect } from 'vitest';
import { resolveSocketTarget } from './socket-target';

describe('resolveSocketTarget (ROK-1533)', () => {
  it('moves a path-mounted API prefix onto the engine.io path and keeps the namespace bare', () => {
    // The shipped bundle (Dockerfile.allinone, Dockerfile, web/Dockerfile) sets
    // VITE_API_URL=/api. Before the fix this produced namespace "/api/lineups"
    // over "/socket.io" — a namespace the gateway does not register, on a path
    // nginx answers with index.html.
    expect(resolveSocketTarget('/lineups', '/api')).toEqual({
      url: '/lineups',
      path: '/api/socket.io',
    });
  });

  it('keeps the origin form working for local dev', () => {
    expect(resolveSocketTarget('/lineups', 'http://localhost:3000')).toEqual({
      url: 'http://localhost:3000/lineups',
      path: '/socket.io',
    });
  });

  it('splits a path prefix off an absolute base too', () => {
    // web/Dockerfile exposes VITE_API_URL as a build arg, so a deployer can
    // set an absolute base that still carries the /api prefix. Branching on
    // the leading slash alone would reproduce the original bug verbatim.
    expect(resolveSocketTarget('/lineups', 'https://raid.example.net/api')).toEqual({
      url: 'https://raid.example.net/lineups',
      path: '/api/socket.io',
    });
    expect(resolveSocketTarget('/lineups', '//raid.example.net/api')).toEqual({
      url: '//raid.example.net/lineups',
      path: '/api/socket.io',
    });
  });

  it('handles the ad-hoc namespace and a trailing slash on the base', () => {
    expect(resolveSocketTarget('/ad-hoc', '/api/')).toEqual({
      url: '/ad-hoc',
      path: '/api/socket.io',
    });
    expect(resolveSocketTarget('/ad-hoc', 'http://localhost:3000/')).toEqual({
      url: 'http://localhost:3000/ad-hoc',
      path: '/socket.io',
    });
  });
});
