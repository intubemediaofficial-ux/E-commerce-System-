import { beforeAll, describe, expect, it } from 'vitest';
import { api, auth, login, Session } from '../helpers';

let session: Session;
let withAuth: ReturnType<typeof auth>;

beforeAll(async () => {
  session = await login();
  withAuth = auth(session);
});

describe('user management', () => {
  it('creates a second login with admin access and lets it sign in', async () => {
    const roles = await withAuth(api().get('/api/admin/roles')).expect(200);
    const adminRole = (roles.body.data as { id: string; slug: string }[]).find(
      (role) => role.slug === 'admin' || role.slug === 'super_admin',
    );
    expect(adminRole).toBeDefined();

    const email = `manager.${Date.now()}@demo.test`;
    const password = 'Manager@12345';
    const create = await withAuth(api().post('/api/admin/users'))
      .send({ name: 'Second Admin', email, password, roleIds: [adminRole!.id] })
      .expect(201);
    const createdUser = create.body.data as {
      id: string;
      email: string;
      userRoles: { role: { id: string } }[];
    };
    expect(createdUser.email).toBe(email);
    expect(createdUser.userRoles.map((entry) => entry.role.id)).toContain(adminRole!.id);

    const loggedIn = await api().post('/api/auth/login').send({ email, password }).expect(200);
    const permissions = (loggedIn.body.data as { user: { permissions: string[] } }).user.permissions;
    expect(permissions).toContain('user.manage');

    await withAuth(api().delete(`/api/admin/users/${createdUser.id}`)).expect(200);
  });

  it('refuses to create a user without a role', async () => {
    await withAuth(api().post('/api/admin/users'))
      .send({ name: 'No Role', email: `norole.${Date.now()}@demo.test`, password: 'Manager@12345', roleIds: [] })
      .expect(422);
  });
});
