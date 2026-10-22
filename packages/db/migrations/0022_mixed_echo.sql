CREATE TABLE "terms_acceptances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "terms_acceptances_user_id_idx" ON "terms_acceptances" USING btree ("user_id","accepted_at");