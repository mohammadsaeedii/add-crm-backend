import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
// Production image only ships compiled client under dist/ (see Dockerfile).
import { PrismaClient } from '../dist/generated/prisma/client.js';

async function main() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL as string,
  });
  const prisma = new PrismaClient({ adapter });

  const email = (process.env.ADMIN_EMAIL || 'admin@dabriz.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.admin.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });

  console.log(`Admin ready: ${email}`);

  const clientId =
    process.env.OAUTH_CRM_CLIENT_ID || 'multi-tenant-crm';
  const clientSecret =
    process.env.OAUTH_CRM_CLIENT_SECRET || 'crm-dev-client-secret-change-me';
  const redirectUris = (
    process.env.OAUTH_CRM_REDIRECT_URIS ||
    'http://localhost:3001/auth/sso/callback,http://localhost:3002/auth/sso/callback'
  )
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  const clientSecretHash = await bcrypt.hash(clientSecret, 12);

  await prisma.oAuthClient.upsert({
    where: { clientId },
    update: {
      clientSecretHash,
      name: 'Multi-tenant CRM',
      redirectUris,
    },
    create: {
      clientId,
      clientSecretHash,
      name: 'Multi-tenant CRM',
      redirectUris,
    },
  });

  console.log(`OAuth client ready: ${clientId}`);
  console.log(`Redirect URIs: ${redirectUris.join(', ')}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
