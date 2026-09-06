import type { FastifyInstance } from 'fastify';

export async function loginCookie(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: 'test-password-123' },
  });

  const cookie = response.cookies.find((c) => c.name === 'kvitteringer_auth');
  if (!cookie) {
    throw new Error('Login did not set the auth cookie');
  }

  return `${cookie.name}=${cookie.value}`;
}
