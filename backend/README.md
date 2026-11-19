<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Secrets and database access

```bash
$ cp .env.example .env      # then fill in the empty values
$ openssl rand -hex 24      # one way to make a password
$ docker compose up -d      # starts PostgreSQL
```

- **Nothing ships with a working password.** `.env.example` leaves
  `DB_PASSWORD`, `STAFF_PASSWORD` and `STAFF_DEVICE_SECRET` empty, and there
  is no built-in fallback such as `postgres`.
- **The backend refuses to start** (and so do the migration commands) when
  `DB_PASSWORD` is missing, or when `DB_PASSWORD`, `STAFF_PASSWORD` or
  `STAFF_DEVICE_SECRET` is a sample or default value: `postgres`,
  `password`, `replace-with-…`, `change-me`, the same text as the user name,
  and the like. It prints which setting to fix. `docker compose` also stops
  until `DB_PASSWORD` is set.
- **`STAFF_PASSWORD` may stay empty**: then no staff account is created and
  the staff pages cannot be signed in to.
- **PostgreSQL is only reachable from this machine.** `docker-compose.yml`
  publishes the port on `127.0.0.1`, so other devices on the same Wi-Fi or
  network cannot connect to it. Check with `docker port lis-postgres`: it
  must print `127.0.0.1:5432`, not `0.0.0.0:5432`.
- If an earlier start used the old sample staff password, that account is
  public knowledge. At startup the backend signs it out everywhere and
  disables its password; the account named by `STAFF_USERNAME` then gets
  the password from `.env`.

### Changing the database password (keeping the data)

PostgreSQL only reads `POSTGRES_PASSWORD` when it creates an empty data
volume. For a database that already exists, change the password inside it;
the store data stays in the `lis_pgdata` volume throughout.

```bash
# 0. Optional safety copy of the store data.
$ docker exec lis-postgres pg_dump -U postgres -d lis -Fc > lis-backup.dump

# 1. Make a new password and put it in .env as DB_PASSWORD=...
#    (also set DB_HOST=127.0.0.1)
$ openssl rand -hex 24

# 2. Recreate the container so it listens on 127.0.0.1 only.
#    The data volume is kept. The database still has the old password.
$ docker compose up -d

# 3. Set the new password inside the database: paste it twice when asked.
$ docker exec -it lis-postgres psql -U postgres -c '\password postgres'

# 4. Check: loopback only, and the data is still there.
$ docker port lis-postgres
$ docker exec lis-postgres psql -U postgres -d lis -c 'select count(*) from product'
```

Replace `postgres` and `lis` with your `DB_USER` and `DB_NAME` if you
changed them. Never run `docker compose down -v` or `docker volume rm`:
those delete the data volume.

## Database migrations

The schema is owned by versioned MikroORM migrations in `src/migrations` —
it is never synced from the entities at startup. The app applies any
pending migrations before it starts listening; you can also run them by
hand:

```bash
# apply pending migrations / roll back the last one
$ npm run migration:up
$ npm run migration:down

# see what has run and what is still pending
$ npm run migration:list
$ npm run migration:pending
```

When you change an entity, create the next migration instead of letting
the ORM rewrite the schema:

```bash
$ npm run migration:create -- --name add-product-brand
```

Review the generated file before committing it. If the change adds a
required column to a table that already has rows, the migration must add
it as nullable, backfill the existing rows, and only then set it
`NOT NULL` — see
`Migration20261110120100_backfill_report_snapshot_columns.ts`, which does
exactly that for the reports an earlier version had already stored, so
none of them are lost.

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
