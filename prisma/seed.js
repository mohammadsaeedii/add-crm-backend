require('dotenv/config');
const bcrypt = require('bcrypt');
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const email = (process.env.ADMIN_EMAIL || 'admin@dabriz.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';
  const passwordHash = await bcrypt.hash(password, 12);

  await client.query(
    `INSERT INTO "Admin" (email, "passwordHash", "createdAt", "updatedAt")
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (email)
     DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", "updatedAt" = NOW()`,
    [email, passwordHash],
  );

  console.log(`Admin ready: ${email}`);
  await client.end();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
