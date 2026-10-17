DO $$ BEGIN
IF (SELECT count(*) FROM "Ticket") <> 2 THEN RAISE EXCEPTION 'Historical tickets were lost'; END IF;
IF (SELECT count(DISTINCT "fulfillmentKey") FROM "Ticket") <> 2 THEN RAISE EXCEPTION 'Ticket fulfillment keys not backfilled'; END IF;
IF (SELECT "sold" FROM "EventTicket" WHERE "id" = 'migration-ticket-type') <> 2 THEN RAISE EXCEPTION 'Issued ticket count not reconciled'; END IF;
IF (SELECT "quantity" FROM "EventTicket" WHERE "id" = 'migration-ticket-type') <> 1 THEN RAISE EXCEPTION 'Historical capacity unexpectedly changed'; END IF;
IF (SELECT count(*) FROM "Registration") <> 2 THEN RAISE EXCEPTION 'Historical registrations were lost'; END IF;
IF (SELECT count("fulfillmentKey") FROM "Registration") <> 1 THEN RAISE EXCEPTION 'Registration duplicate backfill incorrect'; END IF;
IF (SELECT "processedAt" FROM "ProviderWebhookEvent" WHERE "id" = 'migration-hook') IS NULL THEN RAISE EXCEPTION 'Successful inbox record not marked processed'; END IF;
IF (SELECT "status" FROM "CheckoutReservation" WHERE "transactionId" = 'migration-sponsor-txn') <> 'CONFIRMED' THEN RAISE EXCEPTION 'Sponsored seat not preserved'; END IF;
END $$;
