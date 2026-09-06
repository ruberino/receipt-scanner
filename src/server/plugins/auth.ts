import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { loginSchema } from '../../shared/schemas.ts';
import type { Config } from '../config.ts';
import { UnauthorizedError } from '../lib/errors.ts';

const COOKIE_NAME = 'kvitteringer_auth';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const EXEMPT_PATHS = new Set(['/api/auth/login', '/api/health']);

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function passwordsMatch(submitted: string, expected: string): boolean {
  return timingSafeEqual(sha256(submitted), sha256(expected));
}

function computeCookieValue(sessionSecret: string): string {
  return createHmac('sha256', sessionSecret).update('kvitteringer-v1').digest('hex');
}

function cookieIsValid(cookieValue: string | undefined, expected: string): boolean {
  if (!cookieValue) {
    return false;
  }
  const provided = Buffer.from(cookieValue, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
}

export type AuthPluginOptions = {
  config: Config;
};

async function authPlugin(app: FastifyInstance, options: AuthPluginOptions): Promise<void> {
  const { config } = options;
  const expectedCookieValue = computeCookieValue(config.sessionSecret);

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { password } = loginSchema.parse(request.body);

      if (!passwordsMatch(password, config.appPassword)) {
        throw new UnauthorizedError('Feil passord');
      }

      reply.setCookie(COOKIE_NAME, expectedCookieValue, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: COOKIE_MAX_AGE_SECONDS,
        secure: config.nodeEnv === 'production',
      });
      reply.status(204).send();
    },
  );

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    reply.status(204).send();
  });

  app.get('/api/auth/me', async () => ({ authenticated: true }));

  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) {
      return;
    }
    const pathname = request.url.split('?')[0];
    if (pathname !== undefined && EXEMPT_PATHS.has(pathname)) {
      return;
    }

    if (!cookieIsValid(request.cookies[COOKIE_NAME], expectedCookieValue)) {
      throw new UnauthorizedError();
    }
  });
}

export default fp(authPlugin, { name: 'auth' });
