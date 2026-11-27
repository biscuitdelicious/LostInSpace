import { EntityManager } from '@mikro-orm/postgresql';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Product } from '../src/products/product.entity';
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

  it('two staff deciding the same report at once: one decision counts, the loser is told it, and the shelf matches', async () => {
    const server = app.getHttpServer();
    const username = (config.get<string>('STAFF_USERNAME') ?? 'staff').trim();
    const password = config.get<string>('STAFF_PASSWORD') ?? '';
    expect(password.length).toBeGreaterThan(0);
    const loginRes = await request(server)
      .post('/auth/login')
      .send({ username, password })
      .expect(200);
    const { token } = loginRes.body as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const productsRes = await request(server)
      .get('/products?q=milk')
      .expect(200);
    const product = (
      productsRes.body as {
        id: number;
        aisleLocation: string;
        aisleNumber: number;
        mapX: number;
        mapY: number;
      }[]
    )[0];
    const original = { ...product };
    const createdIds: number[] = [];
    // Every round starts from the original shelf. Without this, a round
    // won by confirm leaves the product in aisle 5, and a later round won
    // by reject would wrongly expect the original aisle.
    const restoreShelf = async () => {
      const em = app.get(EntityManager).fork();
      const row = await em.findOne(Product, { id: product.id });
      if (!row) return;
      row.aisleLocation = original.aisleLocation;
      row.aisleNumber = original.aisleNumber;
      row.mapX = original.mapX;
      row.mapY = original.mapY;
      await em.flush();
    };
    type Decide = (id: number) => Promise<[request.Response, request.Response]>;
    const confirmThenReject: Decide = async (id) => {
      const confirmRes = await request(server)
        .post(`/product-reports/${id}/confirm`)
        .set(auth);
      const rejectRes = await request(server)
        .post(`/product-reports/${id}/reject`)
        .set(auth);
      return [confirmRes, rejectRes];
    };
    const rejectThenConfirm: Decide = async (id) => {
      const rejectRes = await request(server)
        .post(`/product-reports/${id}/reject`)
        .set(auth);
      const confirmRes = await request(server)
        .post(`/product-reports/${id}/confirm`)
        .set(auth);
      return [confirmRes, rejectRes];
    };
    const atOnce: Decide = (id) =>
      Promise.all([
        request(server).post(`/product-reports/${id}/confirm`).set(auth),
        request(server).post(`/product-reports/${id}/reject`).set(auth),
      ]);
    // Pinned first: a confirm round followed by a reject round — the
    // sequence that once leaked aisle 5 into the next round's expectation —
    // then ten real races.
    const rounds: Decide[] = [
      confirmThenReject,
      rejectThenConfirm,
      ...Array.from({ length: 10 }, () => atOnce),
    ];
    try {
      for (const decide of rounds) {
        await restoreShelf();
        const createRes = await request(server)
          .post('/product-reports')
          .send({
            productId: product.id,
            aisleNumber: 5,
            side: 'left',
            shelf: 'top',
            kind: 'moved',
          })
          .expect(201);
        const id = (createRes.body as { id: number }).id;
        createdIds.push(id);

        const [confirmRes, rejectRes] = await decide(id);
        const statuses = [confirmRes.status, rejectRes.status].sort();
        expect(statuses).toEqual([201, 409]);
        const winner = confirmRes.status === 201 ? confirmRes : rejectRes;
        const loser = confirmRes.status === 409 ? confirmRes : rejectRes;
        const decision = (winner.body as { status: string }).status;
        const reported = (createRes.body as { reportedAisleLocation: string })
          .reportedAisleLocation;
        const productName = (createRes.body as { productName: string })
          .productName;
        const shelfAfter =
          decision === 'confirmed' ? reported : original.aisleLocation;
        expect(loser.body).toMatchObject({
          statusCode: 409,
          status: decision,
          message:
            decision === 'confirmed'
              ? `Someone already confirmed the ${productName} report to ${reported} (report ${id}). ${productName} is now on ${shelfAfter}.`
              : `Someone already rejected the ${productName} report to ${reported} (report ${id}). ${productName} stays on ${shelfAfter}.`,
        });

        const finalRes = await request(server)
          .get(`/product-reports/${id}`)
          .expect(200);
        expect((finalRes.body as { status: string }).status).toBe(decision);
        const shelfRes = await request(server)
          .get('/products?q=milk')
          .expect(200);
        const shelf = (
          shelfRes.body as { id: number; aisleNumber: number }[]
        ).find((item) => item.id === product.id)!;
        expect(shelf.aisleNumber).toBe(
          decision === 'confirmed' ? 5 : original.aisleNumber,
        );
      }
    } finally {
      const em = app.get(EntityManager).fork();
      if (createdIds.length) {
        await em.nativeDelete(ProductReport, { id: { $in: createdIds } });
      }
      await restoreShelf();
      await request(server).post('/auth/logout').set(auth).expect(200);
    }
  });
});
