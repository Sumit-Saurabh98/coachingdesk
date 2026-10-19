CREATE TABLE "test_scores" (
	"test_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"institute_id" uuid NOT NULL,
	"marks" numeric(6, 2),
	"is_absent" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_scores_test_id_student_id_pk" PRIMARY KEY("test_id","student_id"),
	CONSTRAINT "test_scores_marks_or_absent_check" CHECK (("test_scores"."is_absent" and "test_scores"."marks" is null) or (not "test_scores"."is_absent" and "test_scores"."marks" is not null and "test_scores"."marks" >= 0))
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institute_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"max_marks" numeric(6, 2) NOT NULL,
	"created_by" uuid,
	"results_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tests_institute_id_id_unique" UNIQUE("institute_id","id"),
	CONSTRAINT "tests_max_marks_check" CHECK ("tests"."max_marks" > 0)
);
--> statement-breakpoint
ALTER TABLE "test_scores" ADD CONSTRAINT "test_scores_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_scores" ADD CONSTRAINT "test_scores_test_same_institute_fk" FOREIGN KEY ("institute_id","test_id") REFERENCES "public"."tests"("institute_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_scores" ADD CONSTRAINT "test_scores_student_same_institute_fk" FOREIGN KEY ("institute_id","student_id") REFERENCES "public"."students"("institute_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_batch_same_institute_fk" FOREIGN KEY ("institute_id","batch_id") REFERENCES "public"."batches"("institute_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_scores_institute_student_idx" ON "test_scores" USING btree ("institute_id","student_id");--> statement-breakpoint
CREATE INDEX "tests_institute_batch_date_idx" ON "tests" USING btree ("institute_id","batch_id","date");