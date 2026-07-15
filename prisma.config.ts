import dotenv from "dotenv";
import { defineConfig } from "prisma/config";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});