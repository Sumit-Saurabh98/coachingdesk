CREATE TABLE "message_usage" (
	"institute_id" uuid NOT NULL,
	"day" date NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "message_usage_institute_id_day_pk" PRIMARY KEY("institute_id","day"),
	CONSTRAINT "message_usage_sent_check" CHECK ("message_usage"."sent" >= 0)
);
--> statement-breakpoint
ALTER TABLE "message_usage" ADD CONSTRAINT "message_usage_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE no action ON UPDATE no action;