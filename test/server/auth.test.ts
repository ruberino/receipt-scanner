import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/createTestApp.ts';
import { loginCookie } from '../helpers/login.ts';

describe('POST /api/auth/login', () => {
  it('gives 401 UNAUTHORIZED for a wrong password', async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');

    await app.close();
  });

  it('gives 400 VALIDATION_ERROR naming password when the body is empty', async () => {
    const app = createTestApp();

    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details[0].path).toEqual(['password']);

    await app.close();
  });

  it('gives 400 when password is not a string', async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 123 },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('gives 400 on an unknown property', async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'x', extra: 1 },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('gives 400 for an empty password', async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: '' },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('rate limits after 5 attempts within a minute, from the same client', async () => {
    const app = createTestApp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: 'wrong-password' },
      });
      expect(response.statusCode).toBe(401);
    }

    const sixth = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong-password' },
    });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.code).toBe('RATE_LIMITED');
    expect(sixth.json().error.message).toBe('For mange forsøk. Prøv igjen om et minutt.');

    await app.close();
  });

  it('gives independent rate-limit counters per forwarded address when trustProxy is on', async () => {
    const app = createTestApp({ env: { NODE_ENV: 'production' } });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: 'wrong-password' },
        headers: { 'x-forwarded-for': '1.1.1.1' },
      });
      expect(response.statusCode).toBe(401);
    }

    const sameAddressAgain = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong-password' },
      headers: { 'x-forwarded-for': '1.1.1.1' },
    });
    expect(sameAddressAgain.statusCode).toBe(429);

    const differentAddress = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong-password' },
      headers: { 'x-forwarded-for': '2.2.2.2' },
    });
    expect(differentAddress.statusCode).toBe(401);

    await app.close();
  });

  it('ignores the forwarded-for header when trustProxy is off, sharing one counter', async () => {
    const app = createTestApp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: 'wrong-password' },
        headers: { 'x-forwarded-for': '1.1.1.1' },
      });
      expect(response.statusCode).toBe(401);
    }

    const fromADifferentClaimedAddress = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong-password' },
      headers: { 'x-forwarded-for': '2.2.2.2' },
    });
    expect(fromADifferentClaimedAddress.statusCode).toBe(429);

    await app.close();
  });

  it('gives 204 and a well-formed Set-Cookie header for the right password', async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'test-password-123' },
    });

    expect(response.statusCode).toBe(204);
    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toContain('kvitteringer_auth=');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/Max-Age=31536000/i);
    expect(setCookie).not.toMatch(/Secure/i);

    await app.close();
  });

  it('sets Secure only when NODE_ENV=production', async () => {
    const app = createTestApp({ env: { NODE_ENV: 'production' } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'test-password-123' },
    });

    expect(response.headers['set-cookie']).toMatch(/Secure/i);

    await app.close();
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the cookie and returns 204', async () => {
    const app = createTestApp();
    const cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toMatch(/kvitteringer_auth=;/);

    await app.close();
  });
});

describe('GET /api/auth/me', () => {
  it('gives 401 without a cookie', async () => {
    const app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it('gives 401 with a tampered cookie', async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: 'kvitteringer_auth=not-the-real-value' },
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it('gives 200 with the real cookie', async () => {
    const app = createTestApp();
    const cookie = await loginCookie(app);

    const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: true });

    await app.close();
  });

  it('gives 401 once SESSION_SECRET changes, invalidating the old cookie', async () => {
    const originalApp = createTestApp({
      env: { SESSION_SECRET: 'first-session-secret-that-is-32-plus-chars' },
    });
    const cookie = await loginCookie(originalApp);
    await originalApp.close();

    const restartedApp = createTestApp({
      env: { SESSION_SECRET: 'second-session-secret-that-is-32-plus-chars' },
    });

    const response = await restartedApp.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(401);

    await restartedApp.close();
  });
});

describe('GET /api/health', () => {
  it('still works without a cookie once auth is registered', async () => {
    const app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);

    await app.close();
  });
});

describe('the guard on unmatched /api/* routes', () => {
  it('gives 401 before 404 when there is no cookie', async () => {
    const app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it('gives 404 (not 401) once a valid cookie is presented', async () => {
    const app = createTestApp();
    const cookie = await loginCookie(app);

    const response = await app.inject({ method: 'GET', url: '/api/nope', headers: { cookie } });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');

    await app.close();
  });
});
