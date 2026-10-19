CREATE TABLE "invoice_counters" (
	"institute_id" uuid PRIMARY KEY NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_runs" (
	"institute_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "invoice_runs_institute_id_period_start_pk" PRIMARY KEY("institute_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institute_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid,
	"batch_id" uuid,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"description" text NOT NULL,
	"period_start" date,
	"period_end" date,
	"amount_paise" bigint NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"paid_paise" bigint DEFAULT 0 NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'due' NOT NULL,
	"close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_institute_number_unique" UNIQUE("institute_id","number"),
	CONSTRAINT "invoices_institute_id_id_unique" UNIQUE("institute_id","id"),
	CONSTRAINT "invoices_kind_check" CHECK ("invoices"."kind" in ('cycle', 'one_time', 'manual')),
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" in ('due', 'partially_paid', 'paid', 'waived', 'cancelled')),
	CONSTRAINT "invoices_amount_check" CHECK ("invoices"."amount_paise" > 0),
	CONSTRAINT "invoices_discount_check" CHECK ("invoices"."discount_paise" >= 0 and "invoices"."discount_paise" < "invoices"."amount_paise"),
	CONSTRAINT "invoices_paid_check" CHECK ("invoices"."paid_paise" >= 0),
	CONSTRAINT "invoices_kind_shape_check" CHECK (("invoices"."kind" = 'manual') = ("invoices"."enrollment_id" is null) and ("invoices"."kind" = 'manual') = ("invoices"."period_start" is null)),
	CONSTRAINT "invoices_period_check" CHECK ("invoices"."period_end" is null or "invoices"."period_end" >= "invoices"."period_start")
);
--> statement-breakpoint
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_runs" ADD CONSTRAINT "invoice_runs_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_same_institute_fk" FOREIGN KEY ("institute_id","student_id") REFERENCES "public"."students"("institute_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_enrollment_same_institute_fk" FOREIGN KEY ("institute_id","enrollment_id") REFERENCES "public"."enrollments"("institute_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_batch_same_institute_fk" FOREIGN KEY ("institute_id","batch_id") REFERENCES "public"."batches"("institute_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_enrollment_period_unique" ON "invoices" USING btree ("enrollment_id","period_start") WHERE "invoices"."kind" in ('cycle', 'one_time');--> statement-breakpoint
CREATE INDEX "invoices_institute_status_due_idx" ON "invoices" USING btree ("institute_id","status","due_date");--> statement-breakpoint
CREATE INDEX "invoices_institute_student_idx" ON "invoices" USING btree ("institute_id","student_id");