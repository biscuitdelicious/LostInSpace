import { EntityManager } from '@mikro-orm/postgresql';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { ProductReport } from '../src/reports/product-report.entity';
import { AppModule } from './../src/app.module';

describe('Backend HTTP API (e2e)', () => {
  let app: INestApplication<App>;
  let config: ConfigService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    config = moduleFixture.get(ConfigService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('protects staff report management with username/password login while keeping shopper endpoints public', async () => {
    const server = app.getHttpServer();

    // Check the environment before touching the database, so a misconfigured
    // run cannot fail half-way and leave a test report behind.
    const username = (config.get<string>('STAFF_USERNAME') ?? 'staff').trim();
    const password = config.get<string>('STAFF_PASSWORD') ?? '';
    expect(password.length).toBeGreaterThan(0);

    const productsRes = await request(server)
      .get('/products?q=milk')
      .expect(200);
    const products = productsRes.body as { id: number; name: string }[];
    expect(products.length).toBeGreaterThan(0);

    // Unauthenticated requests to staff report endpoints are rejected.
    await request(server).get('/product-reports').expect(401);
    await request(server).post('/product-reports/1/confirm').expect(401);
    await request(server).post('/product-reports/1/reject').expect(401);

    // Shoppers can create a "Not here" report and check its status without signing in.
    const createRes = await request(server)
      .post('/product-reports')
      .send({
        productId: products[0].id,
        aisleNumber: 7,
        side: 'left',
        shelf: 'middle',
        mapY: 138,
        kind: 'moved',
      })
      .expect(201);
    const created = createRes.body as { id: number; status: string };
    expect(created.status).toBe('pending');

    try {
      await request(server).get(`/product-reports/${created.id}`).expect(200);
      await request(server)
        .post(`/product-reports/${created.id}/confirm`)
        .expect(401);
      await request(server)
        .post(`/product-reports/${created.id}/reject`)
        .expect(401);

      await request(server)
        .post('/auth/login')
        .send({ username, password: `${password}-wrong` })
        .expect(401);

      const loginRes = await request(server)
        .post('/auth/login')
        .send({ username, password })
        .expect(200);
      const { token, user, deviceToken } = loginRes.body as {
        token: string;
        user: { username: string };
        deviceToken: string;
      };
      expect(user.username).toBe(username);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(deviceToken).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);

      await request(server)
        .get('/product-reports')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Reject the test report so product shelf state stays untouched.
      const rejectRes = await request(server)
        .post(`/product-reports/${created.id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect((rejectRes.body as { status: string }).status).toBe('rejected');

      // Blocking and reopening a walkway populates both junctions so the
      // reply carries the connection's real name, never undefined coordinates.
      const graphRes = await request(server).get('/walk-graph').expect(200);
      const firstEdge = (
        graphRes.body as {
          edges: { id: number; blocked: boolean; name: string }[];
        }
      ).edges[0];
      expect(firstEdge).toBeDefined();
      expect(firstEdge.name).not.toContain('undefined');
      try {
        const blockRes = await request(server)
          .post(`/walk/edges/${firstEdge.id}/blocked`)
          .set('Authorization', `Bearer ${token}`)
          .send({ blocked: !firstEdge.blocked })
          .expect(201);
        expect(blockRes.body).toMatchObject({
          id: firstEdge.id,
          blocked: !firstEdge.blocked,
          name: firstEdge.name,
        });
      } finally {
        const restoreRes = await request(server)
          .post(`/walk/edges/${firstEdge.id}/blocked`)
          .set('Authorization', `Bearer ${token}`)
          .send({ blocked: firstEdge.blocked })
          .expect(201);
        expect(restoreRes.body).toMatchObject({
          id: firstEdge.id,
          blocked: firstEdge.blocked,
          name: firstEdge.name,
        });
      }

      await request(server)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(server)
        .get('/product-reports')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    } finally {
      // Even a failed assertion must not leave the test report behind.
      await app
        .get(EntityManager)
        .fork()
        .nativeDelete(ProductReport, { id: created.id });
    }
  });
});
