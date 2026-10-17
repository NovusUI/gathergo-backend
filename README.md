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
$ yarn install
```

## Local environment

Keep your laptop-specific values in `.env.local` and let `.env` hold the
shared defaults you want to remember. `.env.local` is ignored by git and now
loads before `.env`, so it safely overrides shared values for local runs.

Use the tracked templates as a starting point:

- `.env.local.example` for local development
- `.env.render.example` for the Render service dashboard

Example local overrides:

```bash
NODE_ENV=development
DATABASE_URL=postgresql://localhost:5432/gathergo
REDIS_URL=redis://127.0.0.1:6379
FRONTEND_URL=http://localhost:8081
GOOGLE_CALLBACK_URL=http://localhost:4000/api/v1/auth/google/redirect
```

Render should keep using service environment variables instead of any local
dotenv file.

## Compile and run the project

```bash
# development
$ yarn run start

# watch mode
$ yarn run start:dev

# production mode
$ yarn run start:prod
```

## Events and impact

Events have their own description and interest tags. Impact stories and maps are
optional; an ordinary event can be created without them. Multipart `tags` accepts
repeated string values or a JSON-encoded array, including `[]` to clear interests.
Home cards feature general events first, with a separate impact spotlight when
available. Existing event records are preserved until their organiser edits them.

Impact suggestions use DeepSeek through the authenticated
`POST /api/v1/impact/suggestions` endpoint. Set `DEEPSEEK_API_KEY` on the backend
only. `DEEPSEEK_MODEL` defaults to `deepseek-flash` and also supports
`deepseek-v4-pro`; `DEEPSEEK_TIMEOUT_MS` defaults to `30000`. API details are in the
[DeepSeek documentation](https://api-docs.deepseek.com/api/create-chat-completion/).
The model reads the draft's event description and impact story, selects from the
existing goal and path catalogs, and proposes numeric commitments only with
quoted evidence from the draft. Responses are validated before returning them.
There is no keyword fallback: missing credentials, provider failures, and invalid
model responses report errors while the organiser can still publish without a
map. Only organiser-selected suggestions are saved. Requests are limited to 30
per minute per IP using the existing rate-limit guard.

## Run tests

```bash
# unit tests
$ yarn run test

# e2e tests
$ yarn run test:e2e

# test coverage
$ yarn run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ yarn install -g @nestjs/mau
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


### Ticket and registration checkout safety

Paid checkouts reserve capacity for `CHECKOUT_HOLD_SECONDS` (default 300 seconds), with `CHECKOUT_MAX_TICKETS` (default 4) per ticket order and one active checkout per buyer/event. Free orders confirm immediately. Expired holds stop consuming capacity immediately, independent of the cleanup worker. Ticket capacity and registration capacity edits cannot undercut booked/reserved spaces.

`POST /transaction-reference/initiate` and `/initiateReg` require a UUID v4 `Idempotency-Key` header. Reuse it for retries of the same order; a changed order with the same key returns 409. Ticket quantities are aggregated by ticket type and the complete order succeeds or fails together. URLs and transfer instructions are persisted for checkout recovery. Refreshing or reopening checkout never extends its deadline.

`GET /transaction-reference/status/:id`, `GET /transaction-reference/ticketorreg/:id`, and `POST /transaction-reference/:id/cancel` are buyer-owned endpoints. Status returns `serverTime`, `reservationExpiresAt`, `initializationStatus`, `paymentUrl`, and `checkoutStatus` for ticket/registration payments. An expired hold can still receive payment: provider-verified payments claim available capacity atomically or become `REFUND_REQUIRED`, with no creator payout. Cancelled checkouts always refund later payments. Only confirmed admissions produce `SUCCESS`.

The scheduled checkout worker retries confirmation delivery and refunds. Admissions, sold counts, payment state, and the confirmation job commit together. Email queue jobs have deterministic IDs; feed/notification delivery remains at least once. Webhook inbox records are marked processed only after fulfillment commits and remain retryable on failure.

Paystack refunds are submitted once, then reconciled against its documented refund API. An ambiguous timeout requires reconciliation or an operator; it never triggers another automatic refund POST. ALAT refunds require operations handling because no verified refund API is integrated. With `x-ops-key: INTERNAL_OPS_KEY`, list outstanding refunds at `GET /transaction-reference/internal/refunds`. Refund through the provider first, then confirm a `MANUAL_REQUIRED` refund at `POST /transaction-reference/internal/:id/refund-confirmation` with `{ "reference": "actual-provider-refund-reference" }`. `REFUNDED` means provider completion was confirmed, rather than merely queued.

Roll out migration `20261017120000_checkout_reservations`, regenerate Prisma, and deploy backend/mobile together (older clients do not send checkout keys). The migration preserves historical admissions, assigns fulfillment identities, reconciles sold counts, and counts existing sponsored seats. Historical duplicates and oversold events require manual review; it does not delete admissions or raise event capacity. No live migration is performed by the checkout tests.

Concurrency tests require a separate local PostgreSQL database with PostGIS and this schema, named `checkout_hardening...`. Run `CHECKOUT_TEST_DATABASE_URL=postgresql://...@127.0.0.1:5432/checkout_hardening npm test -- --runInBand --runTestsByPath src/modules/checkout/checkout.integration.spec.ts`. Provider calls and confirmation services are mocked; inventory, locks, rollbacks, webhook inbox, and refund state use real PostgreSQL. Migration preservation fixtures are in `test/fixtures/checkout-migration` (seed the pre-migration schema, apply the migration, run assertions).
