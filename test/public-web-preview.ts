import { createPublicWebHarness } from './public-web-harness';

async function preview() {
  const harness = await createPublicWebHarness({
    onCode: (mail) =>
      console.log(`Local test email ${String(mail.to)}: ${mail.code}`),
  });
  await harness.app.listen(4011, '127.0.0.1');
  console.log(
    JSON.stringify({
      testApi: 'http://127.0.0.1:4011/api/v1',
      ticketEvent: harness.ticketEvent.id,
      registrationEvent: harness.registrationEvent.id,
      foodBank: harness.foodBank.id,
      volunteerEvent: harness.volunteerEvent.id,
      carpool: harness.ride.id,
    }),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void harness.app.close().then(() => process.exit(0));
    });
}
void preview();
