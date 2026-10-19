CREATE TABLE "payment_allocations" (
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"institute_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	CONSTRAINT "payment_allocations_payment_id_invoice_id_pk" PRIMARY KEY("payment_id","invoice_id"),
	CONSTRAINT "payment_allocations_amount_check" CHECK ("payment_allocations"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institute_id" uuid NOT NULL,
	"guardian_phone" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"method" text NOT NULL,
	"provider" text,
	"provider_payment_id" text,
	"payment_link_id" uuid,
	"idempotency_key" text,
	"status" text DEFAULT 'active' NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"recorded_by" uuid,
	"note" text,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_payment_id_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "payments_institute_id_id_unique" UNIQUE("institute_id","id"),
	CONSTRAINT "payments_institute_idempotency_key_unique" UNIQUE("institute_id","idempotency_key"),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_paise" > 0),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('upi_link', 'cash', 'bank', 'other')),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" in ('active', 'voided', 'refunded')),
	CONSTRAINT "payments_voided_check" CHECK (("payments"."status" = 'voided') = ("payments"."voided_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_same_institute_fk" FOREIGN KEY ("institute_id","payment_id") REFERENCES "public"."payments"("institute_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_same_institute_fk" FOREIGN KEY ("institute_id","invoice_id") REFERENCES "public"."invoices"("institute_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_allocations_institute_invoice_idx" ON "payment_allocations" USING btree ("institute_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payments_institute_paid_at_idx" ON "payments" USING btree ("institute_id","paid_at");