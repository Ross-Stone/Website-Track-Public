CREATE TABLE `import_staging` (
	`import_id` text NOT NULL,
	`tbl` text NOT NULL,
	`seq` integer NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`import_id`, `tbl`, `seq`),
	CONSTRAINT "import_staging_data_array" CHECK(json_type("import_staging"."data") = 'array')
);
