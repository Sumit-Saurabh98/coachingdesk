ALTER TABLE "payments" DROP CONSTRAINT "payments_provider_payment_id_unique";--> statement-breakpoint
ALTER TABLE "institutes" DROP CONSTRAINT "institutes_payout_status_check";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_method_check";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_status_check";--> statement-breakpoint
ALTER TABLE "institutes" DROP COLUMN "payout_account_id";--> statement-breakpoint
ALTER TABLE "institutes" DROP COLUMN "payout_status";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "provider";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "provider_payment_id";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "payment_link_id";--> statement-breakpoint
-- KB #51: no payment gateway for parents. A gateway payment (none were ever recorded) becomes an
-- owner-recorded UPI payment; a refunded one counts as voided.
UPDATE "payments" SET "method" = 'upi' WHERE "method" = 'upi_link';--> statement-breakpoint
UPDATE "payments" SET "status" = 'voided', "voided_at" = coalesce("voided_at", "updated_at") WHERE "status" = 'refunded';--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('upi', 'cash', 'bank', 'other'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_check" CHECK ("payments"."status" in ('active', 'voided'));