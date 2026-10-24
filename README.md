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

`GogoModule` in `src/modules/gogo` owns the AI features: event-creation
conversations, impact-map suggestions, and their shared DeepSeek request code
and provider types. `AppModule` registers it independently of `EventModule`.

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

Gogo event creation uses `POST /api/v1/events/creation-assistant` with the same
server-only DeepSeek configuration. Authenticated requests include `eventType`
(`general` or `donation`), the organiser's IANA `timeZone`, up to 20 recent
`messages` (`user` or `assistant`), and the current partial `draft` with
`ticketCount` and `volunteerRoleCount`. The response envelope's `data` contains
`reply`, up to three quick-reply `choices`, a nullable `section` naming the
one relevant app editor or `Review`, and partial field `updates`. The app presents one
question at a time and continues after the organiser finishes that editor. Dates
include a time-zone offset; fees remain in naira and donation targets in kobo.
The endpoint validates generated changes and volunteering eligibility; it never
creates or publishes an event. Ticket tiers, roles, images and impact maps use
the existing app editors. Users can switch to the manual form with the same
draft and must review and publish there. Deploy this endpoint before releasing
the conversational UI. Provider errors offer retry or the manual form rather
than a simulated conversation. Requests are limited to 20 per minute per IP.

The request includes `addressedSections` (completed or skipped
optional invitations), `draft.impactMapCount` and the required boolean
`draft.hasImpactGoalOrPath`; replies include `completedSection`
for conversational acceptance or skipping. Initial descriptions supply editable
copy and all available date, venue and pricing facts. Required details come first,
then optional impact story, impact map, links and interests. Volunteer roles are
required only for Volunteer and donation events; Gogo never offers roles for the
other event types.
Gogo skips the interests invitation when an impact story and at least one global
goal or impact path are selected; commitments alone do not skip it. Manual interest
editing remains available. The server enforces this order and volunteering
eligibility before human review. Confirmation of a step already recorded in
`addressedSections` is idempotent, so completing or skipping an editor can continue
to the next step. Invalid drafts and replies log validation reasons without
logging organiser text, provider output or credentials.

## Event volunteering

Volunteer and donation events use `registrationType: "volunteer"` with at least
one `volunteerRoles` entry, without tickets, attendee registration or fees.
Donations remain optional; the stored participation value remains `volunteer`.
Ticket, registration and fundraiser events cannot create volunteer roles or accept
volunteer applications.
Each role has `title`, `description`, `capacity`, and `requiresApproval` (default
`true`). Multipart event creation accepts `volunteerRoles` as a JSON array.

Volunteer and donation events must have non-empty `impactDescription` story
text and a physical venue before recruiting volunteers. An impact title alone
does not qualify. Events with volunteer roles must retain their physical venue
and impact story.

`donationsEnabled` enables optional fundraising independently of participation.
It defaults to `false` for new events except donation events, which always accept
donations. A donation target is optional for Volunteer and donation events and uses kobo.
Volunteer participation never requires payment or an attendee registration.
Existing ticket and registration checkout remains separate.

All routes below use the `/api/v1` prefix and require authentication:

| Route | Purpose |
| --- | --- |
| `GET /events/:eventId/volunteer-roles` | Roles, confirmed place counts, and the caller's applications |
| `POST /events/:eventId/volunteer-roles` | Organiser creates a role |
| `PATCH /events/:eventId/volunteer-roles/:roleId` | Organiser changes details, capacity, approval policy, or `isOpen` |
| `POST /events/:eventId/volunteer-roles/:roleId/apply` | Apply with an optional `note`; accept immediately if approval is disabled |
| `GET /events/:eventId/volunteers` | Organiser-only roster |
| `PATCH /events/:eventId/volunteers/:id/review` | Organiser sets `status` to `ACCEPTED` or `DECLINED` |
| `PATCH /events/:eventId/volunteers/:id/withdraw` | Applicant withdraws |
| `PATCH /events/:eventId/volunteers/:id/check-in` | Organiser records attendance during the event |
| `PATCH /events/:eventId/volunteers/:id/complete` | Organiser confirms actual `confirmedMinutes` after the event |
| `GET /events/:eventId/volunteers/summary` | Recruitment, attendance, and confirmed contribution totals |
| `GET /volunteers/me` | Personal application and contribution history |

Recruitment closes when the event starts. Each person can hold one volunteer role
per event; after withdrawal or rejection they can apply again before recruitment
closes. Capacity allocation is serialized with event edits. Pending applications
do not reserve places. Changing the approval policy affects new applications;
pending applications still require review. Confirmed hours count completed work
only and cannot exceed the time from check-in to event end. Close recruitment
with `isOpen: false` to retain application history.

Organiser dashboards expose a separate `volunteering` summary for all events.
For Volunteer and donation events, `participants` counts confirmed places; money raised
and monetary goals remain separate from `volunteering.recruitmentProgress`.

Apply migration `20261019120000_event_volunteering` and regenerate Prisma before
deploying. The migration enables donations for existing donation events. Mobile
creation, application, roster, and attendance controls use these endpoints;
remote and community volunteering are outside this version.

The volunteering integration suite requires an isolated local PostgreSQL database
whose name contains `volunteer_test`, with the migrations applied. Run
`VOLUNTEER_TEST_DATABASE_URL=postgresql://...@127.0.0.1:5432/gathergo_volunteer_test npm test -- --runInBand --runTestsByPath src/modules/volunteer/volunteer.integration.spec.ts`.

## Gather achievements

The profile Gather tab shows all nine starter achievements together across attending,
volunteering, hosting and giving. `BadgeModule` owns the rules and progress.
Gogo's existing mobile mascot explains the next step and celebrates earned badges;
this experience does not need an AI-provider request.

All routes require authentication and use the standard response envelope:

| Route | Purpose |
| --- | --- |
| `GET /api/v1/badges/me` | All nine badges, earned count, exact requirements, progress and Gogo guidance |
| `GET /api/v1/badges/users/:userId` | Only earned badges the user shares publicly |
| `PATCH /api/v1/badges/me/:code/visibility` | Save `{ "isPublic": true/false }` for an earned badge |

`GET /api/v1/user/public/:userId` also includes the public badge projection.
The profile summary includes created-event, follower and following counts.
Private progress, donation amounts and supported events are never included in it.
Giving badges start private, including badges earned through anonymous donations.

Progress is reconciled from existing activity whenever badges or a public profile
are read, including historical activity. The app refreshes on profile focus and
supports pull-to-refresh. Purchases and registrations alone do not count as
attendance; distinct recorded check-ins do, including volunteer check-ins.
Volunteer hours require completed, organiser-confirmed work. Hosting requires an
ended event with another person checked in. Impact Storyteller recognises a
published post-event report, not independent verification of its claims.

Donations require a completed donation record linked to a successful, fulfilled
`DONATION` transaction for the same user and event, without a refund record.
Repeated gifts to one event count once toward Community Backer. Steady Giver counts
three distinct calendar months in `Africa/Lagos`; they need not be consecutive.
Progress and awards are reconciled after refunds or removed qualifying activity;
saved visibility preferences are retained if a badge is earned again.

Before releasing the mobile UI, apply migration `20261023170000_user_badges` and
regenerate Prisma. No new production dependencies are required. Badge integration
tests require an isolated local database with `badge_test` in its name and all
migrations applied:

```bash
BADGE_TEST_DATABASE_URL=postgresql://...@127.0.0.1:5432/gathergo_badge_test npm test -- --runInBand --runTestsByPath src/modules/badge/badge.integration.spec.ts src/modules/badge/badge-progress.spec.ts
```

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

Organisers can publish hidden tickets directly from the event page’s ticket sheet.
`PATCH /api/v1/event-tickets/:ticketId` accepts `{ "isVisible": true }` without
resending price, stock or other details. Ownership checks still apply; visibility
must be a JSON boolean when provided.

Paid checkouts reserve capacity for `CHECKOUT_HOLD_SECONDS` (default 300 seconds), with `CHECKOUT_MAX_TICKETS` (default 4) per ticket order and one active checkout per buyer/event. Free orders confirm immediately. Expired holds stop consuming capacity immediately, independent of the cleanup worker. Ticket capacity and registration capacity edits cannot undercut booked/reserved spaces.

`POST /transaction-reference/initiate` and `/initiateReg` require a UUID v4 `Idempotency-Key` header. Reuse it for retries of the same order; a changed order with the same key returns 409. Ticket quantities are aggregated by ticket type and the complete order succeeds or fails together. URLs and transfer instructions are persisted for checkout recovery. Refreshing or reopening checkout never extends its deadline.

`GET /transaction-reference/status/:id`, `GET /transaction-reference/ticketorreg/:id`, and `POST /transaction-reference/:id/cancel` are buyer-owned endpoints. Status returns `serverTime`, `reservationExpiresAt`, `initializationStatus`, `paymentUrl`, and `checkoutStatus` for ticket/registration payments. An expired hold can still receive payment: provider-verified payments claim available capacity atomically or become `REFUND_REQUIRED`, with no creator payout. Cancelled checkouts always refund later payments. Only confirmed admissions produce `SUCCESS`.

The scheduled checkout worker retries confirmation delivery and refunds. Admissions, sold counts, payment state, and the confirmation job commit together. Email queue jobs have deterministic IDs; feed/notification delivery remains at least once. Webhook inbox records are marked processed only after fulfillment commits and remain retryable on failure.

Paystack refunds are submitted once, then reconciled against its documented refund API. An ambiguous timeout requires reconciliation or an operator; it never triggers another automatic refund POST. ALAT refunds require operations handling because no verified refund API is integrated. With `x-ops-key: INTERNAL_OPS_KEY`, list outstanding refunds at `GET /transaction-reference/internal/refunds`. Refund through the provider first, then confirm a `MANUAL_REQUIRED` refund at `POST /transaction-reference/internal/:id/refund-confirmation` with `{ "reference": "actual-provider-refund-reference" }`. `REFUNDED` means provider completion was confirmed, rather than merely queued.

Roll out migration `20261017120000_checkout_reservations`, regenerate Prisma, and deploy backend/mobile together (older clients do not send checkout keys). The migration preserves historical admissions, assigns fulfillment identities, reconciles sold counts, and counts existing sponsored seats. Historical duplicates and oversold events require manual review; it does not delete admissions or raise event capacity. No live migration is performed by the checkout tests.

Concurrency tests require a separate local PostgreSQL database with PostGIS and this schema, named `checkout_hardening...`. Run `CHECKOUT_TEST_DATABASE_URL=postgresql://...@127.0.0.1:5432/checkout_hardening npm test -- --runInBand --runTestsByPath src/modules/checkout/checkout.integration.spec.ts`. Provider calls and confirmation services are mocked; inventory, locks, rollbacks, webhook inbox, and refund state use real PostgreSQL. Migration preservation fixtures are in `test/fixtures/checkout-migration` (seed the pre-migration schema, apply the migration, run assertions).

Gogo event creation now starts with the mobile participation-type choice. The
draft's `registrationType` is required and cannot be changed by the model.
Replies include a required nullable `suggestedImpactStory` (at most 180
characters), separate from applied draft updates. The app displays that proposal
in the conversation and writes it into the draft only when the organiser accepts
or opens it for manual editing. Location and fundraising setup render inline.

### Personal interest map

After profile setup, Gogo asks for up to five interests, preferred ways to join in,
an optional city and reactions to at most three real upcoming events. Every step
can be skipped. Saving an empty map still completes onboarding. Settings and the
For you feed link to map editing, passive-learning controls, reset and deletion.

`GET /preferences/catalog` supplies the shared topics; `GET /preferences/examples`
accepts comma-separated `interests` and optional `city`. `PATCH /preferences` takes
`interests`, `helpModes` (`attend`, `volunteer`, `donate`, `carpool`), optional `city`,
`learningEnabled` and up to three `likedEventIds`. `GET /preferences` returns the
profile with weighted interests and source labels. All routes require authentication.

`POST /preferences/signals` records one `LIKE` or `VIEW` per user/event/kind.
Manual picks persist; dated event signals decay with a 30-day half-life. Passive
learning also uses active registrations, tickets, donations and volunteer applications
after the profile’s learning cutoff. Donation amounts do not affect the weights.
Likes remain deliberate inputs when passive learning is off. `POST /preferences/reset-learning`
clears signals and advances the cutoff while retaining choices. `DELETE /preferences`
clears the map, turns passive learning off and preserves the completed onboarding flag.

Recommendations combine interests, event-format/activity similarity, city and
participation preferences across the next 200 upcoming events. The feed displays
the associated recommendation reason. Availability, driving/riding questions, dwell
time and saves are outside this first release.

The home feed offers a Gogo survey for the most recent unanswered event that ended
within 30 days, after the map’s learning cutoff, with a scanned used ticket or
registration, or a checked-in/completed volunteer record. Purchases, registrations
and donations without a check-in do not qualify. Only one survey opens per home
screen visit. `GET /preferences/event-feedback/pending` returns `{ id, title,
endDate }` or `null`.

`POST /preferences/event-feedback/:eventId` accepts `rating` (`LOVED`, `OKAY`,
`NOT_FOR_ME`) and the required boolean `moreLikeThis`. An answer replaces that
same event’s earlier learning signals; retries do not accumulate weight. Explicit
answers apply even when passive learning is off. Positive and neutral answers
increase topic affinity, negative answers reduce it, and chosen interests retain
a minimum weight of 3. The response includes the updated `profile`, actual
before-and-after `changes`, `rating` and `moreLikeThis`. The UI shows the map
confirmation only after the save succeeds. `NOT_FOR_ME` cannot be combined with
`moreLikeThis: true`.

`POST /preferences/event-feedback/:eventId/defer` implements “Not now”: it
postpones that survey by 24 hours without an interest signal. Answered events are
not prompted again. Map reset clears survey learning and advances the cutoff;
map deletion removes the associated answers. These responses are private and do
not appear in public profiles or organiser reports.

Apply migration `20261023210000_post_event_feedback` and regenerate Prisma before
releasing the survey UI. No notification service or AI provider is needed.

Apply migrations with `npx prisma migrate deploy` before releasing the new app.
Run the database-backed tests with `node --env-file=.env test/interest-map.integration.cjs`.
They require the existing local PostgreSQL/PostGIS setup, create an isolated schema
from the current Prisma model, and remove that schema when finished.
