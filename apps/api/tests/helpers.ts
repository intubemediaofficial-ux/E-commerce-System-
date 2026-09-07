import request, { SuperTest, Test } from 'supertest';
import { createApp } from '../src/app';

export const api = (): SuperTest<Test> => request(createApp()) as unknown as SuperTest<Test>;

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Admin@12345';

export interface Session {
  token: string;
  organizationId: string;
  userId: string;
}

export async function login(email = 'admin@demo.test'): Promise<Session> {
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password: SEED_PASSWORD })
    .expect(200);
  const data = response.body.data as {
    accessToken: string;
    user: { id: string; organizationId: string };
  };
  return {
    token: data.accessToken,
    organizationId: data.user.organizationId,
    userId: data.user.id,
  };
}

export const auth =
  (session: Session) =>
  (req: Test): Test =>
    req.set('Authorization', `Bearer ${session.token}`);
